// Step of `npm run installer` (after check-fuses) and of CI's Windows job: starts the BUILT
// win-unpacked/KAPEVault.exe and exits 1 unless (1) a launch with a refused switch exits 1 at once, and
// (2) a plain launch is still running after a few seconds. Why: every test runs the app unpacked, where
// app.isPackaged is false and the packaged-only guards never run. From 2026-10-04 to 2026-10-09 every
// packaged build exited at startup (hardening refused a switch Electron adds by itself) and nothing saw
// it until the installer was run by hand.
//
// A packaged build ignores KAPEVAULT_DATA_DIR, so (2) uses this PC's real KAPEVault profile: it only
// opens to the lock screen and is closed again. With KAPEVault already running, the single-instance lock
// would make (2) prove nothing, so it is skipped with a line saying so (CI never has one running).
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
const dir = pkg.build.directories.output.replace(/\$\{env\.(\w+)\}/g, (_, name) => process.env[name] ?? "");
const exe = path.join(dir, "win-unpacked", `${pkg.build.productName}.exe`);
const STAY_MS = 8000;

if (process.platform !== "win32") {
  console.log("packaged-smoke: Windows only, skipped");
  process.exit(0);
}
if (!fs.existsSync(exe)) {
  console.error(`packaged-smoke: no built exe at ${exe}`);
  process.exit(1);
}

const imageName = `${pkg.build.productName}.exe`;
const running = () => execFileSync("tasklist", ["/fi", `imagename eq ${imageName}`, "/fo", "csv", "/nh"], { encoding: "utf8" }).includes(imageName);
// A clean environment for the child: a VS Code terminal exports ELECTRON_RUN_AS_NODE (the fuse ignores
// it in a packaged build, but the smoke test should start the app the way a double-click does).
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ELECTRON_RUN_AS_NODE"));

function launch(args) {
  const child = spawn(exe, args, { env, stdio: "ignore", windowsHide: true });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, exited };
}

let failed = 0;

const refused = launch(["--remote-debugging-port=0"]);
const refusedCode = await Promise.race([refused.exited, new Promise((r) => setTimeout(() => r("still running"), STAY_MS))]);
if (refusedCode === 1) console.log("ok   a launch with --remote-debugging-port exits 1");
else {
  console.error(`FAIL a launch with --remote-debugging-port did not exit 1 (${refusedCode})`);
  if (refusedCode === "still running") execFileSync("taskkill", ["/pid", String(refused.child.pid), "/t", "/f"]);
  failed += 1;
}

if (running()) {
  console.log(`skip a plain launch stays up: ${imageName} is already running (close it to run this check)`);
} else {
  const plain = launch([]);
  const early = await Promise.race([plain.exited, new Promise((r) => setTimeout(() => r(null), STAY_MS))]);
  if (early === null) console.log(`ok   a plain launch is still running after ${STAY_MS / 1000}s`);
  else {
    console.error(`FAIL a plain launch exited with ${early} within ${STAY_MS / 1000}s - the packaged app does not start`);
    failed += 1;
  }
  // The whole tree: the GPU, renderer and utility processes go with it.
  if (early === null) execFileSync("taskkill", ["/pid", String(plain.child.pid), "/t", "/f"], { stdio: "ignore" });
}

process.exit(failed ? 1 : 0);
