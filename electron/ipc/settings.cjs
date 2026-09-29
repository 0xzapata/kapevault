// App preferences (not secrets), the old BOVault copy, Air Wall, and the quick search window.
const { app } = require("electron");
const { SESSION_LIMIT_HOURS } = require("../app-settings.cjs");
const { oldCopyInfo, removeOldCopy, oldInstallPath } = require("../legacy-data.cjs");

// applySettings: main's, run after every change. hotkeyOk: whether the quick search hotkey registered.
function register({ handle, attempt, requireUnlocked, vault, settings, airWall, applySettings, hotkey, hotkeyOk, legacyDir, devEnv, shownCopy, proveOwnsCopy, windows }) {
  // oldCopy: BOVault's vault, still in its old folder after the carry-over ({ path, modifiedAt } | null).
  // oldInstall: BOVault.exe still installed - it keeps its own Ctrl+Shift+Space (Windows only; a path
  // or null). A test run looks at neither real one.
  const appSettings = () => ({
    ...settings.get(),
    hotkey,
    hotkeyOk: hotkeyOk(),
    canStartWithOs: app.isPackaged,
    sessionLimitOptions: SESSION_LIMIT_HOURS,
    oldCopy: legacyDir ? shownCopy(() => oldCopyInfo(legacyDir)) : null,
    oldInstall: devEnv.KAPEVAULT_DATA_DIR ? null : oldInstallPath(),
  });
  handle("app:getSettings", () => appSettings());
  handle("app:setSettings", (patch) => {
    settings.set(patch);
    applySettings();
    return appSettings();
  });
  // BOVault's old folder is the last fallback copy of the vault: removed only on the page's confirm with
  // the OLD vault's master password (proveOwnsCopy), and only while this vault is unlocked (so the vault
  // that replaces it exists and opens). A forgotten old password: the folder can be deleted by hand.
  handle("app:removeOldCopy", (master) =>
    attempt(async () => {
      requireUnlocked();
      if (!legacyDir) return { settings: appSettings() };
      const old = oldCopyInfo(legacyDir);
      if (old) await proveOwnsCopy(old.path, master);
      removeOldCopy(legacyDir);
      return { settings: appSettings() };
    }),
  );

  // Air Wall: a Windows Firewall rule that keeps this exe off the internet (the page asks, Windows
  // prompts). Test touches the network only when clicked.
  handle("airwall:status", () => attempt(async () => ({ status: await airWall.status() })));
  handle("airwall:set", (on) => attempt(async () => ({ status: await airWall.set(Boolean(on)) })));
  handle("airwall:test", () => attempt(async () => ({ result: await airWall.test() })));

  // Quick search window.
  handle("quick:hide", () => windows.quick()?.hide());
  // "Show in KAPEVault" from quick search: bring the main window up on that item.
  handle("quick:showInMain", (id) => {
    windows.quick()?.hide();
    windows.showMain();
    windows.main()?.webContents.send("vault:reveal", String(id));
  });
}

module.exports = { register };
