const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFolderCopy, checkCopyFolder, COPY_NAME } = require("./folder-copy.cjs");
const { createAppSettings } = require("./app-settings.cjs");
const { OPENER_NAME, openerHtml } = require("./opener.cjs");
const { createVaultSession } = require("./vault-session.cjs");

const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `kapevault-${name}-`));

// A vault folder with a (mock) vault file, a folder to copy into, and the copier on a short delay.
// Every copy already in the folder counts as this vault's; the real check has its own tests below.
function setup(t, delayMs = 40) {
  const dataDir = tempDir("data");
  const target = tempDir("copy");
  const vaultPath = path.join(dataDir, "vault.kapevault");
  fs.writeFileSync(vaultPath, '{"format":"kapevault","mock":1}');
  let folder = "";
  const statuses = [];
  const copy = createFolderCopy({ vaultPath, folder: () => folder, setFolder: (d) => (folder = d), ownsFile: () => true, version: "0.1.0", delayMs, onStatus: (s) => statuses.push(s) });
  t.after(() => copy.stop());
  return { copy, vaultPath, target, dataDir, statuses, copied: () => path.join(target, COPY_NAME) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("choosing a folder copies the vault file as it is, with the Forever Opener beside it", (t) => {
  const { copy, vaultPath, target, copied } = setup(t);
  const status = copy.choose(target);
  assert.ok(fs.readFileSync(copied()).equals(fs.readFileSync(vaultPath)));
  assert.equal(fs.readFileSync(path.join(target, OPENER_NAME), "utf8"), openerHtml("0.1.0"));
  assert.equal(status.folder, target);
  assert.equal(status.opener, "written");
  assert.equal(status.error, "");
  assert.ok(Math.abs(status.at - Date.now()) < 5000);
});

test("saves are debounced into one copy", async (t) => {
  const { copy, vaultPath, target, copied, statuses } = setup(t);
  copy.choose(target);
  const before = statuses.length;
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(vaultPath, `{"save":${i}}`);
    copy.schedule();
    await sleep(10);
  }
  assert.notEqual(fs.readFileSync(copied(), "utf8"), '{"save":4}', "nothing is written while saves keep coming");
  await sleep(80);
  assert.equal(fs.readFileSync(copied(), "utf8"), '{"save":4}');
  assert.equal(statuses.length - before, 1, "one copy for the burst");
});

test("flush (lock, quit) writes a waiting copy at once, and nothing when none waits", (t) => {
  const { copy, vaultPath, target, copied, statuses } = setup(t, 60_000);
  copy.choose(target);
  fs.writeFileSync(vaultPath, '{"last":"save"}');
  copy.schedule();
  copy.flush();
  assert.equal(fs.readFileSync(copied(), "utf8"), '{"last":"save"}');
  const count = statuses.length;
  copy.flush();
  assert.equal(statuses.length, count);
});

test("the copy is written atomically: a fresh temp file, flushed, renamed; nothing left behind", (t) => {
  const { copy, target } = setup(t);
  const opened = t.mock.method(fs, "openSync");
  const synced = t.mock.method(fs, "fsyncSync");
  copy.choose(target);
  const temp = opened.mock.calls.find((c) => String(c.arguments[0]).includes(COPY_NAME));
  assert.equal(temp.arguments[1], "wx");
  assert.ok(synced.mock.callCount() >= 1);
  assert.deepEqual(fs.readdirSync(target).sort(), [COPY_NAME, OPENER_NAME].sort());
});

test("network folders are refused by name, before any disk call", (t) => {
  const stat = t.mock.method(fs, "statSync");
  const exists = t.mock.method(fs, "existsSync");
  for (const dir of ["\\\\server\\share", "//server/share", "\\\\?\\UNC\\server\\share", "\\\\.\\pipe\\x"]) {
    assert.throws(() => checkCopyFolder(dir, os.tmpdir()), /Network folders cannot be used/, dir);
  }
  assert.equal(stat.mock.callCount() + exists.mock.callCount(), 0);
});

test("a relative path, a missing folder and KAPEVault's own folder are refused", (t) => {
  const { dataDir } = setup(t);
  assert.throws(() => checkCopyFolder("backups", dataDir), /on this PC/);
  assert.throws(() => checkCopyFolder(path.join(dataDir, "nope"), dataDir), /not there/);
  assert.throws(() => checkCopyFolder(dataDir, dataDir), /outside KAPEVault's own/);
});

test("a folder that went away is reported, and the next copy clears it", (t) => {
  const { copy, target, copied } = setup(t, 60_000);
  copy.choose(target);
  fs.rmSync(target, { recursive: true });
  copy.schedule();
  copy.flush();
  assert.match(copy.status().error, /not there/);
  fs.mkdirSync(target);
  copy.schedule();
  copy.flush();
  assert.equal(copy.status().error, "");
  assert.ok(fs.existsSync(copied()));
});

test("Turn off forgets the folder and cancels a waiting copy; the copy there stays", async (t) => {
  const { copy, vaultPath, target, copied } = setup(t);
  copy.choose(target);
  fs.writeFileSync(vaultPath, '{"after":"off"}');
  copy.schedule();
  assert.equal(copy.stop().folder, "");
  await sleep(80);
  assert.notEqual(fs.readFileSync(copied(), "utf8"), '{"after":"off"}');
  copy.schedule();
  copy.flush();
  assert.notEqual(fs.readFileSync(copied(), "utf8"), '{"after":"off"}');
});

test("a later run reports the copy's own time", (t) => {
  const { copy, target, copied } = setup(t);
  copy.choose(target);
  const settingsDir = tempDir("settings");
  const settings = createAppSettings(settingsDir);
  settings.setCopyFolder(target);
  const again = createFolderCopy({ vaultPath: "unused", folder: settings.copyFolder, setFolder: settings.setCopyFolder, version: "0.1.0", delayMs: 10 });
  assert.equal(again.status().at, fs.statSync(copied()).mtimeMs);
});

// A real vault (mock master password) with the copier asking it whether a copy is its own.
async function realVault(t, master = "correct horse battery") {
  const vaultPath = path.join(tempDir("data"), "vault.kapevault");
  const vault = createVaultSession(vaultPath);
  assert.equal((await vault.create(master)).ok, true);
  let folder = "";
  const copy = createFolderCopy({ vaultPath, folder: () => folder, setFolder: (d) => (folder = d), ownsFile: (bytes) => vault.ownsFile(bytes), version: "0.1.0", delayMs: 60_000 });
  t.after(() => copy.stop());
  return { vault, vaultPath, copy, folder: () => folder };
}

test("a folder holding another vault's copy, or a file that is not one, is refused and left as it is", async (t) => {
  const mine = await realVault(t);
  const other = await realVault(t);
  const target = tempDir("copy");
  for (const there of [fs.readFileSync(other.vaultPath), Buffer.from("not a vault")]) {
    fs.writeFileSync(path.join(target, COPY_NAME), there);
    assert.throws(() => mine.copy.choose(target), /holds a copy of a different vault/);
    assert.ok(fs.readFileSync(path.join(target, COPY_NAME)).equals(there));
    assert.equal(mine.folder(), "", "the folder is not kept");
  }
});

test("another vault's copy that turns up later is not overwritten; the status says why", async (t) => {
  const mine = await realVault(t);
  const other = await realVault(t);
  const target = tempDir("copy");
  mine.copy.choose(target);
  const theirs = fs.readFileSync(other.vaultPath);
  fs.writeFileSync(path.join(target, COPY_NAME), theirs);
  mine.copy.schedule();
  mine.copy.flush();
  assert.match(mine.copy.status().error, /holds a copy of a different vault/);
  assert.ok(fs.readFileSync(path.join(target, COPY_NAME)).equals(theirs));
});

test("this vault's own copy is overwritten, also one saved under an earlier master password", async (t) => {
  const mine = await realVault(t);
  const target = tempDir("copy");
  const copied = path.join(target, COPY_NAME);
  const before = fs.readFileSync(mine.vaultPath);
  mine.copy.choose(target);
  assert.ok(fs.readFileSync(copied).equals(before));
  assert.equal((await mine.vault.changeMaster("correct horse battery", "brand new mock lantern")).ok, true);
  fs.writeFileSync(copied, before); // the copy from before the change
  assert.equal(mine.copy.choose(target).error, "");
  assert.ok(fs.readFileSync(copied).equals(fs.readFileSync(mine.vaultPath)));
  assert.ok(!fs.readFileSync(copied).equals(before));
});

// A restore swaps the vault's data for the backup's: the backup's password proven, then written.
async function restoreOver(vault, text, master) {
  const check = await vault.verifyBackup(text, master);
  assert.equal(check.ok, true);
  vault.commitRestore(text, check.opened);
}

test("after restoring an older snapshot of the same vault, its copy under a later master password is still overwritten", async (t) => {
  const mine = await realVault(t);
  const target = tempDir("copy");
  const copied = path.join(target, COPY_NAME);
  const older = fs.readFileSync(mine.vaultPath, "utf8"); // knows only the first master password
  assert.equal((await mine.vault.changeMaster("correct horse battery", "brand new mock lantern")).ok, true);
  mine.copy.choose(target); // the copy is under the new master password
  await restoreOver(mine.vault, older, "correct horse battery");
  mine.copy.schedule();
  mine.copy.flush();
  assert.equal(mine.copy.status().error, "");
  assert.ok(fs.readFileSync(copied).equals(fs.readFileSync(mine.vaultPath)));
});

test("after restoring a different vault, the replaced vault's copy in the folder is never overwritten", async (t) => {
  const mine = await realVault(t);
  const other = await realVault(t, "other mock lantern phrase");
  const target = tempDir("copy");
  const copied = path.join(target, COPY_NAME);
  assert.equal((await mine.vault.changeMaster("correct horse battery", "brand new mock lantern")).ok, true);
  mine.copy.choose(target);
  const replacedCopy = fs.readFileSync(copied);
  await restoreOver(mine.vault, fs.readFileSync(other.vaultPath, "utf8"), "other mock lantern phrase");
  mine.copy.schedule();
  mine.copy.flush();
  assert.match(mine.copy.status().error, /holds a copy of a different vault/);
  assert.ok(fs.readFileSync(copied).equals(replacedCopy));
});

test("a lock-screen restore of an older snapshot, or a detour through another vault, keeps copying this vault", async (t) => {
  const mine = await realVault(t);
  const other = await realVault(t, "other mock lantern phrase");
  const target = tempDir("copy");
  const copied = path.join(target, COPY_NAME);
  const older = fs.readFileSync(mine.vaultPath, "utf8");
  assert.equal((await mine.vault.changeMaster("correct horse battery", "brand new mock lantern")).ok, true);
  mine.copy.choose(target); // under the new master password
  mine.vault.lock(); // the new password forgotten: restore from the lock screen
  await restoreOver(mine.vault, older, "correct horse battery");
  mine.copy.schedule();
  mine.copy.flush();
  assert.equal(mine.copy.status().error, "");
  assert.ok(fs.readFileSync(copied).equals(fs.readFileSync(mine.vaultPath)));

  assert.equal((await mine.vault.changeMaster("correct horse battery", "third mock lantern phrase")).ok, true);
  mine.copy.schedule();
  mine.copy.flush(); // the copy is under the third password now
  assert.equal(mine.copy.status().error, "");
  await restoreOver(mine.vault, fs.readFileSync(other.vaultPath, "utf8"), "other mock lantern phrase");
  await restoreOver(mine.vault, older, "correct horse battery");
  mine.copy.schedule();
  mine.copy.flush();
  assert.equal(mine.copy.status().error, "");
  assert.ok(fs.readFileSync(copied).equals(fs.readFileSync(mine.vaultPath)));
});

test("settings.json keeps the folder as a path only; the page cannot set it, a network path is dropped", () => {
  const dir = tempDir("settings");
  const settings = createAppSettings(dir);
  settings.set({ copyFolder: "C:\\from-the-page" });
  assert.equal(settings.copyFolder(), "");
  const folder = tempDir("mock-drive");
  settings.setCopyFolder(folder);
  assert.equal(createAppSettings(dir).copyFolder(), folder);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));
  assert.equal(saved.copyFolder, folder);
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ ...saved, copyFolder: "\\\\mock-host\\share" }));
  assert.equal(createAppSettings(dir).copyFolder(), "");
});
