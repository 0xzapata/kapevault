const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCloudBackup, snapshotKey, snapshotTime, snapshotOwner, snapshotsToPrune, configFromInput, checkBackupBytes, setupCode } = require("./cloud-backup.cjs");
const { createVaultSession } = require("./vault-session.cjs");

const DAY = 86_400_000;
const URL_OK = "https://0123abcd.r2.cloudflarestorage.com/vault-backups";

test("snapshot names round-trip to their time and sort by it", () => {
  const at = new Date("2026-09-25T07:15:02.123Z");
  assert.equal(snapshotKey(at), "kapevault/snapshots/2026-09-25T07-15-02-123Z.kapevault");
  assert.equal(snapshotTime(snapshotKey(at)), at.getTime());
  assert.equal(snapshotTime(snapshotKey(at, "", "before-restore")), at.getTime());
  for (const other of ["kapevault/snapshots/notes.txt", "kapevault/snapshots/2026-09-25T07-15-02-123Z-x.kapevault", "other/2026-09-25T07-15-02-123Z.kapevault"]) {
    assert.equal(snapshotTime(other), null, other);
  }
});

test("pruning keeps the newest 20, then one per day for 60 days, and never touches other objects", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  // 30 snapshots a minute apart today, then 3 a day for the previous 90 days
  const keys = [];
  for (let m = 0; m < 30; m++) keys.push(snapshotKey(new Date(now - m * 60_000)));
  for (let d = 1; d <= 90; d++) for (let h = 0; h < 3; h++) keys.push(snapshotKey(new Date(now - d * DAY - h * 3_600_000)));
  keys.push("kapevault/snapshots/readme.txt", "someone-else/file.bin");

  const doomed = new Set(snapshotsToPrune(keys, now));
  const kept = keys.filter((k) => !doomed.has(k) && snapshotTime(k) !== null);
  assert.ok(!doomed.has("kapevault/snapshots/readme.txt") && !doomed.has("someone-else/file.bin"));
  for (let m = 0; m < 20; m++) assert.ok(!doomed.has(keys[m]), `recent ${m} kept`);
  const days = kept.map((k) => new Date(snapshotTime(k)).toLocaleDateString("en-CA"));
  const olderDays = days.slice(20);
  assert.equal(new Set(olderDays).size, olderDays.length, "at most one per day past the newest 20");
  assert.ok(kept.every((k) => now - snapshotTime(k) < 60 * DAY), "nothing older than 60 days");
  assert.ok(kept.length >= 58 && kept.length <= 80, String(kept.length));
});

test("configFromInput checks the URL and keys, and a blank secret keeps the saved one", () => {
  assert.throws(() => configFromInput({ url: "https://example.com/b", accessKeyId: "k", secretAccessKey: "s" }), /S3 API URL/);
  assert.throws(() => configFromInput({ url: URL_OK, accessKeyId: "k", secretAccessKey: "" }), /secret/);
  const saved = { secretAccessKey: "old-secret", auto: false };
  assert.deepEqual(configFromInput({ url: URL_OK, accessKeyId: " key ", secretAccessKey: "" }, saved), {
    endpoint: "https://0123abcd.r2.cloudflarestorage.com",
    bucket: "vault-backups",
    accessKeyId: "key",
    secretAccessKey: "old-secret",
    auto: false,
  });
  assert.equal(configFromInput({ url: URL_OK, accessKeyId: "k", secretAccessKey: "s" }).auto, true);
});

test("only a KAPEVault file may be restored", () => {
  const b64 = (n) => Buffer.alloc(n, 7).toString("base64");
  const shape = (over = {}, kdf = {}) => ({ format: "kapevault", version: 1, kdf: { name: "scrypt", N: 2 ** 17, r: 8, p: 1, salt: b64(16), ...kdf }, iv: b64(12), tag: b64(16), data: b64(31), ...over });
  const good = Buffer.from(JSON.stringify(shape()));
  assert.equal(checkBackupBytes(good), good);
  const legacy = Buffer.from(JSON.stringify(shape({ format: "bovault" }))); // saved before the rename
  assert.equal(checkBackupBytes(legacy), legacy);
  const bad = [
    JSON.stringify(shape({ format: "somethingelse" })),
    "not json",
    "{}",
    JSON.stringify(shape({ version: 2 })),
    JSON.stringify({ format: "kapevault", version: 1 }),
    // A planted backup must not choose work that never finishes: huge p, other r, oversized N.
    JSON.stringify(shape({}, { p: 2 ** 20 })),
    JSON.stringify(shape({}, { r: 1000 })),
    JSON.stringify(shape({}, { N: 2 ** 22 })),
    JSON.stringify(shape({}, { N: 100000 })),
    JSON.stringify(shape({ tag: b64(8) })), // a short tag would be forgeable
  ];
  for (const b of bad) assert.throws(() => checkBackupBytes(Buffer.from(b)), /not a KAPEVault file/);
});

test("R2 keys are stored encrypted, the page view has no secret, and a restore brings back the old vault", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-test-")), "vault.kapevault");
  let writes = 0;
  const vault = createVaultSession(file, { onPersist: () => writes++ });
  await vault.create("correct horse battery orbit gazelle");
  const before = fs.readFileSync(file);
  vault.setCloud(configFromInput({ url: URL_OK, accessKeyId: "key-id-123", secretAccessKey: "super-secret-r2" }));
  assert.equal(writes, 2);
  assert.ok(!fs.readFileSync(file, "utf8").includes("super-secret-r2"));
  assert.deepEqual(vault.cloudView(), { url: URL_OK, accessKeyId: "key-id-123", auto: true, olderBackups: false });
  assert.ok(!JSON.stringify(vault.publicView()).includes("super-secret-r2"));
  vault.setCloudAuto(false);
  assert.equal(vault.cloudView().auto, false);

  assert.equal((await vault.verifyBackup(before.toString("utf8"), "wrong password here")).ok, false, "a wrong password changes nothing");
  assert.ok(vault.cloudConfig(), "still the current vault");
  const check = await vault.verifyBackup(before.toString("utf8"), "correct horse battery orbit gazelle");
  assert.equal(vault.commitRestore(before.toString("utf8"), check.opened, { cloud: vault.cloudConfig() }).keptCloud, true);
  assert.equal(vault.cloudView().accessKeyId, "key-id-123", "the restored vault keeps this device's R2 keys: they are its setup, not vault content");

  // After a master change with cloud on, the offer to delete old-password backups stays until done.
  vault.setCloud(configFromInput({ url: URL_OK, accessKeyId: "key-id-123", secretAccessKey: "super-secret-r2" }));
  assert.ok((await vault.changeMaster("correct horse battery orbit gazelle", "another strong passphrase")).ok);
  assert.equal(vault.cloudView().olderBackups, true);
  vault.clearOlderBackups();
  assert.equal(vault.cloudView().olderBackups, false);
});

test("each install names its snapshots, and older unnamed ones still parse", () => {
  const id = "0f8f5a0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
  const at = new Date(Date.UTC(2026, 8, 25, 10, 20, 30, 400));
  const key = snapshotKey(at, id);
  assert.equal(key, `kapevault/snapshots/${id}/2026-09-25T10-20-30-400Z.kapevault`);
  assert.equal(snapshotTime(key), at.getTime());
  assert.equal(snapshotOwner(key), id);
  const legacy = "kapevault/snapshots/2026-09-25T10-20-30-400Z.kapevault";
  assert.equal(snapshotTime(legacy), at.getTime());
  assert.equal(snapshotOwner(legacy), null);
  assert.equal(snapshotTime(`kapevault/snapshots/../${id}/2026-09-25T10-20-30-400Z.kapevault`), null);
});

test("snapshots uploaded as BOVault (before the rename) still list, restore and thin out", () => {
  const id = "0f8f5a0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
  const at = Date.UTC(2026, 8, 25, 10, 20, 30, 400);
  const old = `bovault/snapshots/${id}/2026-09-25T10-20-30-400Z.bovault`;
  assert.equal(snapshotTime(old), at);
  assert.equal(snapshotOwner(old), id);
  assert.equal(snapshotTime("bovault/snapshots/2026-09-25T10-20-30-400Z.bovault"), at);
  // The folder and the extension must agree; a mix is not one of ours.
  assert.equal(snapshotTime("bovault/snapshots/2026-09-25T10-20-30-400Z.kapevault"), null);
  assert.equal(snapshotTime("kapevault/snapshots/2026-09-25T10-20-30-400Z.bovault"), null);
});

// A bucket in memory, reached through a stand-in courier (the real one is the system curl).
function fakeBucket() {
  const objects = new Map();
  const stored = new Map(); // key -> when the bucket stored it (R2's LastModified); planted ones: first listed
  const log = [];
  const reply = (status, body = "") => ({ status, body: Buffer.from(body) });
  const storedAt = (k) => stored.get(k) ?? stored.set(k, Date.now()).get(k);
  const transport = async ({ method, url, body, maxBytes, tooLarge }) => {
    const u = new URL(url);
    const key = decodeURIComponent(u.pathname.split("/").slice(2).join("/"));
    log.push(`${method} ${key}`);
    if (method === "PUT") return objects.set(key, Buffer.from(body)), stored.set(key, Date.now()), reply(200);
    if (method === "DELETE") return objects.delete(key), reply(204);
    if (!key) {
      const prefix = u.searchParams.get("prefix") ?? "";
      const items = [...objects].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `<Contents><Key>${k}</Key><LastModified>${new Date(storedAt(k)).toISOString()}</LastModified><Size>${v.length}</Size></Contents>`);
      return reply(200, `<ListBucketResult>${items.join("")}</ListBucketResult>`);
    }
    if (!objects.has(key)) return reply(404, "<Error><Code>NoSuchKey</Code></Error>");
    if (objects.get(key).length > maxBytes) throw new Error(tooLarge);
    return { status: 200, body: objects.get(key) };
  };
  return { objects, log, transport };
}

const until = async (done) => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(done(), "timed out");
};

test("the Opener in the bucket is checked byte for byte and put back when changed", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-test-")), "vault.kapevault");
  const vault = createVaultSession(file);
  await vault.create("correct horse battery orbit gazelle");
  vault.setCloud(configFromInput({ url: URL_OK, accessKeyId: "key-id-123", secretAccessKey: "mock-r2-secret" }));
  const KEY = "kapevault/opener/kapevault-opener-1.0.0.html";
  const REAL = "<!doctype html><title>mock opener</title>";
  const bucket = fakeBucket();
  // Each run of the app checks each bucket once, so every case is a fresh cloud backup.
  const run = async () => {
    const cloud = createCloudBackup({ vault, installId: () => "0f8f5a0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b", opener: { key: KEY, html: () => REAL }, transport: bucket.transport });
    const gets = bucket.log.filter((l) => l === `GET ${KEY}`).length;
    await cloud.backupNow();
    await until(() => bucket.log.filter((l) => l === `GET ${KEY}`).length > gets);
    await new Promise((r) => setTimeout(r, 30)); // a put, if any, follows the read
    return cloud;
  };
  const opener = () => bucket.objects.get(KEY)?.toString();
  const puts = () => bucket.log.filter((l) => l === `PUT ${KEY}`).length;

  let cloud = await run();
  assert.equal(opener(), REAL, "missing: uploaded");
  assert.equal(cloud.openerReplaced(), false, "nothing to warn about");

  cloud = await run();
  assert.equal(puts(), 1, "the real page is left as it is");
  assert.equal(cloud.openerReplaced(), false);

  bucket.objects.set(KEY, Buffer.from(REAL.replace("mock opener", "mock opener!"))); // same size, one byte changed
  cloud = await run();
  assert.equal(opener(), REAL, "a changed page is replaced");
  assert.equal(cloud.openerReplaced(), true, "and Settings is told");

  bucket.objects.set(KEY, Buffer.from(`${REAL}<script>mock</script>`)); // larger than the real page
  cloud = await run();
  assert.equal(opener(), REAL);
  assert.equal(cloud.openerReplaced(), true);
});

const ID = "0f8f5a0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
// One fake bucket per bucket name, so a test can tell which bucket a request went to.
function fakeBuckets() {
  const buckets = new Map();
  const bucket = (name) => (buckets.has(name) || buckets.set(name, fakeBucket()), buckets.get(name));
  const transport = (req) => bucket(new URL(req.url).pathname.split("/")[1]).transport(req);
  return { bucket, transport };
}

test("before a restore, the current vault goes only to the SAVED bucket, never to keys typed for the restore", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-test-")), "vault.kapevault");
  const vault = createVaultSession(file);
  await vault.create("correct horse battery orbit gazelle");
  const buckets = fakeBuckets();
  const cloud = createCloudBackup({ vault, installId: () => ID, transport: buckets.transport });
  const typed = { url: "https://0123abcd.r2.cloudflarestorage.com/typed-bucket", accessKeyId: "mock-typed", secretAccessKey: "mock-typed-secret" };
  const puts = (name) => buckets.bucket(name).log.filter((l) => l.startsWith("PUT")).length;

  // Unlocked with no cloud backup: nothing saved to upload to, so nothing goes anywhere.
  await assert.rejects(cloud.saveBeforeRestore(typed), /nothing was restored/);
  vault.lock();
  await assert.rejects(cloud.saveBeforeRestore(typed), /nothing was restored/);
  assert.equal(puts("typed-bucket"), 0, "the typed bucket never receives this vault");

  await vault.unlock("correct horse battery orbit gazelle");
  vault.setCloud(configFromInput({ url: URL_OK, accessKeyId: "mock-saved", secretAccessKey: "mock-saved-secret" }));
  await cloud.saveBeforeRestore(typed);
  assert.equal(puts("typed-bucket"), 0);
  assert.equal(puts("vault-backups"), 1, "the saved bucket gets it");
  assert.ok([...buckets.bucket("vault-backups").objects.keys()][0].endsWith("-before-restore.kapevault"));
});

test("pruning never takes the way back from a restore: -before-restore snapshots stay 30 days, the newest for good", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  const at = (ms, note = "") => snapshotKey(new Date(now - ms), ID, note);
  const undoToday = at(30 * 60_000, "before-restore");
  const regularToday = Array.from({ length: 25 }, (_, m) => at(m * 60_000)); // 25 newer backups the same day
  const regularYesterday = at(DAY + 2 * 3_600_000);
  const undoYesterday = at(DAY + 3_600_000, "before-restore"); // newer than that day's regular one
  const undo20 = at(20 * DAY, "before-restore");
  const undo40 = at(40 * DAY, "before-restore");
  const doomed = new Set(snapshotsToPrune([undoToday, ...regularToday, regularYesterday, undoYesterday, undo20, undo40], now));

  for (const kept of [undoToday, undoYesterday, undo20]) assert.ok(!doomed.has(kept), `${kept} kept for 30 days`);
  assert.ok(!doomed.has(regularYesterday), "a before-restore snapshot never takes its day's place from the regular one");
  assert.ok(doomed.has(undo40), "past 30 days, an older one goes");
  assert.deepEqual(regularToday.filter((k) => doomed.has(k)), regularToday.slice(20), "the regular rules are unchanged");

  const lastUndo = at(100 * DAY, "before-restore");
  assert.ok(!snapshotsToPrune([lastUndo, ...regularToday], now).includes(lastUndo), "the newest is kept however old");
});

// A vault wired like main: every save schedules a backup.
async function wired(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-test-"));
  let cloud = null;
  const vault = createVaultSession(path.join(dir, "vault.kapevault"), { onPersist: () => cloud?.schedule() });
  await vault.create("correct horse battery orbit gazelle");
  const bucket = fakeBucket();
  cloud = createCloudBackup({ vault, installId: () => ID, delayMs: 40, transport: bucket.transport, ...options });
  vault.setCloud(configFromInput({ url: URL_OK, accessKeyId: "mock-key", secretAccessKey: "mock-secret" }));
  const puts = () => bucket.log.filter((l) => l.startsWith("PUT kapevault/snapshots/")).length;
  return { dir, vault, cloud, bucket, puts };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("turning auto backup off cancels a backup already waiting", async () => {
  const { vault, puts } = await wired();
  vault.setCloudAuto(false); // the setCloud save above left one waiting
  await sleep(150);
  assert.equal(puts(), 0);
});

test("a backup still owed survives a crash: a marker beside the vault, and the next unlock uploads", async () => {
  let down = true;
  const offline = fakeBucket();
  const transport = (req) => (down ? Promise.reject(new Error("Could not reach R2.")) : offline.transport(req));
  const { dir, vault, cloud } = await wired({ transport });
  const marker = path.join(dir, "backup-pending");
  assert.ok(fs.existsSync(marker), "written as soon as a change waits");
  await until(() => cloud.status().state === "error");
  assert.ok(fs.existsSync(marker), "and kept when the upload fails");
  assert.equal(fs.readFileSync(marker, "utf8"), "", "it holds nothing about the vault");

  // Locked the way main locks (flush, then lock), then the app is killed: the next start knows
  // nothing but the marker.
  await cloud.flush();
  vault.lock();
  down = false;
  const next = createCloudBackup({ vault, installId: () => ID, delayMs: 10, transport });
  await vault.unlock("correct horse battery orbit gazelle");
  next.onUnlocked();
  await until(() => next.status().state === "ok");
  assert.equal(offline.log.filter((l) => l.startsWith("PUT kapevault/snapshots/")).length, 1);
  assert.equal(fs.existsSync(marker), false, "cleared once it is up");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["sent-snapshots.json", "vault.kapevault"]);
});

test("the marker stays while a newer change still waits behind an upload", async () => {
  const { dir, vault, cloud, puts } = await wired();
  const marker = path.join(dir, "backup-pending");
  await until(() => puts() === 1);
  await until(() => !fs.existsSync(marker));
  const upload = cloud.backupNow();
  vault.addSpace("Mock Client"); // saved while that upload is on its way
  await upload;
  assert.ok(fs.existsSync(marker), "the newer change is not up yet");
  await until(() => puts() === 3 && !fs.existsSync(marker));
});

test("a device never uploads a vault file it cannot open with its own key (SYNC.md 3.5)", async () => {
  const { dir, cloud, puts } = await wired();
  await until(() => puts() === 1);
  const file = path.join(dir, "vault.kapevault");
  const disk = JSON.parse(fs.readFileSync(file, "utf8"));
  const bytes = Buffer.from(disk.data, "base64");
  bytes[0] ^= 1; // changed on disk behind the app's back
  disk.data = bytes.toString("base64");
  fs.writeFileSync(file, JSON.stringify(disk));
  await assert.rejects(cloud.backupNow(), /does not open with this vault's key/);
  assert.equal(puts(), 1);
  assert.equal(cloud.status().state, "error");
});

test("sync reads every snapshot with R2's LastModified, and one snapshot's bytes as stored", async () => {
  const { vault, cloud, bucket } = await wired();
  const other = `kapevault/snapshots/7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e5f/2026-09-27T07-00-00-000Z.kapevault`;
  bucket.objects.set(other, Buffer.from("mock bytes"));
  const listed = await cloud.syncListing();
  assert.ok(listed.some((o) => o.key === other && "lastModified" in o));
  assert.equal((await cloud.fetchSnapshot(other)).toString(), "mock bytes");
  await assert.rejects(cloud.fetchSnapshot("kapevault/opener/kapevault-opener-1.0.0.html"), /Unknown backup/);
  vault.setCloud(null);
  await assert.rejects(cloud.syncListing(), /not set up/);
});

test("a snapshot under this install's id that it never sent is found; an older install's own snapshots are not", async () => {
  const { dir, cloud, bucket, puts } = await wired();
  const mine = (at) => `kapevault/snapshots/${ID}/${at}.kapevault`;
  bucket.objects.set(mine("2026-09-01T00-00-00-000Z"), Buffer.from("made before this list existed"));
  const listing = () => [...bucket.objects.keys()].map((key) => ({ key, lastModified: null }));
  assert.deepEqual(cloud.notSentHere(listing()), [], "the first listing starts the list");
  await until(() => puts() === 1);
  assert.deepEqual(cloud.notSentHere(listing()), [], "its own uploads are on it");
  const stranger = mine("2026-09-27T09-00-00-000Z");
  bucket.objects.set(stranger, Buffer.from("another install with this id"));
  assert.deepEqual(cloud.notSentHere(listing()), [stranger]);
  const kept = JSON.parse(fs.readFileSync(path.join(dir, "sent-snapshots.json"), "utf8"));
  assert.ok(kept.every((k) => k.startsWith(`kapevault/snapshots/${ID}/`)), "key names only");
  const next = createCloudBackup({ vault: (await wired()).vault, installId: () => ID, transport: bucket.transport });
  assert.deepEqual(next.notSentHere([{ key: stranger, lastModified: null }]), [], "another folder starts its own list");
});

// SECURITY-AUDIT-2026-09-28.md M5 (the reviewer's probe): with only the R2 keys, 20 objects named under this
// install's id and dated 2099 topped the restore list as "this device" and made the next backup
// delete every real snapshot.
test("snapshots planted under this install's id are never pruned against, and never list as this device", async () => {
  const { cloud, bucket, puts } = await wired();
  await until(() => puts() === 1);
  await cloud.backupNow();
  await cloud.backupNow();
  const real = [...bucket.objects.keys()].filter((k) => k.startsWith(`kapevault/snapshots/${ID}/`));
  assert.equal(real.length, 3);
  const planted = [];
  for (let i = 0; i < 25; i++) planted.push(`kapevault/snapshots/${ID}/2099-01-01T00-00-${String(i).padStart(2, "0")}-000Z.kapevault`);
  for (let i = 0; i < 25; i++) planted.push(`kapevault/snapshots/${ID}/${new Date(Date.now() - 60_000 + i).toISOString().replace(/[:.]/g, "-")}.kapevault`);
  for (const key of planted) bucket.objects.set(key, Buffer.from("planted"));
  await cloud.backupNow();
  for (const key of real) assert.ok(bucket.objects.has(key), `a real snapshot stays: ${key}`);
  const listed = await cloud.list();
  for (const row of listed.filter((r) => planted.includes(r.key))) assert.equal(row.otherDevice, true, row.key);
  for (const row of listed.filter((r) => real.includes(r.key))) assert.equal(row.otherDevice, false, row.key);
  assert.ok(listed.every((r) => r.at < Date.UTC(2099, 0, 1)), "ranked by R2's clock, never a name dated 2099");
});

test("a phone's backup-only snapshot lists for a restore, as another device", async () => {
  const { cloud, bucket } = await wired();
  const phone = "7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
  const key = snapshotKey(new Date(), phone, "backup-only");
  bucket.objects.set(key, Buffer.from("a phone backup"));
  const row = (await cloud.list()).find((r) => r.key === key);
  assert.equal(row?.otherDevice, true);
  await assert.rejects(cloud.download(key), /not a KAPEVault file/, "a known snapshot name: downloaded and checked like any backup");
});

test("a name dated in the future never counts as the newest when pruning", () => {
  const key = (at) => `kapevault/snapshots/${ID}/${at}.kapevault`;
  const now = Date.UTC(2026, 8, 28, 12);
  const recent = Array.from({ length: 20 }, (_, i) => key(new Date(now - i * 60_000).toISOString().replace(/[:.]/g, "-")));
  const future = Array.from({ length: 20 }, (_, i) => key(`2099-01-01T00-00-${String(i).padStart(2, "0")}-000Z`));
  const pruned = snapshotsToPrune([...recent, ...future], now);
  assert.deepEqual(pruned.filter((k) => recent.includes(k)), [], "the newest 20 real ones all stay");
});

test("Sync now with automatic backup off sends the vault up once per change", async () => {
  const { vault, cloud, puts } = await wired();
  vault.setCloudAuto(false);
  await cloud.sendIfChanged();
  assert.equal(puts(), 1);
  await cloud.sendIfChanged();
  assert.equal(puts(), 1, "the same bytes are not sent twice");
  vault.addSpace("Mock Client");
  await cloud.sendIfChanged();
  assert.equal(puts(), 2);
});

test("the Add a phone code is the saved bucket's URL and both keys, as the phone reads it", () => {
  const config = configFromInput({ url: URL_OK, accessKeyId: "mock-key", secretAccessKey: "mock-secret" });
  assert.deepEqual(JSON.parse(setupCode(config)), { kapevault: "r2", v: 1, url: URL_OK, accessKeyId: "mock-key", secretAccessKey: "mock-secret" });
});

test("a saved config that is not an R2 bucket never gets a client, so nothing is sent to it", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-test-")), "vault.kapevault");
  const vault = createVaultSession(file);
  await vault.create("Xq7!vR2#mLp9$wZk4");
  const sent = [];
  const cloud = createCloudBackup({ vault, installId: () => ID, transport: async (req) => { sent.push(req.url); throw new Error("mock: should not be reached"); } });
  vault.setCloud({ endpoint: "https://evil.example", bucket: "vault-backups", accessKeyId: "mock-k", secretAccessKey: "mock-s", auto: true });
  await assert.rejects(cloud.list(), /not an R2 bucket/);
  assert.deepEqual(sent, []);
});

// Audit crypto 5 (2026-10-04): with a Bucket Lock on the snapshots prefix R2 refuses some deletes; the
// rest must still go, and the count left must be reported.
test("forgetting older backups goes past a refused delete and counts what is left", async () => {
  let locked = null;
  const bucket = fakeBucket();
  const transport = async (req) => (req.method === "DELETE" && decodeURIComponent(req.url).endsWith(locked) ? { status: 403, body: Buffer.from("<Error><Code>AccessDenied</Code></Error>") } : bucket.transport(req));
  const { cloud } = await wired({ transport });
  const old = (at) => `kapevault/snapshots/${ID}/${at}.kapevault`;
  const keys = ["2026-01-01T00-00-00-000Z", "2026-01-02T00-00-00-000Z", "2026-01-03T00-00-00-000Z"].map(old);
  for (const k of keys) bucket.objects.set(k, Buffer.from("old"));
  locked = keys[0].split("/").pop(); // the oldest is inside its retention
  const result = await cloud.forgetOlder();
  assert.deepEqual(result, { deleted: 2, refused: 1 });
  assert.ok(bucket.objects.has(keys[0]));
  assert.ok(!bucket.objects.has(keys[1]) && !bucket.objects.has(keys[2]), "the ones after the refusal are still deleted");
});
