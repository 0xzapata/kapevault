const { app, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, nativeTheme, net, powerMonitor, protocol, safeStorage, session, shell, systemPreferences } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const hardening = require("./hardening.cjs");
const appProtocol = require("./app-protocol.cjs");
const { createVaultSession } = require("./vault-session.cjs");
const { createCloudBackup } = require("./cloud-backup.cjs");
const { createSync } = require("./sync.cjs");
const { sweepStale: sweepCourier } = require("./courier.cjs");
const { createAppSettings } = require("./app-settings.cjs");
const { createWindowsHello } = require("./windows-hello.cjs");
const { createTouchId } = require("./touch-id.cjs");
const { createAirWall } = require("./air-wall.cjs");
const { createUpdates } = require("./updates.cjs");
const { installFolderWriters } = require("./install-folder.cjs");
const { migrateLegacyData } = require("./legacy-data.cjs");
const { openerHtml, openerKey } = require("./opener.cjs");
const { createFolderCopy } = require("./folder-copy.cjs");
const { createClipboard } = require("./clipboard.cjs");
const { createUnlockThrottle } = require("./unlock-throttle.cjs");
const { parseVaultFile } = require("./vault-crypto.cjs");
const { createWindows } = require("./windows.cjs");
const { recycleRenderer } = require("./renderer-recycle.cjs");
const { createTrayIcon } = require("./tray.cjs");
const vaultIpc = require("./ipc/vault.cjs");
const biometricIpc = require("./ipc/biometric.cjs");
const backupIpc = require("./ipc/backup.cjs");
const restoreIpc = require("./ipc/restore.cjs");
const cloudIpc = require("./ipc/cloud.cjs");
const filesIpc = require("./ipc/files.cjs");
const settingsIpc = require("./ipc/settings.cjs");
const updatesIpc = require("./ipc/updates.cjs");
const licencesIpc = require("./ipc/licences.cjs");

const isMac = process.platform === "darwin";
const AUTO_LOCK_SECONDS = 5 * 60;
const CLIPBOARD_CLEAR_MS = 30 * 1000;
const BACKUP_DELAY_MS = 10 * 1000; // auto-backup waits for a pause in edits
const QUIT_WAIT_MS = 10 * 1000; // longest a last upload may hold up quitting on a stalled network
const QUICK_HOTKEY = "CommandOrControl+Shift+Space";
const START_HIDDEN = "--hidden"; // start with Windows: tray only, vault locked

hardening.refuseDebugging(app);

// Test/dev overrides only work unpacked, so a packaged build can never be pointed at another
// vault or another page. KAPEVAULT_DATA_DIR = throwaway vault for tests; KAPEVAULT_DEV_URL = Vite;
// KAPEVAULT_R2_ENDPOINT = a local fake R2 for tests; KAPEVAULT_BACKUP_DELAY_MS = shorter auto-backup wait;
// KAPEVAULT_BIOMETRIC_FAKE = approve|cancel stands in for Windows Hello / Touch ID;
// KAPEVAULT_AIRWALL_FAKE = on|off|other|unenforced stands in for the Air Wall firewall rule (no UAC, no network);
// KAPEVAULT_UPDATE_FAKE = newer|same|fail stands in for GitHub's answer to the opt-in update check (no network);
// KAPEVAULT_OCR_FAKE = label|blank|unavailable stands in for Windows OCR in "Scan a label";
// KAPEVAULT_AUTO_LOCK_SECONDS = idle lock for tests (Playwright's input is not OS input, so a long
// run on an idle PC would otherwise lock mid-test). KAPEVAULT_LEGACY_DIR = a stand-in for the old
// %APPDATA%\BOVault folder; a test vault never looks at the real one. KAPEVAULT_DEVICE_NAME = this
// install's name in sync (two test PCs on one machine); KAPEVAULT_SYNC_DELAY_MS = shorter wait after a save;
// KAPEVAULT_PHONE_CODE_SECONDS = how long Add a phone shows its code.
const devEnv = app.isPackaged ? {} : process.env;
hardening.blockNameLookups(app, devEnv.KAPEVAULT_DEV_URL);
const dataDir = devEnv.KAPEVAULT_DATA_DIR || app.getPath("userData");
fs.mkdirSync(dataDir, { recursive: true });
// A test run gets its own profile, so its single-instance lock never collides with the real app.
if (devEnv.KAPEVAULT_DATA_DIR) app.setPath("userData", dataDir);
// Two windows writing one vault file would clobber each other. exit() stops now; quit() is async.
// A second copy leaves before it touches any data. `--quit` (the reinstall script) makes the
// running copy quit through before-quit (backup flush, lock, clipboard clear); with none running
// it just exits, no window.
const askedToQuit = process.argv.includes("--quit");
if (!app.requestSingleInstanceLock(askedToQuit ? { quit: true } : undefined) || askedToQuit) app.exit(0);
// The command-line KAPEVault (cli/kapevault.cjs) refuses to write while this names a live app: this
// copy rewrites the whole vault from memory on its next save. Only the copy holding the lock writes it,
// in case a second copy runs on for a moment after exit(). A failed write only turns that check off.
const pidFile = path.join(dataDir, "app.pid");
try {
  if (app.hasSingleInstanceLock() && !askedToQuit) fs.writeFileSync(pidFile, String(process.pid));
} catch {
  // the CLI then writes while the app runs, as before this file existed
}
app.on("second-instance", (_event, _argv, _cwd, data) => (/** @type {any} */ (data)?.quit === true ? app.quit() : windows.showMain()));
const legacyDir = devEnv.KAPEVAULT_LEGACY_DIR || (devEnv.KAPEVAULT_DATA_DIR ? null : path.join(app.getPath("appData"), "BOVault"));
try {
  if (legacyDir) migrateLegacyData(dataDir, legacyDir);
} catch (e) {
  // Carrying on would offer to create a NEW vault over the user's real one. Stop instead.
  dialog.showErrorBox("KAPEVault could not open your vault", `Copying your vault from ${legacyDir} failed: ${e.message}\n\nNothing was changed. Close anything using that folder and start KAPEVault again.`);
  app.exit(1);
}
// A save backs up, and syncs a few seconds later - unless sync made it (sync.cjs).
const vault = createVaultSession(path.join(dataDir, "vault.kapevault"), {
  onPersist: ({ bySync }) => {
    cloud.schedule();
    folderCopy.schedule();
    if (!bySync) sync.afterSave();
  },
  installId: () => settings.installId(),
});
try {
  vault.settleStagedCopy(); // a replaced vault a restore left staged goes into the slot
} catch {
  // tried again before any write to the vault or the slot; the file stays on disk meanwhile
}
const settings = createAppSettings(dataDir);
const backupDelayMs = Number(devEnv.KAPEVAULT_BACKUP_DELAY_MS) || BACKUP_DELAY_MS;
const cloud = createCloudBackup({ vault, endpoint: devEnv.KAPEVAULT_R2_ENDPOINT, delayMs: backupDelayMs, installId: () => settings.installId(), opener: { key: openerKey(), html: () => openerHtml(app.getVersion()) } });
// Unlock, change master password and every restore: see unlock-throttle.cjs.
// A local guess is counted against the vault file's own KDF salt, so unlocking a restored backup never clears
// the misses at the vault it replaced (audit run-1 4.5).
const throttledUnlock = createUnlockThrottle({
  file: path.join(dataDir, "unlock-throttle.json"),
  ownSalt: () => {
    try {
      return parseVaultFile(fs.readFileSync(vault.status().path))?.kdf.salt ?? null;
    } catch {
      return null;
    }
  },
});
// Sync with this bucket's other devices. Its status goes to every window; a merge shows at once. A
// master password another device set, typed here, is a guess like any other (throttledUnlock); once
// adopted, the key Windows Hello / Touch ID holds no longer opens the vault.
const sync = createSync({
  vault,
  cloud,
  installId: () => settings.installId(),
  renewInstallId: () => settings.renewInstallId(),
  device: { name: devEnv.KAPEVAULT_DEVICE_NAME || os.hostname().replace(/\.local$/, ""), platform: process.platform },
  delayMs: Number(devEnv.KAPEVAULT_SYNC_DELAY_MS) || undefined,
  throttledUnlock: (attemptUnlock) => throttledUnlock(attemptUnlock, { local: false }),
  onStatus: (status) => broadcast("sync:status", status),
  onMerged: () => changed(vault.publicView()),
  onRekeyed: () => {
    lastMasterAt = Date.now();
    biometricKeyChanged();
  },
});
// Keep a copy in a folder: every window hears of each copy (the Settings row, the no-backup line).
const folderCopy = createFolderCopy({ vaultPath: vault.status().path, folder: settings.copyFolder, setFolder: settings.setCopyFolder, ownsFile: (bytes) => vault.ownsFile(bytes), version: app.getVersion(), delayMs: backupDelayMs, onStatus: (status) => broadcast("backup:folder", status) });
const fake = devEnv.KAPEVAULT_BIOMETRIC_FAKE || undefined;
// Windows Hello on Windows, Touch ID on a Mac - one interface, see windows-hello.cjs.
const biometric = isMac ? createTouchId({ dataDir, fake, safeStorage, systemPreferences }) : createWindowsHello({ dataDir, fake });
const BIOMETRIC_NAME = isMac ? "Touch ID" : "Windows Hello";
const installWriters = installFolderWriters({ packaged: app.isPackaged }); // read when the Security view asks, never awaited by an unlock
const airWall = createAirWall({ exePath: process.execPath, packaged: app.isPackaged, fake: devEnv.KAPEVAULT_AIRWALL_FAKE });
const updates = createUpdates({ settings, version: app.getVersion(), fake: devEnv.KAPEVAULT_UPDATE_FAKE });

hardening.registerFileScheme(protocol);
appProtocol.registerAppScheme(protocol);

let quitting = false;
let hotkeyOk = false;
let biometricPrompting = false; // the Hello / Touch ID prompt takes focus; quick search must not hide for it
// When the master password was last typed (create, unlock, change). Windows Hello re-enabled later
// starts from this date, not from "now".
let lastMasterAt = null;

// Our own taskbar identity, so Windows shows KAPEVault's icon instead of Electron's.
app.setAppUserModelId("com.brewedops.kapevault");

const windows = createWindows({
  settings,
  devEnv,
  isMac,
  resolvedTheme,
  isQuitting: () => quitting,
  biometricPrompting: () => biometricPrompting,
  onCloseToTray: () => {
    lockVault();
    tray.hintOnce();
  },
});
const tray = createTrayIcon({ vault, settings, isMac, hotkey: QUICK_HOTKEY, showMain: () => windows.showMain(), showQuick: () => windows.showQuick(), lockVault });
const clip = createClipboard({ clipboard, ClipboardItem, isMac, clearMs: CLIPBOARD_CLEAR_MS });

function broadcast(channel, ...args) {
  for (const w of windows.all()) w.webContents.send(channel, ...args);
}

// Lock and quit both: a waiting folder copy and backup go first (the backup still needs the R2
// keys, which the lock is about to wipe), then the vault locks. Neither flush can stop the lock.
// Returns the upload queue, for quit to wait on (bounded).
function flushAndLock() {
  try {
    folderCopy.flush();
  } catch {
    // the lock goes on; the next save copies it
  }
  let pending = Promise.resolve();
  try {
    pending = cloud.flush();
  } catch {
    // nothing waiting
  } finally {
    vault.lock();
  }
  return pending;
}

// reason travels with the event so the lock screen can say why. A page that loads again after the
// lock asks for it through vaultStatus (lockReason).
let lockReason;
// The last lock's renderer swap and how many have started: a test counts to see its lock began, then
// waits for the swap before driving the reloaded page.
let recycling = Promise.resolve();
let recycles = 0;
function lockVault(reason) {
  clip.clearCopiedPassword();
  if (!vault.status().unlocked) return;
  lockReason = reason;
  flushAndLock();
  sync.locked(); // a review waiting for the user goes with the key
  broadcast("vault:locked", reason);
  tray.updateMenu();
  // Every window gets a new renderer process, so nothing the page showed (a revealed password) stays
  // in memory after the lock. The pages come back at the lock screen, in the theme chosen now.
  recycles += 1;
  recycling = Promise.all(
    windows.all().map((w) =>
      recycleRenderer(w.webContents, {
        pids: () => app.getAppMetrics().map((m) => m.pid),
        freshUrl: (url) => {
          const next = new URL(url);
          next.searchParams.set("theme", resolvedTheme());
          return next.href;
        },
      }).catch(() => {}), // the lock is done; nothing here may throw into its callers
    ),
  ).then(() => {});
}

// A hard cap on one unlocked session, busy or not (default 8 hours). Timed on the monotonic clock,
// so changing the system clock cannot stretch it; checked every 15s and before every IPC call, so
// quick search cannot outlast it either. app-settings only ever holds one of SESSION_LIMIT_HOURS
// (default 8), so the value is used as it comes.
let unlockedAt = null;
function enforceSessionLimit() {
  const limitMs = settings.get().sessionLimitHours * 3600 * 1000;
  if (limitMs > 0 && unlockedAt !== null && performance.now() - unlockedAt >= limitMs) {
    unlockedAt = null;
    lockVault("session-limit");
  }
}

// Every window shows the same vault: one unlocking (or changing it) updates the others.
function unlocked(result) {
  if (result.ok) {
    lockReason = undefined;
    unlockedAt = performance.now();
    broadcast("vault:unlocked", result.vault);
    tray.updateMenu();
    tray.updateTip();
    cloud.onUnlocked(); // a backup still owed from before the lock (failed, or the app closed first) goes up
    sync.afterUnlock(); // never awaited: unlock does not wait on the network
  }
  return result;
}
const changed = (view) => (broadcast("vault:changed", view), tray.updateTip(), view);

// The page's URL is the app's own: app://kapevault, or the Vite dev server in an unpacked run. Compared
// as protocol + host because Node reports the origin of a custom scheme as "null".
function ownOrigin(url) {
  try {
    const u = new URL(url);
    const same = (base) => u.protocol === base.protocol && u.host === base.host;
    return same(new URL(appProtocol.APP_ORIGIN)) || (Boolean(devEnv.KAPEVAULT_DEV_URL) && same(new URL(/** @type {string} */ (devEnv.KAPEVAULT_DEV_URL))));
  } catch {
    return false;
  }
}
// Every IPC handler goes through here: only a KAPEVault window's own page may call, and the session
// limit is checked first. Errors: a mutation (a save, a delete, a copy) throws, and the page shows its
// own generic failure. A dialog or a network call answers through attempt() instead, because its
// failure has a reason the page shows (a cancelled pick, a refused key, R2 unreachable).
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    // The app page itself: a preview frame inside the same window (an untrusted file) never gets a handler.
    const frame = event.senderFrame;
    const own = (w) => event.sender === w.webContents && frame && frame.processId === w.webContents.mainFrame.processId && frame.routingId === w.webContents.mainFrame.routingId;
    if (!windows.all().some(own)) throw new Error("Unknown sender");
    // And it must still be on our own origin, so this does not rest on navigation blocking alone.
    if (!ownOrigin(/** @type {Electron.WebFrameMain} */ (frame).url)) throw new Error("Unknown sender");
    enforceSessionLimit();
    return fn(...args);
  });
}

// Failures come back as { ok: false, error } so the page can show the reason. needsConfirm: the page
// asks before a second try (a restore that can keep no copy of the vault it replaces).
async function attempt(fn) {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    return { ok: false, error: e.message, ...(e.needsConfirm && { needsConfirm: true }) };
  }
}

// The IPC calls that need the vault open (a copy, the kept copies, the folder copy, Scan a label).
function requireUnlocked() {
  if (!vault.status().unlocked) throw new Error("Unlock the vault first.");
}

// A kept copy's info for display only: one that cannot be read right now is not shown this time.
// Deleting or restoring it reads the info itself and stops on that error.
function shownCopy(info) {
  try {
    return info();
  } catch {
    return null;
  }
}

// replacedCopy: the vault the last restore replaced, kept beside this one - when and how big, never where.
function vaultStatus() {
  const copy = shownCopy(vault.replacedCopyInfo);
  return { ...vault.status(), lockReason, replacedCopy: copy && { at: copy.at, size: copy.size } };
}

// A kept copy (the replaced vault, the old BOVault vault) may be the only copy of someone's real
// vault, so it is deleted only with ITS OWN master password, throttled like any other guess. Unlocked
// is not proof: anyone at the keyboard can restore a file of their own at the lock screen and be
// unlocked in it, with the real vault now in the copy.
async function proveOwnsCopy(file, master) {
  // salt: the copy's own, so these guesses count against that file (audit run-1 4.5 follow-up).
  let salt;
  try {
    salt = parseVaultFile(fs.readFileSync(file))?.kdf.salt;
  } catch {
    // unreadable: counted as a guess at another, unnamed file
  }
  const proof = await throttledUnlock(() => vault.proveCopy(file, String(master ?? "")), { local: false, salt });
  if (!proof.ok) throw new Error(proof.error);
}

// The vault key changed (a restore, a master password change), so the key Windows Hello / Touch ID
// holds no longer opens it. A disable the disk refuses is not lost: the record is stale, which
// Settings shows, and the next master password unlock removes it (touchMaster).
async function biometricKeyChanged() {
  await biometric.disable().catch(() => {});
}

const setLastMasterAt = (t) => {
  lastMasterAt = t;
};
vaultIpc.register({ handle, attempt, requireUnlocked, vault, biometric, sync, clip, changed, unlocked, lockVault, throttledUnlock, setLastMasterAt, biometricKeyChanged, vaultStatus, windows, isMac, devEnv });
biometricIpc.register({
  handle,
  attempt,
  vault,
  biometric,
  biometricName: BIOMETRIC_NAME,
  biometricKeyChanged,
  unlocked,
  lastMasterAt: () => lastMasterAt,
  setLastMasterAt,
  setPrompting: (on) => {
    biometricPrompting = on;
  },
  windows,
});
backupIpc.register({ handle, attempt, requireUnlocked, vault, folderCopy, windows });
restoreIpc.register({ handle, attempt, requireUnlocked, vault, cloud, sync, folderCopy, throttledUnlock, proveOwnsCopy, vaultStatus, clearCopiedPassword: clip.clearCopiedPassword, setLastMasterAt, changed, unlocked, biometricKeyChanged, windows, isMac });
cloudIpc.register({ handle, attempt, vault, cloud, sync, broadcast, devEnv });
filesIpc.register({ handle, vault });
settingsIpc.register({ handle, attempt, requireUnlocked, settings, airWall, installWriters, applySettings, hotkey: QUICK_HOTKEY, hotkeyOk: () => hotkeyOk, legacyDir, devEnv, shownCopy, proveOwnsCopy, windows });
updatesIpc.register({ handle, updates, openExternal: (page) => shell.openExternal(page) });
licencesIpc.register({ handle, app, resourcesPath: process.resourcesPath, root: path.join(__dirname, "..") });

// The theme the page draws: "system" follows the OS light/dark setting. nativeTheme also turns the
// window material (acrylic / vibrancy) and the Windows caption buttons dark or light to match.
function resolvedTheme() {
  const { theme } = settings.get();
  if (theme === "system") return nativeTheme.shouldUseDarkColors ? "dark" : "classic";
  return theme;
}

const broadcastTheme = () => windows.setTheme(resolvedTheme());

function applySettings() {
  const s = settings.get();
  nativeTheme.themeSource = s.theme === "system" ? "system" : s.theme === "dark" ? "dark" : "light";
  broadcastTheme();
  windows.protectFromCapture();
  globalShortcut.unregisterAll();
  hotkeyOk = false;
  if (s.quickSearch) {
    try {
      hotkeyOk = globalShortcut.register(QUICK_HOTKEY, windows.toggleQuick);
    } catch {
      hotkeyOk = false; // another app holds it
    }
  }
  // Only the installed app registers itself - a dev run would point Windows at electron.exe.
  if (app.isPackaged) app.setLoginItemSettings(/** @type {Electron.Settings} */ ({ openAtLogin: s.startWithWindows, openAsHidden: true, args: [START_HIDDEN] }));
}

hardening.lockDownWebContents(app);

app.whenReady().then(async () => {
  await hardening.hardenSession({ session, protocol, net, devUrl: devEnv.KAPEVAULT_DEV_URL, linkedFolders: () => vault.linkedFolders() });
  appProtocol.handleAppScheme(protocol, path.join(__dirname, "..", "dist")); // the page itself, before any window loads it
  sweepCourier(); // bodies a hard kill left behind
  tray.create();
  applySettings();
  updates.start(); // asks only while the opt-in switch is on, at most once a day
  nativeTheme.on("updated", broadcastTheme); // the OS flipped light/dark while on "system"
  // Tests cannot press a global hotkey or wait hours for the session limit; an unpacked test run gets
  // the same entry points instead.
  if (devEnv.KAPEVAULT_DATA_DIR) {
    globalThis.__kapevaultToggleQuick = windows.toggleQuick;
    globalThis.__kapevaultLock = lockVault; // (reason)
    globalThis.__kapevaultRecycled = () => recycling;
    globalThis.__kapevaultRecycles = () => recycles;
  }
  windows.createWindow({ show: !process.argv.includes(START_HIDDEN) });
  powerMonitor.on("lock-screen", () => lockVault());
  powerMonitor.on("suspend", () => lockVault());
  setInterval(() => {
    if (powerMonitor.getSystemIdleTime() >= (Number(devEnv.KAPEVAULT_AUTO_LOCK_SECONDS) || AUTO_LOCK_SECONDS)) lockVault();
    enforceSessionLimit();
  }, 15 * 1000);
});

// macOS: clicking the Dock icon brings the window back.
app.on("activate", () => windows.showMain());

// Only reached when quick search is off (otherwise the window hides instead of closing).
app.on("window-all-closed", () => {
  if (!quitting) app.quit();
});

// Before quitting: a waiting backup goes up (bounded), the vault locks, a copied password clears.
let shutdownDone = false;
app.on("before-quit", (e) => {
  quitting = true;
  if (shutdownDone) return;
  e.preventDefault();
  const pending = flushAndLock();
  globalShortcut.unregisterAll();
  Promise.race([Promise.resolve(pending).catch(() => {}), new Promise((r) => setTimeout(r, QUIT_WAIT_MS))])
    .then(() => clip.clearCopiedPassword())
    .finally(() => {
      shutdownDone = true;
      fs.rmSync(pidFile, { force: true });
      tray.destroy();
      app.quit();
    });
});
