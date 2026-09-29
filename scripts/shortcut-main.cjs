// Run BY Electron (see install-shortcut.mjs): writes the Start menu shortcut so Windows Search,
// Start and taskbar pinning find KAPEVault. It points at this repo's electron.exe + the built app
// (dist/), carries build/icon.ico, and the same AppUserModelID as main.cjs so a pinned icon and
// the running window are one taskbar button.
const { app, shell } = require("electron");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const link = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "KAPEVault.lnk");

app.whenReady().then(() => {
  const ok = shell.writeShortcutLink(link, "create", { // create also overwrites; "replace" fails when none exists
    target: process.execPath,
    args: `"${repo}"`,
    cwd: repo,
    icon: path.join(repo, "build", "icon.ico"),
    iconIndex: 0,
    description: "KAPEVault - passwords and file links",
    appUserModelId: "com.brewedops.kapevault",
  });
  console.log(ok ? `Start menu shortcut written: ${link}` : "Could not write the shortcut");
  app.exit(ok ? 0 : 1);
});
