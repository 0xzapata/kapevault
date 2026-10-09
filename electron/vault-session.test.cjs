const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createVaultSession } = require("./vault-session.cjs");
const { openFile, encryptWithKey, createKey } = require("./vault-crypto.cjs");
const { tempVault, seeded, refuseWrites, INSTALL, MASTER, onDisk, writeAsOldBuild, syncing } = require("./fixtures/vault-session-helpers.cjs");

// A vault made before the master rule tightened: re-keyed by hand to a dictionary-style master.
const WEAK_MASTER = "Maria Clara 1998 Cebu";

async function seededWeak() {
  const { file, vault } = await seeded();
  const opened = await openFile("correct horse battery orbit gazelle", JSON.parse(fs.readFileSync(file, "utf8")));
  const fresh = await createKey(WEAK_MASTER);
  fs.writeFileSync(file, JSON.stringify(encryptWithKey(fresh.key, fresh.kdf, fresh.salt, { ...opened.data, keySalt: fresh.salt.toString("base64") })));
  vault.lock();
  return { file, key: Buffer.from(fresh.key) };
}

test("file on disk holds no plaintext", async () => {
  const { file } = await seeded();
  const raw = fs.readFileSync(file, "utf8");
  for (const secret of ["s3cret-pass!", "GitHub", "https://github.com", "Personal"]) {
    assert.equal(raw.includes(secret), false, `${secret} leaked to disk`);
  }
});

test("right password reopens, wrong password does not", async () => {
  const { file } = await seeded();
  const again = createVaultSession(file);
  assert.equal((await again.unlock("wrong password")).ok, false);
  const opened = await again.unlock("correct horse battery orbit gazelle");
  assert.equal(opened.ok, true);
  assert.equal(opened.vault.entries[0].title, "GitHub");
});

test("tampered file is rejected", async () => {
  const { file } = await seeded();
  const disk = JSON.parse(fs.readFileSync(file, "utf8"));
  const bytes = Buffer.from(disk.data, "base64");
  bytes[0] ^= 1;
  disk.data = bytes.toString("base64");
  fs.writeFileSync(file, JSON.stringify(disk));
  assert.equal((await createVaultSession(file).unlock("correct horse battery orbit gazelle")).ok, false);
});

test("lock wipes access", async () => {
  const { vault } = await seeded();
  vault.lock();
  assert.throws(() => vault.publicView(), /locked/);
});

test("change master password re-keys the file", async () => {
  const { file, vault } = await seeded();
  assert.equal((await vault.changeMaster("nope nope nope", "brand new mock lantern orbit gazelle")).ok, false);
  assert.equal((await vault.changeMaster("correct horse battery orbit gazelle", "brand new mock lantern orbit gazelle")).ok, true);
  assert.equal((await createVaultSession(file).unlock("correct horse battery orbit gazelle")).ok, false);
  assert.equal((await createVaultSession(file).unlock("brand new mock lantern orbit gazelle")).ok, true);
});

test("no backup copy is left that the old master password could open", async () => {
  const { file, vault } = await seeded();
  await vault.changeMaster("correct horse battery orbit gazelle", "brand new mock lantern orbit gazelle");
  const leftovers = fs.readdirSync(path.dirname(file)).filter((f) => f !== path.basename(file));
  assert.deepEqual(leftovers, []);
});

test("missing vault file is a clean error, not a crash", async () => {
  const result = await createVaultSession(tempVault()).unlock("anything at all");
  assert.equal(result.ok, false);
});

test("unlocking twice keeps working", async () => {
  const { file } = await seeded();
  const again = createVaultSession(file);
  assert.equal((await again.unlock("correct horse battery orbit gazelle")).ok, true);
  assert.equal((await again.unlock("correct horse battery orbit gazelle")).ok, true);
  assert.equal(again.publicView().entries.length, 1);
});

test("unlockWithKey opens with the live key and refuses a wrong one", async () => {
  const { file, vault } = await seeded();
  const key = vault.keyCopy();
  assert.equal(createVaultSession(file).unlockWithKey(Buffer.from(key)).ok, true);
  assert.equal(createVaultSession(file).unlockWithKey(Buffer.alloc(32, 7)).ok, false);
});

// Audit finding M3 (SECURITY-AUDIT-2026-09-28.md): the header is not covered by the tag. An edited salt used
// to open by key (Windows Hello), be saved back, and lock the master password out of the vault and
// every copy.
test("a key unlock refuses an edited header salt and asks for the master password; nothing is written", async () => {
  const { file, vault } = await seeded();
  const key = vault.keyCopy();
  vault.lock();
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const planted = JSON.stringify({ ...raw, kdf: { ...raw.kdf, salt: Buffer.alloc(16, 9).toString("base64") } });
  fs.writeFileSync(file, planted);
  const result = createVaultSession(file).unlockWithKey(Buffer.from(key));
  assert.equal(result.ok, false);
  assert.equal(result.masterRequired, true, "Hello stays on: the key still fits");
  assert.equal(fs.readFileSync(file, "utf8"), planted, "nothing was saved over it");
  // The real header back: the key opens it, and the master password still does too.
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.equal(createVaultSession(file).unlockWithKey(Buffer.from(key)).ok, true);
  assert.equal((await createVaultSession(file).unlock("correct horse battery orbit gazelle")).ok, true);
});

test("a vault from before keySalt asks for the master once, which marks it for the next key unlock", async () => {
  const { file, vault } = await seeded();
  const key = vault.keyCopy();
  const opened = await openFile("correct horse battery orbit gazelle", JSON.parse(fs.readFileSync(file, "utf8")));
  const { keySalt, ...before } = opened.data;
  assert.equal(keySalt, opened.salt.toString("base64"), "a saved vault carries it");
  fs.writeFileSync(file, JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, before)));
  assert.equal(createVaultSession(file).unlockWithKey(Buffer.from(key)).masterRequired, true);
  assert.equal((await createVaultSession(file).unlock("correct horse battery orbit gazelle")).ok, true);
  assert.equal(createVaultSession(file).unlockWithKey(Buffer.from(key)).ok, true, "marked by the master unlock");
});

test("a master password change marks the new salt in the file it writes", async () => {
  const { file, vault } = await seeded();
  assert.equal((await vault.changeMaster("correct horse battery orbit gazelle", "Lantern-Mango-Quiet-47x orbit gazelle")).ok, true);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const opened = await openFile("Lantern-Mango-Quiet-47x orbit gazelle", raw);
  assert.equal(opened.data.keySalt, raw.kdf.salt);
  assert.equal(createVaultSession(file).unlockWithKey(Buffer.from(opened.key)).ok, true);
});

test("a new or changed master password must be long and strong", async () => {
  const vault = createVaultSession(tempVault());
  assert.match((await vault.create("short")).error, /at least 12/);
  assert.match((await vault.create("Summer2024!!")).error, /Too easy to guess/);
  assert.ok((await vault.create("correct horse battery orbit gazelle")).ok);
  assert.match((await vault.changeMaster("correct horse battery orbit gazelle", "password1234")).error, /Too easy to guess/);
});

test("a vault file whose settings would never finish opening is refused before any work", async () => {
  const file = tempVault();
  const vault = createVaultSession(file);
  await vault.create("correct horse battery orbit gazelle");
  vault.lock();
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...saved, kdf: { ...saved.kdf, p: 2 ** 20 } }));
  const started = Date.now();
  await assert.rejects(vault.unlock("correct horse battery orbit gazelle"), /Not a KAPEVault file/);
  assert.ok(Date.now() - started < 2000);
});

test("a save that would make the vault bigger than any restore reads is refused, and nothing changes", async () => {
  const { file, vault, spaceId } = await seeded();
  const before = fs.readFileSync(file);
  assert.throws(() => vault.saveEntry({ kind: "note", spaceId, title: "Mock huge note", body: "x".repeat(50 * 1024 * 1024) }), /too big to back up \(over 64 MB\), so this was not saved/);
  assert.ok(fs.readFileSync(file).equals(before), "nothing written");
  assert.ok(!vault.publicView().entries.some((e) => e.title === "Mock huge note"), "and not kept in memory for the next save");
  vault.saveEntry({ kind: "note", spaceId, title: "Mock small note", body: "fine" });
  assert.deepEqual(vault.publicView().entries.map((e) => e.title).sort(), ["GitHub", "Mock small note"]);
});

test("a save the disk refuses is not kept in memory: a retry adds it once, a failed delete never happens later", async (t) => {
  const { file, vault, spaceId, id } = await seeded();
  const refused = refuseWrites(t);
  assert.throws(() => vault.saveEntry({ kind: "note", spaceId, title: "Mock note", body: "b" }), /mock disk refused/);
  assert.throws(() => vault.deleteEntry(id), /mock disk refused/);
  assert.throws(() => vault.addSpace("Mock Client"), /mock disk refused/);
  assert.throws(() => vault.setRecoveryCodes(id, ["aaaa-1111", "bbbb-2222", "cccc-3333", "dddd-4444"]), /mock disk refused/);
  const view = vault.publicView();
  assert.deepEqual(view.entries.map((e) => e.title), ["GitHub"], "the failed add is gone and the failed delete did not happen");
  assert.equal(view.spaces.length, 1);
  assert.equal(view.entries[0].recoveryCodes, undefined);

  refused.mock.restore();
  vault.saveEntry({ kind: "note", spaceId, title: "Mock note", body: "b" });
  vault.renameSpace(spaceId, "Mine"); // any later save must not carry the failed delete
  const again = createVaultSession(file);
  await again.unlock("correct horse battery orbit gazelle");
  assert.deepEqual(again.publicView().entries.map((e) => e.title).sort(), ["GitHub", "Mock note"]);
});

test("a failed master password change keeps the old password and does not flag older backups", async (t) => {
  const { file, vault, spaceId } = await seeded();
  vault.setCloud({ endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "mock-bucket", accessKeyId: "mock-key", secretAccessKey: "mock-secret", auto: false });
  const refused = refuseWrites(t);
  await assert.rejects(vault.changeMaster("correct horse battery orbit gazelle", "brand new master phrase orbit gazelle"), /mock disk refused/);
  refused.mock.restore();
  assert.equal(vault.cloudView().olderBackups, false, "nothing changed, so no older backups to delete");
  vault.saveEntry({ kind: "note", spaceId, title: "Mock after", body: "b" }); // still saved with the old key
  assert.equal((await createVaultSession(file).unlock("correct horse battery orbit gazelle")).ok, true);
});

test("a vault whose first write fails is not left open", async (t) => {
  const vault = createVaultSession(tempVault());
  refuseWrites(t);
  await assert.rejects(vault.create("correct horse battery orbit gazelle"), /mock disk refused/);
  assert.equal(vault.status().unlocked, false);
});

test("a new master password the strength rule refuses is marked as a rule, not a wrong guess", async () => {
  const { vault } = await seeded();
  assert.deepEqual(await vault.changeMaster("correct horse battery orbit gazelle", "short"), { ok: false, error: "Use at least 12 characters.", rule: true });
  const wrong = await vault.changeMaster("not the password at all", "brand new master phrase orbit gazelle");
  assert.equal(wrong.ok, false);
  assert.equal(wrong.rule, undefined, "a wrong current password is a guess");
});

test("a save stamps what changed, and the file carries it; a new vault stamps nothing", async () => {
  const { file, vault, spaceId, id } = await syncing();
  let sync = (await onDisk(file)).sync;
  assert.equal(sync.vaultId, spaceId, "the Personal space names the vault");
  assert.deepEqual(Object.keys(sync.meta), [id], "the new vault's Personal space is not stamped");
  assert.deepEqual(sync.meta[id].vv, { [INSTALL]: 1 });
  vault.toggleFavorite(id);
  vault.touch(id);
  sync = (await onDisk(file)).sync;
  assert.deepEqual(sync.meta[id].vv, { [INSTALL]: 2 }, "the favorite stamps; using the item does not");
  assert.deepEqual(sync.meta[id].g.fav.dot, [INSTALL, 2]);
  vault.deleteEntry(id);
  sync = (await onDisk(file)).sync;
  assert.equal(sync.gone[id], undefined, "Delete moves it to the Trash: a stamp, no tombstone");
  assert.deepEqual(sync.meta[id].g.trash.dot, [INSTALL, 3]);
  vault.deleteForever(id);
  assert.deepEqual((await onDisk(file)).sync.gone[id].vv, { [INSTALL]: 4 });
});

test("a failed save rolls sync back with it: no stamp, no tombstone, no counter it never wrote", async (t) => {
  const { file, vault, spaceId, id } = await syncing();
  const refused = refuseWrites(t);
  assert.throws(() => vault.saveEntry({ id, kind: "login", spaceId, title: "Mock renamed" }), /mock disk refused/);
  assert.throws(() => vault.deleteEntry(id), /mock disk refused/);
  refused.mock.restore();
  vault.toggleFavorite(id);
  const { sync } = await onDisk(file);
  assert.equal(sync.gone[id], undefined);
  assert.deepEqual(sync.meta[id].vv, { [INSTALL]: 2 }, "create, then the favorite - the failed rename left no count");
  assert.deepEqual(Object.keys(sync.meta[id].g).sort(), ["core", "fav", "pw", "space"]);
  assert.deepEqual(sync.meta[id].g.core.dot, [INSTALL, 1]);
});

test("a vault saved before sync opens unchanged and gains sync on its next save, stamping nothing old", async () => {
  const { file, vault: synced, id } = await syncing();
  const withSync = synced.publicView();
  synced.lock();
  await writeAsOldBuild(file, (data) => delete data.sync);
  const vault = createVaultSession(file, { installId: () => INSTALL });
  assert.deepEqual((await vault.unlock(MASTER)).vault, withSync, "the page sees the same vault");
  vault.touch(id);
  const data = await onDisk(file);
  assert.deepEqual(data.sync.meta, {}, "migration never stamps");
  assert.deepEqual(data.sync.gone, {});
});

test("repair on open: an old build's edit is stamped and its delete is tombstoned", async () => {
  const { file, spaceId, id } = await syncing();
  const other = createVaultSession(file, { installId: () => INSTALL });
  await other.unlock(MASTER);
  const { id: note } = other.saveEntry({ kind: "note", spaceId, title: "Mock note", body: "b" });
  other.lock();
  await writeAsOldBuild(file, (data) => {
    data.entries = data.entries.filter((e) => e.id !== note).map((e) => (e.id === id ? { ...e, password: "changed-by-old-build" } : e));
  });
  const vault = createVaultSession(file, { installId: () => INSTALL });
  await vault.unlock(MASTER);
  vault.addSpace("Mock Client"); // any save writes what repair found
  const { sync } = await onDisk(file);
  assert.deepEqual(sync.meta[id].vv, { [INSTALL]: 2 });
  assert.deepEqual(sync.gone[note].vv, { [INSTALL]: 2 });
});

test("a master password change records the new salt as the newest key", async () => {
  const { file, vault } = await syncing();
  await vault.changeMaster(MASTER, "brand new master phrase orbit gazelle");
  const disk = JSON.parse(fs.readFileSync(file, "utf8"));
  const { data } = await openFile("brand new master phrase orbit gazelle", disk);
  assert.equal(data.sync.keys.at(-1).salt, disk.kdf.salt);
  assert.equal(data.sync.keys.length, 2);
});

test("a temp file a hard kill left beside the vault is swept when the session is made, nothing else is", () => {
  const file = tempVault();
  const dir = path.dirname(file);
  const stale = path.join(dir, ".vault.kapevault.0f8fad5b-d9cb-469f-a165-70867728950e.tmp");
  const other = path.join(dir, "notes.txt");
  for (const f of [stale, other]) fs.writeFileSync(f, "x");
  const old = new Date(Date.now() - 2 * 3600 * 1000);
  fs.utimesSync(stale, old, old);
  createVaultSession(file);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(other), true);
});

test("masterWeak: a weak master unlock flags it, a strong one does not", async () => {
  const { file } = await seededWeak();
  const weak = await createVaultSession(file).unlock(WEAK_MASTER);
  assert.equal(weak.vault.masterWeak, true);
  const { file: strongFile } = await seeded();
  assert.equal((await createVaultSession(strongFile).unlock("correct horse battery orbit gazelle")).vault.masterWeak, false);
});

test("masterWeak: it rides every view of the session and lock clears it", async () => {
  const { file } = await seededWeak();
  const vault = createVaultSession(file);
  await vault.unlock(WEAK_MASTER);
  assert.equal(vault.publicView().masterWeak, true);
  vault.lock();
  await assert.rejects(async () => vault.publicView(), /locked/);
  assert.equal(fs.readFileSync(file, "utf8").includes("masterWeak"), false, "never written to disk");
});

test("masterWeak: a key unlock (Hello, fingerprint) never sets it", async () => {
  const { file, key } = await seededWeak();
  const result = createVaultSession(file).unlockWithKey(key);
  assert.equal(result.ok, true);
  assert.equal(result.vault.masterWeak, false);
});

test("masterWeak: changing the master clears it", async () => {
  const { file } = await seededWeak();
  const vault = createVaultSession(file);
  await vault.unlock(WEAK_MASTER);
  assert.equal((await vault.changeMaster(WEAK_MASTER, "brand new mock lantern orbit gazelle")).ok, true);
  assert.equal(vault.publicView().masterWeak, false);
});

// Audit crypto 10 (2026-10-04): when starting the session throws after the key is derived (here: the
// install id cannot be read), that key must not stay in memory.
test("a master unlock that fails after the key is derived zeroes that key", async () => {
  const { file } = await seeded();
  const zeroed = [];
  const fill = Buffer.prototype.fill;
  Buffer.prototype.fill = function (value, ...rest) {
    if (this.length === 32 && value === 0) zeroed.push(this);
    return fill.call(this, value, ...rest);
  };
  try {
    const broken = createVaultSession(file, { installId: () => { throw new Error("mock settings unreadable"); } });
    await assert.rejects(broken.unlock("correct horse battery orbit gazelle"), /mock settings unreadable/);
  } finally {
    Buffer.prototype.fill = fill;
  }
  assert.equal(zeroed.length, 1, "the derived key was wiped");
});
