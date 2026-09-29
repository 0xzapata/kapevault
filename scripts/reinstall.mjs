// npm run reinstall - update the INSTALLED KAPEVault on this PC to the current code:
// build the Setup exe, close the running app (the vault locks), install silently, reopen it from
// the Start menu, and confirm the installed app.asar is the one just built. The vault itself
// (%APPDATA%\KAPEVault) is never touched.
import { execFileSync, execSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const local = process.env.LOCALAPPDATA;
const setup = path.join(local, "KAPEVault-build", `KAPEVault Setup ${version}.exe`);
const exe = path.join(local, "Programs", "kapevault", "KAPEVault.exe");
const asar = path.join(local, "Programs", "kapevault", "resources", "app.asar");
const shortcut = path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "KAPEVault.lnk");
const QUIT_WAIT_MS = 15_000;
const ps = (command) => execFileSync("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8" }).trim();
const appCount = () => Number(ps("(Get-Process KAPEVault -ErrorAction SilentlyContinue).Count"));

execSync("npm run installer", { stdio: "inherit" });
const builtAt = fs.statSync(setup).mtimeMs;

// Close the running app the normal way, so its quit path runs (the waiting backup goes up, a copied
// password leaves the clipboard): `KAPEVault.exe --quit` reaches it as a second instance. Forced only
// if it is still running after the wait.
if (appCount() > 0) {
  spawn(exe, ["--quit"], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  const until = Date.now() + QUIT_WAIT_MS;
  while (appCount() > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
  if (appCount() > 0) {
    console.warn(`KAPEVault did not close within ${QUIT_WAIT_MS / 1000}s, so it is being forced closed: a waiting backup may not have gone up, and a copied password may still be on the clipboard.`);
    ps("Get-Process KAPEVault -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 1");
  }
}
execFileSync(setup, ["/S"]); // one-click NSIS: /S installs silently and waits
spawnSync("explorer.exe", [shortcut]); // clean env like a Start click; explorer exits 1 even on success
await new Promise((r) => setTimeout(r, 6000));

const running = appCount();
const fresh = fs.statSync(asar).mtimeMs >= builtAt - 120_000;
console.log(`installed ${version} | app.asar from this build: ${fresh} | KAPEVault processes: ${running}`);
if (!fresh || running === 0) process.exit(1);
