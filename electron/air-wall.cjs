// Air Wall: an outbound Windows Firewall rule that blocks KAPEVault.exe from the internet. Every
// KAPEVault process (main, page, GPU, utility) runs from that one exe, so "local only" is enforced by
// Windows instead of promised. Cloud backup keeps working: R2 requests go out through the system
// curl (courier.cjs), carrying only signed headers and the encrypted file.
const net = require("node:net");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { system32, powershellPath, canElevate, PS_ARGS, encodeCommand } = require("./system-tools.cjs");

const RULE = "KAPEVault Air Wall";
const PROBE = { host: "1.1.1.1", port: 443, timeoutMs: 3000 };
const PROMPT_MS = 10 * 60_000; // the UAC prompt waits for the user; one left open past this is still read back
const CANCELLED = 1223; // ERROR_CANCELLED: the UAC prompt was dismissed
const WRONG_WINDOWS = "Something on this PC points to the wrong Windows folder, so KAPEVault did not ask for admin rights.";
const FAKE_OTHER = "C:\\Users\\Mock\\AppData\\Local\\Programs\\kapevault-old\\KAPEVault.exe";

// netsh writes a single-byte console code page, read here byte for byte (latin1), so a non-ASCII
// letter in a path comes back as some other character: those positions compare loosely.
const pathKey = (p) => path.win32.normalize(p).toLowerCase().replace(/[^\x20-\x7e]/g, "?");
const samePath = (a, b) => pathKey(a) === pathKey(b);

// Only a rule that blocks everything counts: enabled, outbound, every profile, address and protocol.
const blocksAll = (r) =>
  r.Enabled === "Yes" && r.Direction === "Out" && r.Action === "Block" && r.Profiles === "Domain,Private,Public" && r.RemoteIP === "Any" && r.Protocol === "Any" && !!r.Program;

// `netsh advfirewall show currentprofile state`: a rule only works while the firewall is ON for every
// network in use (a third-party firewall turns Windows Firewall off).
function firewallOn(output) {
  const states = [...output.matchAll(/^State\s+(ON|OFF)\s*$/gm)].map((m) => m[1]);
  return states.length > 0 && states.every((s) => s === "ON");
}

// `netsh advfirewall firewall show rule name=... verbose` output -> { state: "on" } when it blocks
// this exe, { state: "other", program } when it blocks another copy, else { state: "off" }.
function parseRuleStatus(output, exePath) {
  const rules = output
    .split(/^Rule Name:/m)
    .slice(1)
    .map((block) => Object.fromEntries(block.split(/\r?\n/).flatMap((line) => {
      const m = /^([A-Za-z ]+):\s+(.*)$/.exec(line.trim());
      return m ? [[m[1], m[2].trim()]] : [];
    })));
  const blocking = rules.filter(blocksAll);
  if (blocking.some((r) => samePath(r.Program, exePath))) return { state: "on" };
  if (blocking.length) return { state: "other", program: blocking[0].Program };
  return { state: "off" };
}

// PowerShell single-quoted literal. PowerShell also treats the curly quotes as quote marks.
const psQuote = (s) => `'${String(s).replace(/['\u2018\u2019\u201A\u201B]/g, "$&$&")}'`;

// The elevated part: always clear our rule first, so turning on also moves a rule left by another
// copy (an old install folder) onto this exe. Every argument is a quoted literal - nothing is parsed.
function ruleScript(on, exePath) {
  const netsh = (...args) => `& ${[system32("netsh.exe"), "advfirewall", "firewall", ...args].map(psQuote).join(" ")} | Out-Null`;
  const lines = [netsh("delete", "rule", `name=${RULE}`)];
  if (on) lines.push(netsh("add", "rule", `name=${RULE}`, "dir=out", "action=block", `program=${exePath}`, "enable=yes", "profile=any"));
  lines.push("exit $LASTEXITCODE");
  return lines.join("\n");
}

// Starts the rule script through ONE UAC prompt and waits for it. Its exit code is the script's, or
// the Windows error that stopped the prompt (1223 = cancelled).
function launcherScript(inner) {
  const args = `${PS_ARGS.join(" ")} -WindowStyle Hidden -EncodedCommand ${encodeCommand(inner)}`;
  return [
    "$psi = New-Object System.Diagnostics.ProcessStartInfo",
    `$psi.FileName = ${psQuote(powershellPath())}`,
    `$psi.Arguments = ${psQuote(args)}`,
    "$psi.Verb = 'runas'",
    "$psi.UseShellExecute = $true",
    "$psi.WindowStyle = 'Hidden'",
    "try { $p = [System.Diagnostics.Process]::Start($psi) } catch {",
    "  $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }",
    "  if ($e -is [System.ComponentModel.Win32Exception]) { exit $e.NativeErrorCode }; exit 1",
    "}",
    "$p.WaitForExit()",
    "exit $p.ExitCode",
  ].join("\n");
}

function runElevated(inner) {
  if (!canElevate()) return Promise.reject(new Error(WRONG_WINDOWS)); // see system-tools.cjs
  const args = [...PS_ARGS, "-EncodedCommand", encodeCommand(launcherScript(inner))];
  return new Promise((resolve) => {
    execFile(powershellPath(), args, { windowsHide: true, timeout: PROMPT_MS }, (err) => resolve(err ? (Number.isInteger(err.code) ? err.code : -1) : 0));
  });
}

function readRule() {
  return readNetsh(["firewall", "show", "rule", `name=${RULE}`, "verbose"], /^Rule Name:/m, 1); // 1 = "No rules match"
}

function readProfiles() {
  return readNetsh(["show", "currentprofile", "state"], /^State\s/m);
}

// Unelevated netsh read. Output that does not look like English netsh (another display language)
// is refused rather than guessed at. emptyCode: the exit code that means "nothing there".
function readNetsh(args, looksRight, emptyCode) {
  return new Promise((resolve, reject) => {
    execFile(system32("netsh.exe"), ["advfirewall", ...args], { windowsHide: true, timeout: 20_000, encoding: "latin1" }, (err, stdout) => {
      if (looksRight.test(stdout)) return resolve(stdout);
      if (emptyCode && err?.code === emptyCode) return resolve("");
      reject(new Error("Could not read the Windows Firewall rules."));
    });
  });
}

// A firewall block fails the connect at once with EACCES; anything else (a timeout, no route) means
// the test could not tell.
const probeResult = (code) => (code === "EACCES" || code === "EPERM" ? "blocked" : "offline");

// One outbound TCP connection, nothing sent: "open" | "blocked" | "offline".
function probe({ host, port, timeoutMs } = PROBE) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => done("offline"));
    socket.once("connect", () => done("open"));
    socket.once("error", (e) => done(probeResult(e.code)));
  });
}

// exePath: process.execPath. packaged: app.isPackaged - an unpacked run is electron.exe, which the
// rule must never target. fake: on|off|other (unpacked test runs only) stands in for Windows.
function createAirWall({ exePath, packaged, platform = process.platform, fake, deps = { runElevated, readRule, readProfiles, probe } }) {
  const faking = ["on", "off", "other", "unenforced"].includes(fake);
  const available = platform === "win32" && (faking || packaged);
  let fakeState = fake;
  let busy = false;

  // on | unenforced (the rule is there, the firewall is off) | other (another copy's rule) | off
  async function status() {
    if (platform !== "win32") return { available: false, reason: "platform" };
    if (faking) return { available: true, state: fakeState, ...(fakeState === "other" && { program: FAKE_OTHER }) };
    if (!packaged) return { available: false, reason: "unpacked" };
    const rule = parseRuleStatus(await deps.readRule(), exePath);
    if (rule.state === "on" && !firewallOn(await deps.readProfiles())) return { available: true, state: "unenforced" };
    return { available: true, ...rule };
  }

  async function set(on) {
    if (!available) throw new Error("Only the installed app can be walled off.");
    if (busy) throw new Error("Already waiting for Windows.");
    busy = true;
    try {
      if (faking) {
        fakeState = on ? "on" : "off";
        return status();
      }
      const code = await deps.runElevated(ruleScript(on, exePath));
      const now = await status();
      if (on ? ["on", "unenforced"].includes(now.state) : now.state === "off") return now;
      if (code === CANCELLED) throw new Error("The Windows prompt was cancelled, so nothing changed.");
      throw new Error(on ? "Windows did not add the firewall rule." : "Windows did not remove the firewall rule.");
    } finally {
      busy = false;
    }
  }

  // Only ever runs on the user's click.
  async function test() {
    if (!available) throw new Error("Only the installed app can be walled off.");
    if (faking) return fakeState === "on" ? "blocked" : "open";
    return deps.probe();
  }

  return { status, set, test };
}

module.exports = { createAirWall, parseRuleStatus, firewallOn, ruleScript, runElevated, psQuote, probe, probeResult, RULE };
