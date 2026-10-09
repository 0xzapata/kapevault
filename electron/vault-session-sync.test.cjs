const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createVaultSession } = require("./vault-session.cjs");
const { openFile } = require("./vault-crypto.cjs");
const { tempVault, INSTALL, MASTER, onDisk, syncing } = require("./fixtures/vault-session-helpers.cjs");

// ---- The sync loop's hooks (SYNC.md 3.9): a merged vault is committed as it is, never stamped
const OTHER = "7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

test("sync's own save writes the merged vault as it is, and tells onPersist it was sync", async () => {
  const file = tempVault();
  const saves = [];
  const vault = createVaultSession(file, { installId: () => INSTALL, onPersist: (save) => saves.push(save) });
  const spaceId = (await vault.create(MASTER)).vault.spaces[0].id;
  const { id } = vault.saveEntry({ kind: "note", spaceId, title: "Mock note", body: "b" });
  assert.deepEqual(saves.at(-1), { bySync: false });

  const base = vault.syncBase();
  const theirs = { id: "from-other", kind: "note", spaceId, title: "Mock note from the phone", body: "p" };
  const stampOf = { dot: [OTHER, 1], at: [5, 0, OTHER] };
  const merged = {
    ...base.data,
    entries: [...base.data.entries, theirs],
    sync: { ...base.data.sync, meta: { ...base.data.sync.meta, [theirs.id]: { vv: { [OTHER]: 1 }, g: { core: stampOf, space: stampOf, body: stampOf } } } },
  };
  assert.equal(vault.commitSync(merged, base.revision), true);
  assert.deepEqual(saves.at(-1), { bySync: true });
  let sync = (await onDisk(file)).sync;
  assert.deepEqual(sync.meta[theirs.id].vv, { [OTHER]: 1 }, "the merged item is not stamped as this device's edit");
  assert.deepEqual(sync.meta[id].vv, { [INSTALL]: 1 });

  vault.toggleFavorite(theirs.id); // the merged vault is the baseline: the next save stamps only this
  sync = (await onDisk(file)).sync;
  assert.deepEqual(sync.meta[theirs.id].vv, { [OTHER]: 1, [INSTALL]: 1 });
  assert.deepEqual(Object.keys(sync.meta[theirs.id].g).sort(), ["body", "core", "fav", "space"]);
  assert.deepEqual(sync.meta[id].vv, { [INSTALL]: 1 });
});

test("a sync commit against a vault that changed since it was read writes nothing", async () => {
  const { file, vault, id } = await syncing();
  const base = vault.syncBase();
  vault.toggleFavorite(id);
  const before = fs.readFileSync(file);
  assert.equal(vault.commitSync({ ...base.data, entries: [] }, base.revision), false);
  assert.ok(fs.readFileSync(file).equals(before));
  assert.equal(vault.publicView().entries.length, 1);
  vault.lock();
  assert.throws(() => vault.syncBase(), /locked/);
  assert.equal(vault.commitSync(base.data, base.revision), false, "never while locked");
});

test("each open is a new session generation; saves move the revision", async () => {
  const { vault, id } = await syncing();
  const first = vault.syncBase();
  vault.toggleFavorite(id);
  const saved = vault.syncBase();
  assert.equal(saved.generation, first.generation);
  assert.ok(saved.revision > first.revision);
  vault.lock();
  await vault.unlock(MASTER);
  assert.ok(vault.syncBase().generation > first.generation);
});

test("a snapshot opens with the session key when its salt matches; another key or a damaged file does not", async () => {
  const { file, vault } = await syncing();
  const same = fs.readFileSync(file);
  assert.equal(vault.openSnapshot(same).data.entries[0].title, "Mock Portal");

  const other = path.join(path.dirname(file), "other.kapevault");
  fs.copyFileSync(file, other);
  const elsewhere = createVaultSession(other, { installId: () => OTHER });
  await elsewhere.unlock(MASTER);
  await elsewhere.changeMaster(MASTER, "brand new master phrase orbit gazelle");
  assert.deepEqual(vault.openSnapshot(fs.readFileSync(other)), { otherKey: true, behind: false }, "a newer key this vault never had");
  assert.deepEqual(elsewhere.openSnapshot(same), { otherKey: true, behind: true }, "the other device still has the old key");

  const damaged = JSON.parse(same.toString("utf8"));
  const bytes = Buffer.from(damaged.data, "base64");
  bytes[3] ^= 1;
  damaged.data = bytes.toString("base64");
  assert.equal(vault.openSnapshot(Buffer.from(JSON.stringify(damaged))), null);
  assert.equal(vault.openSnapshot(same.subarray(0, 40)), null, "truncated");
  assert.equal(vault.openSnapshot(Buffer.from('{"format":"kapevault","version":1,"kdf":{"p":1048576}}')), null, "a planted header");
});

test("the sync log rides the next write and stays on this device", async () => {
  const { file, vault, id } = await syncing();
  vault.keepSyncLog([{ at: 1, with: [OTHER], added: 0, changed: 0, deleted: 0, copies: 0 }]);
  assert.equal((await onDisk(file)).syncLog, undefined, "not written by itself");
  vault.toggleFavorite(id);
  assert.deepEqual((await onDisk(file)).syncLog, [{ at: 1, with: [OTHER], added: 0, changed: 0, deleted: 0, copies: 0 }]);
  assert.equal(vault.syncBase().data.syncLog.length, 1);
});

test("another device's snapshot under a new master password opens with that password, and a commit adopts its key", async () => {
  const { file, vault } = await syncing();
  const other = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-other-")), "vault.kapevault");
  fs.copyFileSync(file, other);
  const elsewhere = createVaultSession(other, { installId: () => OTHER });
  await elsewhere.unlock(MASTER);
  await elsewhere.changeMaster(MASTER, "brand new master phrase orbit gazelle");
  const bytes = fs.readFileSync(other);

  assert.deepEqual(await vault.openWithPassword(bytes, MASTER), { ok: false, error: "Wrong master password." });
  assert.deepEqual(await vault.openWithPassword(Buffer.from("not a vault"), MASTER), { ok: false, damaged: true, error: "That backup cannot be opened." });
  const { opened } = await vault.openWithPassword(bytes, "brand new master phrase orbit gazelle");

  // Read before a save: nothing is written, and the key it carried is wiped.
  const base = vault.syncBase();
  vault.addSpace("Mock Client");
  const stale = { ...opened, key: Buffer.from(opened.key) };
  assert.equal(vault.commitSync(base.data, base.revision, stale), false);
  assert.ok(stale.key.every((b) => b === 0));

  vault.setCloud({ endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "mock-bucket", accessKeyId: "k", secretAccessKey: "s", auto: true });
  const now = vault.syncBase();
  assert.equal(vault.commitSync({ ...now.data, sync: { ...now.data.sync, keys: opened.data.sync.keys } }, now.revision, opened), true);
  const disk = (await openFile("brand new master phrase orbit gazelle", JSON.parse(fs.readFileSync(file, "utf8")))).data;
  assert.equal(disk.olderBackupsPending, true, "this device's older backups still open with the old password");
  assert.equal(vault.openSnapshot(bytes).data.entries.length, 1, "the session holds the new key");
  assert.ok(vault.syncBase().generation > now.generation);
});

test("a new epoch and a removed device are saved like any change", async () => {
  const { file, vault } = await syncing();
  vault.startEpoch("epoch-2");
  vault.revokeDevice(OTHER);
  const { sync } = await onDisk(file);
  assert.equal(sync.epoch.id, "epoch-2");
  assert.equal(sync.devices[OTHER].name, "Another device");
  assert.ok(sync.devices[OTHER].revokedAt);
});
