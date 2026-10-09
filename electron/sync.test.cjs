const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createVaultSession } = require("./vault-session.cjs");
const { createCloudBackup, configFromInput } = require("./cloud-backup.cjs");
const { createSync } = require("./sync.cjs");
const { encryptWithKey, openFile } = require("./vault-crypto.cjs");

const MASTER = "correct horse battery orbit gazelle";
const NEW_MASTER = "brand new master phrase orbit gazelle";
const PC = "0b8c8e52-1b7e-4d8e-9a53-6f0c1d2e3f40";
const PHONE = "7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const DAY = 86_400_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (done) => {
  for (let i = 0; i < 300 && !done(); i++) await sleep(10);
  assert.ok(done(), "timed out");
};

// One bucket in memory behind a stand-in courier. R2 stamps each object's LastModified by its own
// clock; here every PUT is a second after the one before, so "newest" is never a tie.
function fakeBucket() {
  const objects = new Map();
  const modified = new Map();
  const log = [];
  let clock = Date.parse("2026-09-27T00:00:00Z");
  const reply = (status, body = "") => ({ status, body: Buffer.from(body) });
  const transport = async ({ method, url, body }) => {
    const u = new URL(url);
    const key = decodeURIComponent(u.pathname.split("/").slice(2).join("/"));
    log.push(`${method} ${key}`);
    if (method === "PUT") return objects.set(key, Buffer.from(body)), modified.set(key, (clock += 1000)), reply(200);
    if (method === "DELETE") return objects.delete(key), reply(204);
    if (!key) {
      const prefix = u.searchParams.get("prefix") ?? "";
      const items = [...objects].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `<Contents><Key>${k}</Key><LastModified>${new Date(modified.get(k)).toISOString()}</LastModified><Size>${v.length}</Size></Contents>`);
      return reply(200, `<ListBucketResult>${items.join("")}</ListBucketResult>`);
    }
    return objects.has(key) ? { status: 200, body: objects.get(key) } : reply(404, "<Error><Code>NoSuchKey</Code></Error>");
  };
  const puts = () => log.filter((l) => l.startsWith("PUT kapevault/snapshots/")).length;
  const newest = (owner) => [...objects.keys()].filter((k) => k.includes(`/${owner}/`) && !k.includes("before-restore")).sort((a, b) => modified.get(b) - modified.get(a))[0];
  return { objects, modified, log, transport, puts, newest };
}

// A device wired as main.cjs wires it, in a folder of its own (the files beside a vault are per
// device): a save schedules the backup and, unless sync made it, a sync. runs: how many times sync
// listed the bucket; rekeyed: how often another device's master password was adopted (main turns
// Windows Hello off then); guesses: passwords typed through the throttle.
function wire(dir, id, name, bucket) {
  fs.mkdirSync(dir, { recursive: true });
  let cloud = null;
  let sync = null;
  const dev = { id, runs: 0, saves: [], rekeyed: 0, guesses: 0, file: path.join(dir, "vault.kapevault") };
  const installId = () => dev.id;
  dev.vault = createVaultSession(dev.file, {
    installId,
    onPersist: (save) => {
      dev.saves.push(save);
      cloud.schedule();
      if (!save.bySync) sync.afterSave();
    },
  });
  cloud = createCloudBackup({ vault: dev.vault, installId, delayMs: 20, transport: bucket.transport });
  const listing = cloud.syncListing;
  cloud.syncListing = () => (dev.runs++, listing());
  const renewInstallId = () => (dev.id = crypto.randomUUID());
  const throttledUnlock = (attempt) => (dev.guesses++, attempt());
  sync = createSync({ vault: dev.vault, cloud, installId, renewInstallId, throttledUnlock, device: { name, platform: "win32" }, delayMs: 20, onRekeyed: () => dev.rekeyed++ });
  return Object.assign(dev, { cloud, sync, dir });
}

// A copy of a device's vault file in a new folder, wired as another install (as a restore or a
// copied KAPEVault folder would start it).
async function copyOf(dev, id, name, bucket, master = MASTER) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-sync-"));
  fs.copyFileSync(dev.file, path.join(dir, "vault.kapevault"));
  const other = wire(dir, id, name, bucket);
  await other.vault.unlock(master);
  return other;
}

// A PC with cloud backup on, and a phone that started from the PC's vault file (as a restore does).
async function pair() {
  const bucket = fakeBucket();
  const pc = wire(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-sync-")), PC, "Mock PC", bucket);
  const personal = (await pc.vault.create(MASTER)).vault.spaces[0].id;
  pc.vault.setCloud(configFromInput({ url: "https://0123abcd.r2.cloudflarestorage.com/mock-bucket", accessKeyId: "mock-key", secretAccessKey: "mock-secret" }));
  const { id: portal } = pc.vault.saveEntry({ kind: "login", spaceId: personal, title: "Mock Portal", username: "mock.user", password: "pw-one" });
  const { id: note } = pc.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock Note", body: "first" });
  // Ten items, so two deletes are more than 10% of them but under the 3 a share needs (the review gate).
  for (let i = 0; i < 8; i++) pc.vault.saveEntry({ kind: "link", spaceId: personal, title: `Mock link ${i}`, linkType: "web", location: `https://example.com/${i}` });
  await pc.cloud.backupNow();
  const phone = await copyOf(pc, PHONE, "Mock Phone", bucket);
  await pc.sync.syncNow(); // nothing from the phone yet
  await phone.sync.syncNow();
  await pc.sync.syncNow(); // the PC meets the phone and registers
  await phone.sync.syncNow(); // both know each other by name now
  return { bucket, pc, phone, personal, portal, note };
}

const titles = (dev) => dev.vault.publicView().entries.map((e) => e.title).sort();
const entry = (dev, id) => dev.vault.publicView().entries.find((e) => e.id === id);
const onDisk = async (dev, master = MASTER) => (await openFile(master, JSON.parse(fs.readFileSync(dev.file, "utf8")))).data;

// A restore as main runs it: the backup's file written over this device's vault, then the pause.
async function restoreFrom(dev, bytes) {
  const check = await dev.vault.verifyBackup(bytes.toString("utf8"), MASTER);
  dev.vault.commitRestore(bytes.toString("utf8"), check.opened, { cloud: dev.vault.cloudConfig() });
  dev.sync.pauseAfterRestore();
}

test("an edit on one device reaches the other on its next sync, with both named", async () => {
  const { pc, phone, personal } = await pair();
  pc.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock shared note", body: "b" });
  await pc.sync.syncNow(); // pushes the waiting backup
  const status = await phone.sync.syncNow();
  assert.ok(titles(phone).includes("Mock shared note"));
  assert.equal(status.state, "idle");
  assert.deepEqual(status.lastSync.with, ["Mock PC"]);
  assert.equal(status.thisDevice, "Mock Phone");
  assert.deepEqual(status.devices.map((d) => d.name), ["Mock PC"]);
  assert.ok(status.devices[0].lastSeen > 0, "last seen from R2's LastModified");
  assert.match(status.devices[0].ref, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(status).includes(PC), "the page never gets an install id");
  assert.deepEqual((await pc.sync.syncNow()).lastSync.with, ["Mock Phone"], "the phone registered on its first sync");
});

test("a device names itself on its first sync, so a phone restored from its backup names it at once", async () => {
  const bucket = fakeBucket();
  const pc = wire(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-sync-")), PC, "Mock PC", bucket);
  const personal = (await pc.vault.create(MASTER)).vault.spaces[0].id;
  pc.vault.setCloud(configFromInput({ url: "https://0123abcd.r2.cloudflarestorage.com/mock-bucket", accessKeyId: "mock-key", secretAccessKey: "mock-secret" }));
  pc.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock Note", body: "first" });
  await pc.sync.syncNow(); // no other device yet
  assert.equal((await onDisk(pc)).sync.devices[PC].name, "Mock PC");
  const phone = await copyOf(pc, PHONE, "Mock Phone", bucket);
  assert.deepEqual((await phone.sync.syncNow()).lastSync.with, ["Mock PC"]);
});

test("both devices show the same check code once each has the other's changes", async () => {
  const { pc, phone, personal } = await pair();
  pc.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock only on the PC", body: "b" });
  const [before, other] = [(await pc.sync.syncNow()).fingerprint, phone.sync.status().fingerprint];
  assert.match(before, /^[0-9a-f]{8}$/);
  assert.notEqual(before, other);
  await phone.sync.syncNow();
  await pc.sync.syncNow();
  assert.equal(phone.sync.status().fingerprint, pc.sync.status().fingerprint);
});

test("sync's own save stamps nothing and starts no other sync", async () => {
  const { pc, phone, personal } = await pair();
  const { id } = pc.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock from the PC", body: "b" });
  await pc.sync.syncNow();
  const runs = phone.runs;
  await phone.sync.syncNow();
  assert.equal(phone.saves.at(-1).bySync, true, "the merge was written as sync's save");
  await sleep(200); // longer than the after-save delay
  assert.equal(phone.runs, runs + 1, "no second sync");
  const meta = (await onDisk(phone)).sync.meta[id];
  assert.deepEqual(Object.keys(meta.vv), [PC], "the phone did not stamp the PC's item as its own edit");
});

test("a user save syncs a few seconds later, by itself", async () => {
  const { pc, phone, personal } = await pair();
  const runs = phone.runs;
  pc.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock later note", body: "b" });
  await pc.sync.syncNow();
  phone.vault.addSpace("Mock Client"); // any save on the phone
  await until(() => titles(phone).includes("Mock later note"));
  assert.equal(phone.runs, runs + 1);
});

test("edits on both keep both: a login's losing password goes to history, a note's losing body to a conflict copy", async () => {
  const { pc, phone, personal, portal, note } = await pair();
  pc.vault.saveEntry({ id: portal, kind: "login", spaceId: personal, title: "Mock Portal", username: "mock.user", password: "pw-from-pc" });
  pc.vault.saveEntry({ id: note, kind: "note", spaceId: personal, title: "Mock Note", body: "from the pc" });
  await pc.sync.syncNow();
  await sleep(5); // the phone's edits are later: they win
  phone.vault.saveEntry({ id: portal, kind: "login", spaceId: personal, title: "Mock Portal", username: "mock.user", password: "pw-from-phone" });
  phone.vault.saveEntry({ id: note, kind: "note", spaceId: personal, title: "Mock Note", body: "from the phone" });
  const status = await phone.sync.syncNow();

  assert.equal(phone.vault.getPassword(portal), "pw-from-phone");
  assert.ok([0, 1].map((i) => phone.vault.getSecret(portal, "history", i)).includes("pw-from-pc"), "the losing password is in history");
  const copy = phone.vault.publicView().entries.find((e) => e.title.startsWith("Mock Note (conflict copy, Mock PC, "));
  assert.ok(copy, titles(phone).join(" | "));
  assert.equal(phone.vault.getSecret(copy.id, "body"), "from the pc");
  assert.equal(phone.vault.getSecret(note, "body"), "from the phone");
  assert.deepEqual(status.needsLook, [{ id: copy.id, title: copy.title }]);

  await pc.sync.syncNow();
  assert.ok(titles(pc).includes(copy.title), "the PC gets the same copy");
  await phone.sync.syncNow();
  assert.equal(titles(phone).filter((t) => t.includes("conflict copy")).length, 1, "and no copy of the copy");
});

test("deletes on one device remove the items on the other; two of ten never wait for a review", async () => {
  const { pc, phone, note, portal } = await pair();
  for (const id of [note, portal]) {
    pc.vault.deleteEntry(id);
    pc.vault.deleteForever(id);
  }
  // 2 of 10: over 10%, under the 3 a share needs
  await pc.sync.syncNow();
  const status = await phone.sync.syncNow();
  assert.equal(status.review, null);
  assert.equal(entry(phone, note), undefined);
  assert.equal(entry(phone, portal), undefined);
});

test("a mass delete waits for review; Apply commits it, and a save made meanwhile is kept", async () => {
  const { pc, phone, personal } = await pair();
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(pc.vault.saveEntry({ kind: "note", spaceId: personal, title: `Mock item ${i}`, body: "b" }).id);
  await pc.sync.syncNow();
  await phone.sync.syncNow();
  for (const id of ids) {
    pc.vault.deleteEntry(id);
    pc.vault.deleteForever(id);
  }
  await pc.sync.syncNow();

  const before = fs.readFileSync(phone.file);
  let status = await phone.sync.syncNow();
  assert.equal(status.state, "review");
  assert.deepEqual(status.review.reasons, ["deletes"]);
  assert.deepEqual(status.review.from, ["Mock PC"]);
  assert.deepEqual([...status.review.deleted].sort(), ids.map((_, i) => `Mock item ${i}`));
  assert.ok(fs.readFileSync(phone.file).equals(before), "nothing written before the review");
  assert.equal(titles(phone).filter((t) => t.startsWith("Mock item")).length, 6);

  // Saved before Apply (its own sync has not run yet): the held merge goes in again over it, not instead of it.
  phone.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock typed during the review", body: "b" });
  status = await phone.sync.apply();
  assert.equal(status.state, "idle");
  assert.equal(titles(phone).filter((t) => t.startsWith("Mock item")).length, 0);
  assert.ok(titles(phone).includes("Mock typed during the review"));
});

test("nothing new: no write and no upload, however often the devices sync", async () => {
  const { bucket, pc, phone } = await pair();
  await phone.sync.syncNow(); // the PC's registration reaches the phone; from here nothing is new
  await pc.sync.syncNow();
  await sleep(100);
  const puts = bucket.puts();
  const [a, b] = [fs.readFileSync(pc.file), fs.readFileSync(phone.file)];
  for (let i = 0; i < 5; i++) {
    await pc.sync.syncNow();
    await phone.sync.syncNow();
  }
  await sleep(100);
  assert.equal(bucket.puts(), puts);
  assert.ok(fs.readFileSync(pc.file).equals(a) && fs.readFileSync(phone.file).equals(b));
});

test("a damaged newest snapshot falls back to the one before it, never to an empty vault", async () => {
  const { bucket, pc, phone, personal } = await pair();
  pc.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock kept note", body: "b" });
  await pc.sync.syncNow();
  pc.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock lost note", body: "b" });
  await pc.sync.syncNow();
  const newest = bucket.newest(PC);
  const disk = JSON.parse(bucket.objects.get(newest).toString());
  disk.data = `${disk.data.slice(0, 20)}AAAA${disk.data.slice(24)}`;
  bucket.objects.set(newest, Buffer.from(JSON.stringify(disk)));
  const status = await phone.sync.syncNow();
  assert.ok(titles(phone).includes("Mock kept note"));
  assert.ok(!titles(phone).includes("Mock lost note"));
  assert.equal(status.problems.length, 0, "an older snapshot opened, so nothing to report");
});

test("another vault or a clock a day ahead stops that device and says why", async () => {
  const { bucket, pc } = await pair();
  // A snapshot that says it was written two days from now.
  const key = bucket.newest(PHONE);
  const opened = await openFile(MASTER, JSON.parse(bucket.objects.get(key).toString()));
  const future = Date.now() + 2 * DAY;
  opened.data.sync.clock = [future, 0, PHONE];
  const forged = `kapevault/snapshots/${PHONE}/2026-09-28T00-00-00-000Z.kapevault`;
  bucket.objects.set(forged, Buffer.from(JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, opened.data))));
  bucket.modified.set(forged, Date.now() + DAY);
  let status = await pc.sync.syncNow();
  assert.match(status.problems.join(), /Mock Phone's clock is 2 days ahead/);

  opened.data.sync = { ...opened.data.sync, vaultId: "another-vault", clock: [1, 0, PHONE] };
  bucket.objects.set(forged, Buffer.from(JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, opened.data))));
  status = await pc.sync.syncNow();
  assert.match(status.problems.join(), /This bucket holds a different vault from Mock Phone/);
});

test("a master password set on another device: typed once here, adopted after a review, Hello off, older backups flagged", async () => {
  const { pc, phone, personal } = await pair();
  await pc.vault.changeMaster(MASTER, NEW_MASTER);
  pc.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock after the change", body: "b" });
  await pc.sync.syncNow();

  let status = await phone.sync.syncNow();
  assert.equal(status.newMaster, "Mock PC");
  assert.deepEqual(status.problems, [], "asked for, not a problem");
  assert.ok(!titles(phone).includes("Mock after the change"));

  const guesses = phone.guesses;
  assert.deepEqual(await phone.sync.adoptKey("not the password"), { ok: false, error: "That is not the master password set on Mock PC." });
  assert.equal(phone.guesses, guesses + 1, "a wrong try goes through the unlock throttle");
  assert.deepEqual(await phone.sync.adoptKey(NEW_MASTER), { ok: true });
  status = phone.sync.status();
  assert.deepEqual(status.review.reasons, ["key"]);
  assert.deepEqual(status.review.from, ["Mock PC"]);
  assert.equal(status.newMaster, null);
  assert.equal(phone.rekeyed, 0, "nothing adopted before Apply");

  status = await phone.sync.apply();
  assert.equal(status.state, "idle");
  assert.equal(phone.rekeyed, 1, "main turns Windows Hello off here");
  assert.ok(titles(phone).includes("Mock after the change"));
  const disk = await onDisk(phone, NEW_MASTER);
  assert.ok(disk, "the file opens with the new master password");
  assert.equal(disk.olderBackupsPending, true);
  assert.equal(await openFile(MASTER, JSON.parse(fs.readFileSync(phone.file, "utf8"))), null, "and no longer with the old one");

  // From here both use one key: no prompt, no problem, either way.
  pc.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock later still", body: "b" });
  await pc.sync.syncNow();
  status = await phone.sync.syncNow();
  assert.ok(titles(phone).includes("Mock later still"));
  assert.equal(status.newMaster, null);
  status = await pc.sync.syncNow();
  assert.deepEqual([status.newMaster, status.problems], [null, []]);
});

test("a device still on the old master password is skipped with no prompt", async () => {
  const { pc, phone } = await pair();
  await pc.vault.changeMaster(MASTER, NEW_MASTER);
  await pc.cloud.backupNow();
  const status = await pc.sync.syncNow(); // the phone's snapshots are under the old key
  assert.equal(status.newMaster, null);
  assert.match(status.problems.join(), /Mock Phone still uses the old master password\. Unlock it there\./);
  assert.equal(phone.rekeyed, 0);
});

test("two master password changes made apart: the later one wins on both", async () => {
  const { pc, phone } = await pair();
  await pc.vault.changeMaster(MASTER, NEW_MASTER);
  await pc.cloud.backupNow();
  await sleep(5);
  const LATER = "a later master phrase here orbit gazelle";
  await phone.vault.changeMaster(MASTER, LATER);
  await phone.cloud.backupNow();

  // The phone holds the later change: the PC's password opens the PC's changes, and the phone keeps its key.
  let status = await phone.sync.syncNow();
  assert.equal(status.newMaster, "Mock PC");
  assert.deepEqual(await phone.sync.adoptKey(NEW_MASTER), { ok: true });
  assert.equal(phone.sync.status().review, null, "no key to adopt, so nothing to review");
  assert.ok(await onDisk(phone, LATER));
  assert.equal(phone.rekeyed, 0);
  pc.vault.addSpace("Mock Client"); // the PC saves again under its own key
  await pc.cloud.flush();
  status = await phone.sync.syncNow();
  assert.equal(status.newMaster, null, "not asked again");
  assert.match(status.problems.join(), /Mock PC still uses the old master password/, "the PC's key is an older one now");

  // The PC holds the earlier change: it adopts the phone's.
  await pc.sync.syncNow();
  assert.deepEqual(await pc.sync.adoptKey(LATER), { ok: true });
  assert.deepEqual(pc.sync.status().review.reasons, ["key"]);
  await pc.sync.apply();
  assert.ok(await onDisk(pc, LATER));
  await pc.cloud.flush();
  status = await phone.sync.syncNow();
  assert.deepEqual([status.newMaster, status.problems], [null, []], "both on the phone's key");
});

test("with automatic backup off, Sync now still syncs and sends the vault up; nothing runs by itself", async () => {
  const { bucket, pc, phone, personal } = await pair();
  phone.vault.setCloudAuto(false);
  assert.equal(phone.sync.status().manual, true);
  assert.equal(phone.sync.status().off, null);
  pc.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock from the PC", body: "b" });
  await pc.sync.syncNow();

  const runs = phone.runs;
  phone.vault.addSpace("Mock Client");
  phone.sync.afterUnlock();
  await sleep(100);
  assert.equal(phone.runs, runs, "no automatic run");
  const puts = bucket.puts();
  await phone.sync.syncNow();
  assert.ok(titles(phone).includes("Mock from the PC"));
  assert.equal(bucket.puts(), puts + 1, "the merged vault went up");
  await phone.sync.syncNow();
  assert.equal(bucket.puts(), puts + 1, "nothing new, nothing sent");
  await pc.sync.syncNow();
  assert.ok(pc.vault.publicView().spaces.some((s) => s.name === "Mock Client"), "the phone's own change reached the PC");
});

test("sync is off while locked, without cloud backup, or with no install id", async () => {
  const { pc } = await pair();
  pc.vault.setCloud(null);
  assert.equal((await pc.sync.syncNow()).off, "no-cloud");
  pc.vault.lock();
  pc.sync.locked();
  assert.equal(pc.sync.status().off, "locked");
  const runs = pc.runs;
  pc.sync.afterUnlock();
  await sleep(50);
  assert.equal(pc.runs, runs);

  const bucket = fakeBucket();
  const nameless = wire(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-sync-")), "", "Mock PC", bucket);
  await nameless.vault.create(MASTER);
  nameless.vault.setCloud(configFromInput({ url: "https://0123abcd.r2.cloudflarestorage.com/mock-bucket", accessKeyId: "k", secretAccessKey: "s" }));
  assert.equal((await nameless.sync.syncNow()).off, "no-id");
});

test("one of sync, restore and master password change at a time: the others wait for a sync, a second one is refused", async () => {
  const { pc, phone } = await pair();
  const syncing = phone.sync.syncNow();
  assert.equal(phone.sync.status().state, "running");
  const restore = phone.sync.exclusive("restore", async () => {
    await sleep(30);
    return { ok: true, during: phone.sync.status().state };
  });
  assert.deepEqual(await phone.sync.exclusive("master", async () => ({ ok: true })), { ok: false, error: "A restore is already running." });
  await syncing;
  assert.deepEqual(await restore, { ok: true, during: "idle" }, "the restore ran after the sync, not during it");
  const runs = pc.runs;
  const held = pc.sync.exclusive("master", () => sleep(50));
  await pc.sync.syncNow();
  await held;
  assert.equal(pc.runs, runs, "no sync during a master password change");
});

test("after a restore nothing syncs - not after a relaunch or an unlock either - until the question is answered", async () => {
  const { bucket, pc, phone, personal } = await pair();
  const backup = bucket.objects.get(bucket.newest(PHONE));
  pc.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock newer on the PC", body: "b" });
  await pc.sync.syncNow();
  await restoreFrom(phone, backup);
  assert.equal(phone.sync.status().off, "restored");

  // The app is closed and started again: a new sync loop on the same folder.
  phone.vault.lock();
  phone.sync.locked();
  const relaunched = wire(phone.dir, PHONE, "Mock Phone", bucket);
  await relaunched.vault.unlock(MASTER);
  relaunched.sync.afterUnlock();
  relaunched.vault.addSpace("Mock Client");
  await sleep(100);
  assert.equal(relaunched.runs, 0);
  assert.equal(relaunched.sync.status().off, "restored");
  await relaunched.sync.syncNow();
  assert.equal(relaunched.runs, 0, "Sync now waits for the answer too");

  // "Merge it in": a plain sync from here.
  const status = await relaunched.sync.answerRestore(false);
  assert.equal(status.off, null);
  assert.ok(titles(relaunched).includes("Mock newer on the PC"));
  assert.equal(fs.existsSync(path.join(phone.dir, "sync-after-restore")), false);
});

test("merge it in: what another device deleted stays deleted", async () => {
  const { bucket, pc, phone, note } = await pair();
  const backup = bucket.objects.get(bucket.newest(PHONE)); // still has the note
  pc.vault.deleteEntry(note);
  await pc.sync.syncNow();
  await restoreFrom(phone, backup);
  assert.ok(entry(phone, note), "the restore brought it back here");
  await phone.sync.answerRestore(false);
  assert.equal(entry(phone, note), undefined);
});

test("make this the vault everywhere: the other device takes it after a review, and keeps its own changes as copies", async () => {
  const { bucket, pc, phone, note, personal } = await pair();
  const backup = bucket.objects.get(bucket.newest(PHONE));
  pc.vault.deleteEntry(note); // on the PC after that backup: a delete and a new item
  pc.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock new on the PC", body: "b" });
  await pc.sync.syncNow();

  await restoreFrom(phone, backup);
  const answered = await phone.sync.answerRestore(true);
  assert.equal(answered.off, null);
  assert.equal(answered.problems.length, 1);
  assert.match(answered.problems[0], /Mock PC has not taken the restored vault yet/);
  assert.ok(entry(phone, note), "the phone keeps its restored vault");

  let status = await pc.sync.syncNow();
  assert.ok(status.review.reasons.includes("epoch"));
  assert.equal(entry(pc, note), undefined, "nothing changes before Apply");
  status = await pc.sync.apply();
  assert.equal(status.state, "idle");
  assert.ok(entry(pc, note), "the delete made after the backup is undone");
  assert.ok(!titles(pc).includes("Mock new on the PC"));
  assert.ok(titles(pc).some((t) => t.startsWith("Mock new on the PC (conflict copy, Mock PC, ")), "kept as a copy");

  await pc.cloud.flush();
  await phone.sync.syncNow();
  await pc.sync.syncNow();
  assert.equal(phone.sync.status().fingerprint, pc.sync.status().fingerprint);
  assert.deepEqual(phone.sync.status().problems, []);
});

test("two installs sharing an id: the one that finds a snapshot it never sent takes a new id", async () => {
  const { bucket, phone, personal } = await pair();
  const copied = await copyOf(phone, PHONE, "Mock Phone copy", bucket);
  fs.copyFileSync(path.join(phone.dir, "sent-snapshots.json"), path.join(copied.dir, "sent-snapshots.json")); // the whole folder was copied
  copied.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock from the copy", body: "b" });
  await copied.sync.syncNow();

  await phone.sync.syncNow();
  assert.notEqual(phone.id, PHONE, "a new id");
  assert.equal(copied.id, PHONE);
  assert.ok((await onDisk(phone)).syncLog.some((e) => e.renewedId));
  await phone.sync.syncNow(); // the copy is another device now
  assert.ok(titles(phone).includes("Mock from the copy"));
  await phone.sync.syncNow();
  assert.equal(phone.sync.status().devices.length, 2, "the PC and the copy");
});

test("a device removed from sync is never merged again, and the removed one says so", async () => {
  const { pc, phone, personal } = await pair();
  const [ref] = phone.sync.status().devices.map((d) => d.ref);
  let status = phone.sync.revoke(ref);
  assert.deepEqual(status.devices, [], "no longer listed");
  pc.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock from the removed PC", body: "b" });
  await pc.sync.syncNow();
  status = await phone.sync.syncNow();
  assert.ok(!titles(phone).includes("Mock from the removed PC"));
  assert.deepEqual(status.problems, []);

  status = await pc.sync.syncNow(); // the PC reads the phone's snapshot with the removal in it
  assert.equal(status.off, "removed");
  assert.equal(phone.sync.revoke("0000000000000000").devices.length, 0, "an unknown ref changes nothing");
});

// Audit crypto 1 (2026-10-04): removing a device only stops its folder merging. A device that still has
// the vault key can come back under a new install id, so the removal stays "unfinished" until the master
// password changes.
test("a removed device stays on the lock-out list until the master password changes after it", async () => {
  const { pc, phone } = await pair();
  assert.deepEqual(pc.sync.status().lockOut, [], "nobody removed yet");
  const [ref] = pc.sync.status().devices.map((d) => d.ref);
  const status = pc.sync.revoke(ref);
  assert.deepEqual(status.devices, []);
  assert.deepEqual(status.lockOut.map((d) => d.name), ["Mock Phone"], "removed but not locked out");
  assert.deepEqual(pc.sync.status().lockOut.map((d) => d.ref), [ref]);

  await pc.vault.changeMaster(MASTER, NEW_MASTER);
  assert.deepEqual(pc.sync.status().lockOut, [], "a new key was made after the removal");
  assert.equal(phone.vault.status().unlocked, true);
});

test("a master password changed BEFORE the removal does not count as locking the device out", async () => {
  const { pc } = await pair();
  await pc.vault.changeMaster(MASTER, NEW_MASTER);
  const [ref] = pc.sync.status().devices.map((d) => d.ref);
  assert.equal(pc.sync.revoke(ref).lockOut.length, 1);
});

// SECURITY-AUDIT M-1: planted device folders cost downloads on every run and could block a restore.
test("planted junk devices: a few read per run, never again once they failed, and a real new device still joins", async () => {
  const { bucket, pc } = await pair();
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const plant = (owner, bytes) => {
    const k = `kapevault/snapshots/${owner}/2026-09-27T07-00-00-000Z.kapevault`;
    bucket.objects.set(k, Buffer.from(bytes));
    bucket.modified.set(k, Date.now());
  };
  for (let n = 1; n <= 30; n++) plant(id(n), "not a vault");
  const gets = () => bucket.log.filter((l) => l.startsWith("GET kapevault/snapshots/")).length;

  let before = gets();
  let status = await pc.sync.syncNow();
  assert.ok(gets() - before <= 3 * 9, "at most the phone plus 8 newcomers, three tries each");
  assert.ok(status.problems.length <= 9);
  for (let i = 0; i < 6; i++) await pc.sync.syncNow(); // 30 junk devices, 8 new ones a run, all failed after 4 runs
  before = gets();
  status = await pc.sync.syncNow();
  assert.equal(gets() - before, 0, "nothing left to download: the junk is remembered");
  assert.deepEqual(status.problems, []);

  // A real second phone joins anyway, and a stranger under another master password is never asked for.
  const other = await copyOf(pc, "ffffffff-1b7e-4d8e-9a53-6f0c1d2e3f40", "Mock Tablet", bucket);
  other.vault.saveEntry({ kind: "note", spaceId: other.vault.publicView().spaces[0].id, title: "Mock from tablet", body: "b" });
  await other.cloud.backupNow();
  await pc.sync.syncNow();
  assert.ok(titles(pc).includes("Mock from tablet"), "the new device is read");
  assert.equal(pc.sync.status().newMaster, null);
});

test("an unknown device under another master password never becomes the new-master prompt", async () => {
  const { bucket, pc } = await pair();
  const stranger = wire(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-sync-")), "00000000-0000-4000-8000-000000000001", "Junk", fakeBucket());
  await stranger.vault.create("xK9#mQ2$vL7@pZ4!wR8&tN3");
  await stranger.vault.lock?.();
  const k = `kapevault/snapshots/00000000-0000-4000-8000-000000000001/2026-09-27T07-00-00-000Z.kapevault`;
  bucket.objects.set(k, fs.readFileSync(stranger.file));
  bucket.modified.set(k, Date.now());
  const status = await pc.sync.syncNow();
  assert.equal(status.newMaster, null);
  const before = bucket.log.length;
  await pc.sync.syncNow();
  assert.ok(!bucket.log.slice(before).some((l) => l.includes("GET") && l.includes("00000000-0000-4000-8000-000000000001")), "not downloaded again");
});

// SYNC audit 2026-10-04 (crypto 9): anyone with the bucket keys can put one file under a known device's
// folder; it must not hide that device's real snapshots.
test("a planted unknown-password snapshot in a known device's folder does not hide its real ones", async () => {
  const { bucket, pc, phone, personal } = await pair();
  phone.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock phone note", body: "b" });
  await phone.sync.syncNow();
  const stranger = wire(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-sync-")), "00000000-0000-4000-8000-000000000002", "Junk", fakeBucket());
  await stranger.vault.create("xK9#mQ2$vL7@pZ4!wR8&tN3");
  const planted = `kapevault/snapshots/${PHONE}/2026-09-27T07-00-00-000Z.kapevault`;
  bucket.objects.set(planted, fs.readFileSync(stranger.file));
  bucket.modified.set(planted, Date.now() + DAY);
  const status = await pc.sync.syncNow();
  assert.ok(titles(pc).includes("Mock phone note"), "the phone's real snapshot is still merged");
  assert.equal(status.newMaster, "Mock Phone", "and the prompt is still shown");
});

// A snapshot a newer KAPEVault wrote, planted as the phone's newest: change(header, data) edits the
// opened copy and the file header before it is sealed again.
function plantNewer(bucket, opened, { header = {}, data = (d) => d } = {}) {
  const file = { ...encryptWithKey(opened.key, opened.kdf, opened.salt, data(structuredClone(opened.data))), ...header };
  const key = `kapevault/snapshots/${PHONE}/2026-09-30T00-00-00-000Z.kapevault`;
  bucket.objects.set(key, Buffer.from(JSON.stringify(file)));
  bucket.modified.set(key, Date.now() + DAY);
}

const NEWER = "Mock Phone runs a newer KAPEVault. Update this app.";

for (const [what, planted] of [
  ["a sync object at v 2", { data: (d) => ({ ...d, sync: { ...d.sync, v: 2, gone: {} } }) }],
  ["a minReader of 2", { data: (d) => ({ ...d, minReader: 2 }) }],
  ["a file header at version 2", { header: { version: 2 } }],
]) {
  test(`a snapshot with ${what} is skipped and named, never merged and never read as damaged; this vault is not touched`, async () => {
    const { bucket, pc, phone, personal } = await pair();
    phone.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock from the phone", body: "b" });
    await phone.sync.syncNow(); // an ordinary snapshot, the one before the newer one
    plantNewer(bucket, await openFile(MASTER, JSON.parse(fs.readFileSync(phone.file, "utf8"))), planted);
    const itemsBefore = titles(pc);
    const sync = (await onDisk(pc)).sync;
    const status = await pc.sync.syncNow();
    assert.deepEqual(status.problems, [NEWER]);
    assert.equal(status.error, "", "a newer device is not a failed run");
    assert.ok(!titles(pc).includes("Mock from the phone"), "nothing of it is merged");
    assert.deepEqual((await onDisk(pc)).sync.gone, sync.gone, "the sync record keeps its tombstones");
    assert.deepEqual((await onDisk(pc)).sync.devices, sync.devices);
    assert.equal(status.state, "idle");
    assert.deepEqual(titles(pc), itemsBefore, "the vault holds the same items");
  });
}

for (const [what, planted] of [
  ["a sync object at v 2", { data: (d) => ({ ...d, sync: { ...d.sync, v: 2, gone: {} } }) }],
  ["a file header at version 2", { header: { version: 2 } }],
]) {
  test(`a snapshot with ${what} is downloaded once and named on every run, then read again when it changes`, async () => {
    const { bucket, pc, phone } = await pair();
    await phone.sync.syncNow();
    const opened = await openFile(MASTER, JSON.parse(fs.readFileSync(phone.file, "utf8")));
    plantNewer(bucket, opened, planted);
    const key = `kapevault/snapshots/${PHONE}/2026-09-30T00-00-00-000Z.kapevault`;
    const gets = () => bucket.log.filter((l) => l === `GET ${key}`).length;
    assert.deepEqual((await pc.sync.syncNow()).problems, [NEWER]);
    assert.equal(gets(), 1);
    for (let i = 0; i < 2; i++) assert.deepEqual((await pc.sync.syncNow()).problems, [NEWER], "still named");
    assert.equal(gets(), 1, "but not downloaded again");
    bucket.modified.set(key, Date.now() + 2 * DAY); // the object changed
    assert.deepEqual((await pc.sync.syncNow()).problems, [NEWER]);
    assert.equal(gets(), 2, "read again once it changed");
  });
}

test("a newer device's snapshot under a new master password is refused when its master password is typed, and nothing is written", async () => {
  const { bucket, pc, phone, personal } = await pair();
  await pc.vault.changeMaster(MASTER, NEW_MASTER);
  pc.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock after the change", body: "b" });
  await pc.sync.syncNow();
  assert.equal((await phone.sync.syncNow()).newMaster, "Mock PC");
  // The PC's newest snapshot, as a newer app would have sealed it.
  const key = bucket.newest(PC);
  const opened = await openFile(NEW_MASTER, JSON.parse(bucket.objects.get(key).toString()));
  opened.data.sync = { ...opened.data.sync, v: 2 };
  bucket.objects.set(key, Buffer.from(JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, opened.data))));
  const before = fs.readFileSync(phone.file);
  assert.deepEqual(await phone.sync.adoptKey(NEW_MASTER), { ok: false, error: "This vault was saved by a newer KAPEVault. Update this app to open it." });
  assert.equal(phone.sync.status().review, null);
  assert.ok(fs.readFileSync(phone.file).equals(before), "the file is byte for byte as it was");
});
