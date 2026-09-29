const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAppSettings } = require("./app-settings.cjs");

const ID = "0f8f5a0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-settings-"));
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));

test("settings are written atomically (flushed, fresh temp name) and read back", (t) => {
  const dir = tempDir();
  const synced = t.mock.method(fs, "fsyncSync");
  const settings = createAppSettings(dir);
  settings.set({ theme: "dark" });
  settings.saveWindowBounds({ x: 10, y: 20, width: 800, height: 600 });
  assert.ok(synced.mock.callCount() >= 2);
  assert.deepEqual(fs.readdirSync(dir), ["settings.json"], "no settings.json.tmp left");
  const again = createAppSettings(dir);
  assert.equal(again.get().theme, "dark");
  assert.deepEqual(again.windowBounds(), { x: 10, y: 20, width: 800, height: 600, maximized: false });
});

test("hide from screen capture: on by default, only a boolean turns it off, and it stays off", () => {
  const dir = tempDir();
  const settings = createAppSettings(dir);
  assert.equal(settings.get().hideFromCapture, true);
  assert.equal(settings.set({ hideFromCapture: "false" }).hideFromCapture, true, "a string is ignored");
  assert.equal(settings.set({ hideFromCapture: false }).hideFromCapture, false);
  assert.equal(createAppSettings(dir).get().hideFromCapture, false);
});

test("a saved install id is kept", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ installId: ID, theme: "contrast" }));
  const settings = createAppSettings(dir);
  assert.equal(settings.installId(), ID);
  settings.set({ quickSearch: false });
  assert.equal(read(dir).installId, ID);
});

test("a renewed install id is new, saved, and what installId() gives from then on", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ installId: ID, theme: "dark" }));
  const settings = createAppSettings(dir);
  const renewed = settings.renewInstallId();
  assert.match(renewed, /^[0-9a-f-]{36}$/);
  assert.notEqual(renewed, ID);
  assert.equal(settings.installId(), renewed);
  assert.equal(read(dir).installId, renewed);
  assert.equal(read(dir).theme, "dark", "the rest is kept");
  assert.equal(createAppSettings(dir).installId(), renewed);
});

test("a settings.json left alone this run renews nothing", (t) => {
  const dir = tempDir();
  const saved = JSON.stringify({ installId: ID });
  fs.writeFileSync(path.join(dir, "settings.json"), saved);
  const busy = busyReads(t, dir);
  t.mock.method(console, "warn", () => {});
  const settings = createAppSettings(dir);
  assert.equal(settings.renewInstallId(), "");
  assert.equal(settings.installId(), "");
  busy.mock.restore();
  assert.equal(fs.readFileSync(path.join(dir, "settings.json"), "utf8"), saved);
});

test("an unreadable settings.json is moved aside, never overwritten, before a new install id is made", () => {
  const dir = tempDir();
  const damaged = `{"installId": "${ID}", "theme": "da`; // cut off half way
  fs.writeFileSync(path.join(dir, "settings.json"), damaged);
  const settings = createAppSettings(dir);
  const id = settings.installId();
  assert.notEqual(id, ID);
  const aside = fs.readdirSync(dir).filter((f) => /^settings-unreadable-\d+\.json$/.test(f));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, aside[0]), "utf8"), damaged, "kept as it was, for a look by hand");
  assert.equal(read(dir).installId, id);
});

test("an unreadable settings.json that cannot be moved aside is left alone: nothing is written this run", (t) => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "settings.json"), "not json");
  t.mock.method(fs, "renameSync", () => {
    throw Object.assign(new Error("EBUSY: mock file in use"), { code: "EBUSY" });
  });
  const warned = t.mock.method(console, "warn", () => {});
  const settings = createAppSettings(dir);
  settings.set({ theme: "dark" });
  assert.equal(settings.installId(), "", "no id that only lives for this run");
  assert.equal(settings.get().theme, "dark", "still works in memory");
  assert.equal(warned.mock.callCount(), 1, "said, not silent");
  assert.equal(fs.readFileSync(path.join(dir, "settings.json"), "utf8"), "not json");
  assert.deepEqual(fs.readdirSync(dir), ["settings.json"]);
});

// Antivirus or a sync tool holding settings.json: the read fails, the file is fine.
function busyReads(t, dir, times = Infinity) {
  const read = fs.readFileSync;
  let left = times;
  return t.mock.method(fs, "readFileSync", (file, ...rest) => {
    if (file === path.join(dir, "settings.json") && left-- > 0) throw Object.assign(new Error("EBUSY: mock file in use"), { code: "EBUSY" });
    return read(file, ...rest);
  });
}

test("a settings.json that cannot be read is not damaged: defaults for this run, the file and its id untouched", (t) => {
  const dir = tempDir();
  const saved = JSON.stringify({ installId: ID, theme: "dark" });
  fs.writeFileSync(path.join(dir, "settings.json"), saved);
  const busy = busyReads(t, dir);
  const warned = t.mock.method(console, "warn", () => {});
  const settings = createAppSettings(dir);
  assert.equal(settings.get().theme, "system", "defaults this run");
  assert.equal(settings.installId(), "", "no new id is made: backups go up un-named this run");
  settings.set({ theme: "contrast" });
  settings.saveWindowBounds({ x: 1, y: 2, width: 800, height: 600 });
  assert.equal(settings.get().theme, "contrast", "still works in memory");
  busy.mock.restore();
  assert.deepEqual(fs.readdirSync(dir), ["settings.json"], "nothing moved aside");
  assert.equal(fs.readFileSync(path.join(dir, "settings.json"), "utf8"), saved, "never overwritten");
  assert.equal(warned.mock.callCount(), 1);
  assert.match(String(warned.mock.calls[0].arguments.join(" ")), /EBUSY/);
});

test("a read that fails for a moment is tried again", (t) => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ installId: ID, theme: "dark" }));
  busyReads(t, dir, 1);
  const settings = createAppSettings(dir);
  assert.equal(settings.get().theme, "dark");
  assert.equal(settings.installId(), ID);
});

test("the session limit is one of the offered hours; anything else reads as the default 8", () => {
  const { SESSION_LIMIT_HOURS } = require("./app-settings.cjs");
  assert.deepEqual(SESSION_LIMIT_HOURS, [0, 1, 2, 4, 8, 12, 24]);
  const dir = tempDir();
  const settings = createAppSettings(dir);
  assert.equal(settings.get().sessionLimitHours, 8);
  for (const hours of SESSION_LIMIT_HOURS) assert.equal(settings.set({ sessionLimitHours: hours }).sessionLimitHours, hours);
  for (const bad of [3, -1, 8.5, "8", null, 1e9]) assert.equal(settings.set({ sessionLimitHours: bad }).sessionLimitHours, 24, `${bad} ignored`);
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ sessionLimitHours: 5 }));
  assert.equal(createAppSettings(dir).get().sessionLimitHours, 8, "a hand-edited value off the list reads as the default");
});

// The window's move timer and close handler catch this throw (windows.cjs, tray.cjs): an uncaught one
// crashes main with Electron's error dialog. What they rely on: the old file stays whole.
test("a write the disk refuses (antivirus) throws and leaves settings.json as it was", (t) => {
  const dir = tempDir();
  const settings = createAppSettings(dir);
  settings.saveWindowBounds({ x: 10, y: 20, width: 800, height: 600 });
  const before = fs.readFileSync(path.join(dir, "settings.json"), "utf8");
  for (const code of ["EPERM", "EBUSY"]) {
    const refused = t.mock.method(fs, "renameSync", () => {
      throw Object.assign(new Error(`${code}: mock file in use`), { code });
    });
    assert.throws(() => settings.saveWindowBounds({ x: 99, y: 99, width: 640, height: 600 }), { code });
    assert.throws(() => settings.set({ trayHintShown: true }), { code });
    refused.mock.restore();
    assert.equal(fs.readFileSync(path.join(dir, "settings.json"), "utf8"), before);
    assert.deepEqual(fs.readdirSync(dir), ["settings.json"], "no temp file left behind");
  }
  assert.deepEqual(createAppSettings(dir).windowBounds(), { x: 10, y: 20, width: 800, height: 600, maximized: false });
});
