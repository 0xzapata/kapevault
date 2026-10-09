const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Measured 2026-10-10 on Electron 44.5.1 with a per-app WER LocalDumps entry for the exe name: a crash
// of the main or a page process with no crash reporter started ends the process (exit 0xFFFF7003) with
// no Windows dump and no Application Error event. With crashReporter.start (even uploadToServer false
// and ignoreSystemCrashHandler true) Crashpad wrote a 1.2 MB minidump (main) / 350 KB (page) into the
// user data folder, which holds process memory. So KAPEVault must never start the crash reporter.
test("no main-process file starts Electron's crash reporter", () => {
  const dir = __dirname;
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".cjs") && !f.endsWith(".test.cjs"));
  assert.ok(files.length > 20);
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), "utf8"), /crashReporter/, f);
});
