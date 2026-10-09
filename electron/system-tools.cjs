// The OS's own programs, always by full path - never a PATH lookup, so a planted exe with the same
// name (powershell.exe, curl.exe, netsh.exe) in the working folder or on PATH cannot stand in.
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

// Where Windows really is, read once from the kernel's own \SystemRoot link. The SystemRoot
// environment variable is only what the parent process (or the user's saved environment) says.
// null off Windows, or when the link cannot be read.
let trusted;
function windowsDir() {
  if (trusted === undefined) {
    try {
      trusted = process.platform === "win32" ? fs.realpathSync.native("\\\\?\\GLOBALROOT\\SystemRoot").replace(/^\\\\\?\\/, "") : null;
    } catch {
      trusted = null;
    }
  }
  return trusted;
}

// "C:\WINDOWS" and "c:\Windows\" are one folder.
const dirKey = (p) => path.win32.normalize(String(p)).replace(/\\+$/, "").toLowerCase();
const sameDir = (a, b) => Boolean(a && b) && dirKey(a) === dirKey(b);

// Elevation only when the environment agrees with Windows itself: a SystemRoot pointing anywhere
// else means someone is steering this process, and a UAC prompt must never follow their lead.
const canElevate = (envDir = process.env.SystemRoot, realDir = windowsDir()) => sameDir(envDir, realDir);

// Never the environment's SystemRoot, which any parent process sets: the kernel's link, else the default.
const system32 = (...parts) => path.join(windowsDir() || "C:\\Windows", "System32", ...parts);

const powershellPath = () => system32("WindowsPowerShell", "v1.0", "powershell.exe");

// --- PowerShell bridge (Windows Hello, Scan a label, Air Wall) ------------------------------------

// Every PowerShell run: no profile, no prompts. No -ExecutionPolicy: it governs script FILES, and
// every script here travels as command text (measured under AllSigned and Restricted: the same
// output and exit code), so "Bypass" would only be a flag that antivirus rules look for.
const PS_ARGS = ["-NoProfile", "-NonInteractive"];

// -EncodedCommand takes the script as base64 of its UTF-16LE text, so no quoting reaches the command line.
const encodeCommand = (script) => Buffer.from(script, "utf16le").toString("base64");

// The environment PowerShell and WinRT get: the profile and temp folders they work in, and Windows
// itself from the kernel's link (windowsDir) - not whatever the parent holds. COR_ENABLE_PROFILING /
// COR_PROFILER_PATH would load any DLL into the process that handles the Hello signature, and
// PSModulePath and __PSLockdownPolicy steer which modules load and which language mode runs. The same
// idea as the curl environment in courier.cjs. Measured: Hello's `supported` and Add-Type run on
// SystemRoot alone; the rest is what a profile-bound WinRT call may look up. PSModuleAnalysisCachePath
// only says where the list of module commands is cached (it loads nothing): a machine image that
// pre-builds it, as GitHub's Windows runner does, otherwise pays 13-36 s per run rebuilding it.
const PS_ENV_KEEP = ["windir", "SystemDrive", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "USERNAME", "PSModuleAnalysisCachePath"];
/** @param {Record<string, string>} [extra] variables only this run needs */
function psEnv(extra = {}) {
  /** @type {Record<string, string>} */
  const env = { SystemRoot: windowsDir() ?? process.env.SystemRoot ?? "" };
  for (const name of PS_ENV_KEEP) if (process.env[name] !== undefined) env[name] = /** @type {string} */ (process.env[name]);
  return { ...env, ...extra };
}

// How a script reaches PowerShell. By default it is the command text on stdin (`-Command -`): readable
// code, no base64 on the command line. A caller that needs stdin for DATA (the OCR photo, kept out of
// script-block logs by never being script text) sends the script encoded instead. The host treats stdin
// like a console: it runs each statement once its lines are complete (a `try {...}` would run alone
// before a `catch` on the next line), and a multi-line statement only runs after a blank line
// (measured: without it the script silently does nothing). So the whole script goes in as ONE block,
// followed by a blank line.
function psInvocation(script, stdin) {
  return stdin === undefined ? { args: [...PS_ARGS, "-Command", "-"], input: `& {\n${script}\n}\n\n` } : { args: [...PS_ARGS, "-EncodedCommand", encodeCommand(script)], input: stdin };
}

// Runs a script and resolves with the last line of its output that is a JSON object. stdin: text for
// the script's standard input (never a temp file). env: extra variables for this run (psEnv). Rejects
// on a spawn failure, on output with no JSON line, or when timeoutMs runs out - `timedOut` on the
// error tells that one apart.
/** @param {{ script: string, stdin?: string, env?: Record<string, string>, timeoutMs: number }} options */
function runPsJson({ script, stdin, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const { args, input } = psInvocation(script, stdin);
    const child = execFile(powershellPath(), args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: "utf8", env: psEnv(env) }, (err, stdout) => {
      const line = String(stdout || "").trim().split(/\r?\n/).filter((l) => l.trim().startsWith("{")).pop();
      if (line) {
        try {
          return resolve(JSON.parse(line));
        } catch {
          // fall through
        }
      }
      const timedOut = Boolean(err && err.killed);
      reject(Object.assign(new Error(timedOut ? "PowerShell timed out" : "PowerShell gave no answer"), { timedOut }));
    });
    /** @type {import("node:stream").Writable} */ (child.stdin).on("error", () => {}); // a script that exits early closes stdin; the callback reports it
    /** @type {import("node:stream").Writable} */ (child.stdin).end(input);
  });
}

module.exports = { system32, powershellPath, windowsDir, sameDir, canElevate, PS_ARGS, PS_ENV_KEEP, encodeCommand, psEnv, psInvocation, runPsJson };
