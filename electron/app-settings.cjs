// App preferences that are not secrets (quick search on/off, start with Windows, screen capture, one-time hints).
// Plain JSON beside the vault: nothing here says anything about what the vault holds.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { writeFileAtomic } = require("./atomic-write.cjs");
const { readFileRetry } = require("./read-retry.cjs");
const { isNetworkPath } = require("./file-access.cjs");

const DEFAULTS = {
  quickSearch: true, // Ctrl+Shift+Space; also keeps KAPEVault in the tray when the window closes
  startWithWindows: false,
  trayHintShown: false,
  theme: "system", // system | classic | dark | colorblind | contrast
  sessionLimitHours: 8, // one of SESSION_LIMIT_HOURS; 0 = no limit
  hideFromCapture: true, // off: screenshots, recordings and screen sharing see the windows
  checkForUpdates: false, // opt-in: asks GitHub once a day whether a newer KAPEVault is out (updates.cjs)
};

const THEMES = ["system", "classic", "dark", "colorblind", "contrast"];
const SESSION_LIMIT_HOURS = [0, 1, 2, 4, 8, 12, 24];
// Same type as the default, and for the theme and the session limit one of the known values.
const valid = (key, value) =>
  typeof value === typeof DEFAULTS[key] && (key !== "theme" || THEMES.includes(value)) && (key !== "sessionLimitHours" || SESSION_LIMIT_HOURS.includes(value));

function createAppSettings(dataDir) {
  const file = path.join(dataDir, "settings.json");
  let readOnly = false; // settings.json is left exactly as it is this run: nothing is written, no install id is made
  const saved = load();
  let values = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (valid(key, saved[key])) values[key] = saved[key];
  }

  // The saved settings, or {} on a first run. Only a file that reads but does not parse is damaged:
  // it holds this install's id, so it is moved aside (settings-unreadable-<time>.json) for a look by
  // hand before a new one is made. A file that cannot be read at all (antivirus or a sync tool holding
  // it) is fine: it is tried again briefly, then left alone for this run - as is a damaged file that
  // cannot be moved aside.
  function load() {
    let text;
    try {
      text = readFileRetry(file);
    } catch (e) {
      return leaveAlone(`cannot be read (${e.code ?? e.message})`);
    }
    if (text === null) return {};
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // damaged - below
    }
    try {
      fs.renameSync(file, path.join(dataDir, `settings-unreadable-${Date.now()}.json`));
    } catch (e) {
      return leaveAlone(`is damaged and cannot be moved aside (${e.code ?? e.message})`);
    }
    return {};
  }

  // This run uses the defaults in memory; the file keeps what it holds for the next start.
  function leaveAlone(why) {
    readOnly = true;
    console.warn(`KAPEVault: settings.json ${why}. Using the defaults until the next start; the file is left as it is.`);
    return {};
  }

  function get() {
    return { ...values };
  }

  // Unknown keys and wrong types are ignored, so the page can only flip the known switches.
  function set(patch) {
    const next = { ...values };
    for (const key of Object.keys(DEFAULTS)) {
      if (patch && valid(key, patch[key])) next[key] = patch[key];
    }
    values = next;
    write();
    return get();
  }

  // The update check's memory (updates.cjs): when it last asked, when it last got an answer, and the
  // newest release that answer named. Written by main only, never through set(), so the page cannot
  // make a check look due or not due, or name a release.
  const savedCheck = saved.updateCheck && typeof saved.updateCheck === "object" ? saved.updateCheck : {};
  const time = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  let updateCheck = {
    attemptedAt: time(savedCheck.attemptedAt),
    checkedAt: time(savedCheck.checkedAt),
    latest: typeof savedCheck.latest === "string" && savedCheck.latest.length <= 40 ? savedCheck.latest : null,
    url: typeof savedCheck.url === "string" && savedCheck.url.length <= 200 ? savedCheck.url : null,
  };

  function setUpdateCheck(next) {
    updateCheck = { attemptedAt: time(next.attemptedAt), checkedAt: time(next.checkedAt), latest: next.latest ?? null, url: next.url ?? null };
    write();
  }

  // Last window size and place, so a resized window reopens the way it was left.
  let bounds = null;
  const win = saved.window;
  if (win && ["x", "y", "width", "height"].every((k) => Number.isFinite(win[k]))) bounds = { ...win, maximized: win.maximized === true };

  // A random name for this install, so the backups of two PCs sharing one bucket are told apart
  // (each only ever thins out its own). Says nothing about the vault; never sent to the page.
  // "" while settings.json is left alone: the real id is in there, so no other is made up - this run's
  // backups go up un-named (listed as this PC's, never thinned out), not under an id no later run knows.
  let installId = typeof saved.installId === "string" && /^[0-9a-f-]{36}$/.test(saved.installId) ? saved.installId : null;

  // "Keep a copy in a folder" (folder-copy.cjs): the folder's path, nothing about the vault. Picked in
  // main's own dialog and checked there - never through set(), so the page can never name a path. A
  // network path found in the file is dropped by name, before anything could touch it.
  let copyFolder = typeof saved.copyFolder === "string" && path.isAbsolute(saved.copyFolder) && !isNetworkPath(saved.copyFolder) ? saved.copyFolder : "";

  // "" turns the copy off. The caller has checked the folder (checkCopyFolder).
  function setCopyFolder(dir) {
    copyFolder = String(dir ?? "");
    write();
  }

  function getInstallId() {
    if (!installId && !readOnly) {
      installId = crypto.randomUUID();
      write();
    }
    return installId ?? "";
  }

  // Two installs found sharing one id (a KAPEVault folder copied to a second PC, SYNC.md 3.5): this one
  // takes a new id, so sync and backups can tell the two apart again. "" while the file is left alone.
  function renewInstallId() {
    if (readOnly) return "";
    installId = crypto.randomUUID();
    write();
    return installId;
  }

  // Atomic and flushed: it is rewritten on every window move, and a power cut must never empty it
  // (a new install id would make this PC's older backups look like another device's).
  function write() {
    if (readOnly) return;
    writeFileAtomic(file, JSON.stringify({ ...values, window: bounds ?? undefined, installId: installId ?? undefined, copyFolder: copyFolder || undefined, updateCheck }, null, 2));
  }

  function windowBounds() {
    return bounds ? { ...bounds } : null;
  }

  function saveWindowBounds(next) {
    bounds = { x: Math.round(next.x), y: Math.round(next.y), width: Math.round(next.width), height: Math.round(next.height), maximized: Boolean(next.maximized) };
    write();
  }

  return { get, set, windowBounds, saveWindowBounds, installId: getInstallId, renewInstallId, copyFolder: () => copyFolder, setCopyFolder, updateCheck: () => ({ ...updateCheck }), setUpdateCheck };
}

module.exports = { createAppSettings, SESSION_LIMIT_HOURS };
