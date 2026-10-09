// The courier: every R2 request is carried by the OS's own curl, not by KAPEVault.exe, so cloud backup
// keeps working while Air Wall has Windows Firewall block KAPEVault from the internet. Main builds and
// signs the request first. curl's arguments hold only fixed flags and temp file paths: the URL and the
// signed headers (never the secret key) go in a config on stdin, the already-encrypted body in a file.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tls = require("node:tls");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { system32, windowsDir } = require("./system-tools.cjs");

const isWin = process.platform === "win32";
// A dead link fails fast: 10s to connect (DNS, TCP and TLS), then a transfer moving under 1 KB/s for
// 30s is dropped (curl's --speed-limit/--speed-time count both directions). A slow link that keeps
// moving is never cut off at a fixed time - a 64 MB vault on a slow uplink takes minutes - so the
// whole-call cap is only a backstop.
const CONNECT_S = 10;
const STALL_BYTES_PER_S = 1024;
const STALL_S = 30;
const MAX_TIME_S = 60 * 60;
const UNREACHABLE = "Could not reach R2. Check the internet connection and the bucket URL.";
const STATUS_LEN = 3; // -w %{http_code} is always three digits, written after the body
const TEMP_PREFIX = "kapevault-courier-";

const curlPath = () => (isWin ? system32("curl.exe") : "/usr/bin/curl");

// Calls in flight. Quitting can end the app before a call's own cleanup runs, so on exit every curl
// still running is stopped and its temp files (the roots, the encrypted body) are deleted. Electron
// emits 'exit' from app 'quit', which a Windows shut down or sign-out skips: main.cjs also calls
// cleanUp on the window's 'session-end'.
const live = { files: new Set(), children: new Set() };
function cleanUp() {
  for (const child of live.children) child.kill();
  for (const file of live.files) {
    try {
      // Windows lets go of a killed curl's open body file a moment later; rmSync retries only when recursive.
      fs.rmSync(file, { force: true, recursive: true, maxRetries: 5, retryDelay: 20 });
    } catch {
      // the app is exiting; nothing more can be done
    }
  }
}
process.on("exit", cleanUp);

// A hard kill or a power cut skips every cleanup, and a left body is the vault as it was that day
// (it opens with that day's master password - what the no-.bak rule avoids). Swept on start; only
// files older than any call can run, so a second KAPEVault (a dev run) never loses one in flight.
function sweepStale(now = Date.now(), dir = os.tmpdir()) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.startsWith(TEMP_PREFIX));
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      if (now - fs.statSync(file).mtimeMs > (MAX_TIME_S + 60) * 1000) fs.rmSync(file, { force: true });
    } catch {
      // in use or gone
    }
  }
}

// A file only this call uses: a new random name, never an existing file (wx), owner-only.
function tempFile(ext, contents) {
  const file = path.join(os.tmpdir(), `${TEMP_PREFIX}${crypto.randomUUID()}${ext}`);
  fs.writeFileSync(file, contents, { flag: "wx", mode: 0o600 });
  live.files.add(file);
  return file;
}

// A curl config value: double-quoted, backslash and quote escaped (curl's --config syntax). No
// control characters at all, so nothing can start another line (another option) in the config.
function configQuote(value) {
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error("Bad header");
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

// What curl reads on stdin: the method, the URL and every signed header.
function curlConfig({ method, url, headers }) {
  const lines = [`request = ${configQuote(method)}`, `url = ${configQuote(url)}`];
  for (const [name, value] of Object.entries(headers)) lines.push(`header = ${configQuote(`${name}: ${value}`)}`);
  return `${lines.join("\n")}\n`;
}

// allowHttp: plain http to 127.0.0.1 only, for the fake R2 of an unpacked test run. caFile: the roots
// to trust; bodyFile: the upload, if any.
function curlArgs({ url, maxBytes, caFile, bodyFile, allowHttp = false }) {
  const local = allowHttp && /^http:\/\/127\.0\.0\.1[:/]/.test(url);
  const args = [
    "-q", // must come first: never read a curlrc
    "-K", "-", // the request itself comes on stdin
    "-s",
    "-g", // the URL is used as-is, no {} [] globbing
    "--proto", local ? "=http" : "=https", // no -L either: a redirect would resend the upload elsewhere
    "--connect-timeout", String(CONNECT_S),
    "--speed-limit", String(STALL_BYTES_PER_S),
    "--speed-time", String(STALL_S),
    "--max-time", String(MAX_TIME_S),
    "--max-filesize", String(maxBytes),
    "--cacert", caFile,
    "-w", "%{http_code}",
  ];
  if (isWin) args.push("--ssl-revoke-best-effort"); // an unreachable revocation server is not a failed backup
  // curl would add a form Content-Type and an Expect wait to an upload.
  if (bodyFile) args.push("-H", "Content-Type:", "-H", "Expect:", "--data-binary", `@${bodyFile}`);
  return args;
}

// stdout = body followed by the status code. null when the status is missing (curl gave up).
function parseOutput(stdout) {
  if (stdout.length < STATUS_LEN) return null;
  const status = stdout.subarray(stdout.length - STATUS_LEN).toString("latin1");
  if (!/^[1-5]\d\d$/.test(status)) return null;
  return { status: Number(status), body: stdout.subarray(0, stdout.length - STATUS_LEN) };
}

// Resolves { status, body } for any HTTP answer; rejects with a user-facing message otherwise.
async function carry({ method, url, headers, body, maxBytes, tooLarge, allowHttp }) {
  const config = curlConfig({ method, url, headers });
  const files = [];
  try {
    // curl trusts only the roots Node ships (the ones the old fetch used), not the Windows store, where
    // antivirus or company TLS inspection adds its own. Written fresh for every call, then deleted.
    files.push(tempFile(".pem", tls.rootCertificates.join("\n")));
    if (body !== undefined) files.push(tempFile(".body", body));
    const args = curlArgs({ url, maxBytes, caFile: files[0], bodyFile: files[1], allowHttp });
    return await run(args, config, { maxBytes, tooLarge });
  } finally {
    for (const file of files) {
      fs.rmSync(file, { force: true });
      live.files.delete(file);
    }
  }
}

function run(args, config, { maxBytes, tooLarge }) {
  return new Promise((resolve, reject) => {
    // A clean environment: no proxy, curlrc or TLS key-log variables from the user's shell.
    const env = isWin ? { SystemRoot: windowsDir() ?? process.env.SystemRoot } : {};
    const child = spawn(curlPath(), args, { windowsHide: true, env, stdio: ["pipe", "pipe", "ignore"] });
    live.children.add(child);
    const chunks = [];
    let total = 0;
    let failure = null;
    const stop = (message) => {
      failure ??= message;
      child.kill();
    };
    const timer = setTimeout(() => stop(UNREACHABLE), (MAX_TIME_S + 5) * 1000);
    child.stdout.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes + STATUS_LEN) return stop(tooLarge);
      chunks.push(chunk);
    });
    child.on("error", (e) => stop(/** @type {NodeJS.ErrnoException} */ (e).code === "ENOENT" ? "The system's curl is missing, so KAPEVault cannot reach R2." : UNREACHABLE));
    child.on("close", (code) => {
      clearTimeout(timer);
      live.children.delete(child);
      if (failure) return reject(new Error(failure));
      if (code === 63) return reject(new Error(tooLarge)); // curl's own --max-filesize stop
      const out = code === 0 ? parseOutput(Buffer.concat(chunks)) : null;
      if (!out) return reject(new Error(UNREACHABLE));
      resolve(out);
    });
    child.stdin.on("error", () => {}); // curl exiting early is reported by "close"
    child.stdin.end(config);
  });
}

module.exports = { carry, curlArgs, curlConfig, parseOutput, curlPath, cleanUp, sweepStale, TEMP_PREFIX };
