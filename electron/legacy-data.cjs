// One-time carry-over from BOVault, this app's name until 2026-09-26. The data folder follows the
// product name (%APPDATA%\KAPEVault), so without this the renamed app would open to an empty vault.
// On the FIRST start with no vault here, the old folder's vault and settings are COPIED in; the old
// folder is never changed by this, so it stays a fallback copy until the user deletes it on purpose
// (removeOldCopy, after a confirm). Windows Hello / Touch ID are not carried over (their keys are
// named after the app) - they are turned on again in Settings.
const fs = require("node:fs");
const path = require("node:path");
const { writeFileAtomic } = require("./atomic-write.cjs");

const LEGACY_VAULT = "vault.bovault";
const CARRIED_OVER = "bovault-carried-over"; // in the new folder: the first start has happened
// What BOVault itself wrote into its folder (and the fixed temp names it used). Electron's own
// browser data sits beside them and is not ours to delete.
const OLD_FILES = [LEGACY_VAULT, "settings.json", "hello.json", "touchid.json"].flatMap((name) => [name, `${name}.tmp`]);

// Returns true when the old vault was copied in. Only ever on the first start: after that a missing
// vault.kapevault means a new vault, never the old one coming back (it may still open with an old,
// maybe leaked, master password).
function migrateLegacyData(dataDir, legacyDir) {
  const marker = path.join(dataDir, CARRIED_OVER);
  if (fs.existsSync(marker)) return false;
  const vaultFile = path.join(dataDir, "vault.kapevault");
  const legacyVault = path.join(legacyDir, LEGACY_VAULT);
  const copy = !fs.existsSync(vaultFile) && fs.existsSync(legacyVault);
  if (copy) {
    // Settings first (install id, theme, window), the vault last under its final name: a start that
    // dies half way just runs this again, and never leaves half a vault.
    const settings = path.join(legacyDir, "settings.json");
    if (fs.existsSync(settings)) writeFileAtomic(path.join(dataDir, "settings.json"), fs.readFileSync(settings));
    writeFileAtomic(vaultFile, fs.readFileSync(legacyVault));
  }
  writeFileAtomic(marker, "");
  return copy;
}

// The old vault, while it is still there, so the page can offer to delete it. null only when it is
// gone: a delete skips the password proof for a missing copy, so any other stat error is thrown.
function oldCopyInfo(legacyDir) {
  const file = path.join(legacyDir, LEGACY_VAULT);
  try {
    return { path: file, modifiedAt: fs.statSync(file).mtimeMs };
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw new Error("The old BOVault vault cannot be read right now. Try again in a moment.");
  }
}

// Only on the user's confirmed request, never by itself. The folder goes too if nothing else is left.
function removeOldCopy(legacyDir) {
  for (const name of OLD_FILES) fs.rmSync(path.join(legacyDir, name), { force: true });
  try {
    fs.rmdirSync(legacyDir);
  } catch {
    // not empty (Electron's own data) or already gone: left as it is
  }
}

// A BOVault still installed keeps its own Ctrl+Shift+Space. electron-builder's one-click, per-user
// installer puts an app in %LOCALAPPDATA%\Programs\<package name> (BOVault's was "bovault") with
// <productName>.exe inside. null when there is none.
function oldInstallPath(localAppData = process.env.LOCALAPPDATA) {
  if (process.platform !== "win32" || !localAppData) return null;
  const exe = path.join(localAppData, "Programs", "bovault", "BOVault.exe");
  return fs.existsSync(exe) ? exe : null;
}

module.exports = { migrateLegacyData, oldCopyInfo, removeOldCopy, oldInstallPath };
