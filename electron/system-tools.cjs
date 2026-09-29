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

// Every PowerShell run: no profile, no prompts, and the script travels inline (-EncodedCommand).
const PS_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];

// -EncodedCommand takes the script as base64 of its UTF-16LE text, so no quoting reaches the command line.
const encodeCommand = (script) => Buffer.from(script, "utf16le").toString("base64");

// Runs a script and resolves with the last line of its output that is a JSON object. stdin: text for
// the script's standard input (never a temp file). Rejects on a spawn failure, on output with no JSON
// line, or when timeoutMs runs out - `timedOut` on the error tells that one apart.
function runPsJson({ script, stdin, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const args = [...PS_ARGS, "-EncodedCommand", encodeCommand(script)];
    const child = execFile(powershellPath(), args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: "utf8" }, (err, stdout) => {
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
    if (stdin !== undefined) {
      child.stdin.on("error", () => {}); // a script that exits early closes stdin; the callback reports it
      child.stdin.end(stdin);
    }
  });
}

module.exports = { system32, powershellPath, windowsDir, sameDir, canElevate, PS_ARGS, encodeCommand, runPsJson };
