// Regression tests for the phone items of the security audit run-1 (KAPEVault, 2026-10-11): one test per
// finding, dummy data only, through the real host against the fake bucket.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRealHost } from "./real-host.ts";
import { R2_KEYS, fakeClipboard, fakeKeystore, fakeR2, fetchTransport, nodeFs, pc, pcVaultText, tempDir, until, withPro } from "./test/fixtures.mjs";

const MASTER = "Lantern-Mango-Quiet-47 orbit gazelle";
const PC_ID = "9d9d9d9d-1c1d-4e5f-8a9b-0c1d2e3f4a5b";
const PERSONAL = "5c1f7c1e-0000-4000-8000-000000000001";
const PC_VAULT = {
  spaces: [{ id: PERSONAL, name: "Personal", kind: "personal" }],
  entries: [{ id: "e-mail", spaceId: PERSONAL, kind: "login", title: "Mail", tags: [], favorite: false, notes: "", updatedAt: "2026-09-20", username: "sam.home@example.com", password: "Mail-Pass-2291!", url: "mail.example.com", signIn: "password" }],
  cloud: { endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "kapevault-e2e", accessKeyId: "pc-key", secretAccessKey: "pc-secret", auto: true },
};

let pcText;
let r2;
test.before(async () => {
  pcText = (await pcVaultText(MASTER, PC_VAULT)).text;
});
test.beforeEach(async () => {
  r2 = await fakeR2();
  r2.put(pc.cloud.snapshotKey(new Date(Date.UTC(2026, 8, 26, 9)), PC_ID), pcText, new Date(Date.UTC(2026, 8, 26, 9)));
});
test.afterEach(() => r2.close());

// transport: a wrapper over the fake bucket's, for tests that watch or reshape the traffic.
function phone(t, { dir = withPro(tempDir()), transport = fetchTransport(r2), ...extra } = {}) {
  const host = createRealHost({ fs: nodeFs(dir), transport, keystore: fakeKeystore(), clipboard: fakeClipboard(), openUrl: () => {}, model: "Pixel 8", backupDelayMs: 30, retryMs: 50, ...extra });
  t.after(() => host.lock());
  const file = path.join(dir, "vault.kapevault");
  const installId = () => JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8")).installId;
  return { host, dir, file, installId };
}
const pcBackup = async (p) => (await p.host.listBackups(R2_KEYS)).backups.find((b) => b.key.includes(PC_ID));

test("audit 16: restore from R2 never downloads an object listed bigger than any vault, and it never displaces the real newest", async (t) => {
  const planted = pc.cloud.snapshotKey(new Date(Date.UTC(2026, 8, 27, 9)), PC_ID);
  r2.put(planted, "{}", new Date(Date.UTC(2026, 8, 27, 9))); // newer than the PC's real snapshot
  const base = fetchTransport(r2);
  const gets = [];
  // The listing says 2 GB for the planted key; the bucket never sends that many bytes.
  const transport = async (req) => {
    if (req.method === "GET" && decodeURIComponent(req.url).includes(planted)) gets.push(req.url);
    const res = await base(req);
    if (req.method === "GET" && !new URL(req.url).pathname.endsWith(".kapevault") && res.body.includes(planted)) {
      return { ...res, body: res.body.replace(new RegExp(`(<Key>${planted}</Key>.*?<Size>)\\d+`), `$1${2 * 1024 * 1024 * 1024}`) };
    }
    return res;
  };
  const p = phone(t, { transport });
  const listed = (await p.host.listBackups(R2_KEYS)).backups;
  assert.equal(listed.some((b) => b.key === planted), false, "the list already leaves it out");
  const backup = listed.find((b) => b.key.includes(PC_ID));
  assert.deepEqual(await p.host.restore(R2_KEYS, backup.key, MASTER), { ok: true });
  assert.deepEqual(gets, [], "get() was never called for the 2 GB key");
});

const puts = () => r2.requests.filter((q) => q.method === "PUT").length;
const ownBucket = { endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "kapevault-e2e", accessKeyId: R2_KEYS.accessKeyId, secretAccessKey: R2_KEYS.secretAccessKey, auto: true };

test("audit lead 2: a backup file's own R2 bucket is kept but sends nothing until the user confirms it in Cloud backup", async (t) => {
  const { text } = await pcVaultText(MASTER, { ...PC_VAULT, cloud: ownBucket });
  const p = phone(t);
  assert.deepEqual(await p.host.restoreFile(text, MASTER), { ok: true });
  await new Promise((r) => setTimeout(r, 400)); // well past the backup delay
  assert.equal(puts(), 0, "nothing was uploaded to the carried bucket");
  const status = await p.host.cloudStatus();
  assert.deepEqual([status.connected, status.auto, status.carried], [true, false, true]);
  assert.equal((await p.host.syncNow()).ok, false, "Sync now does not use it either");
  assert.equal(puts(), 0);

  const on = await p.host.setCloudAuto(true); // the user has seen the bucket on the Cloud backup sheet
  assert.deepEqual([on.auto, on.carried], [true, undefined]);
  await until(() => puts() > 0);
  assert.equal((await p.host.syncNow()).ok === false, false, "and now it works");
});

test("audit lead 2: a phone with its own R2 setup keeps it, and a cloud restore from the user's own bucket connects as before", async (t) => {
  const p = phone(t);
  const backup = await pcBackup(p);
  assert.deepEqual(await p.host.restore(R2_KEYS, backup.key, MASTER), { ok: true });
  const status = await p.host.cloudStatus();
  assert.deepEqual([status.auto, status.carried], [true, undefined]);
  await until(() => puts() > 0);
});

// A sync object as a vault file carries it: device "Test Tablet" is on the list, removed or not.
const ZERO = [0, 0, ""];
const syncOf = (vaultId, removed) => ({ v: 1, vaultId, epoch: { id: vaultId, at: ZERO }, keys: [], clock: ZERO, meta: {}, gone: {}, histFloor: {}, devices: { "00000000-0000-4000-8000-00000000000a": { name: "Test Tablet", platform: "android", addedAt: [1, 0, "x"], ...(removed && { revokedAt: [5000, 0, "x"] }) } } });
const TABLET = "00000000-0000-4000-8000-00000000000a";
const removedAfter = async (p) => (await pc.crypto.openFile(MASTER, JSON.parse(fs.readFileSync(p.file, "utf8")))).data.sync.devices[TABLET]?.revokedAt;

async function restoreOverLockedOut(t, { backupVault, lockMidway = false }) {
  const current = (await pcVaultText(MASTER, { ...PC_VAULT, cloud: undefined, sync: syncOf("v1", true) })).text;
  const backup = (await pcVaultText(MASTER, { ...PC_VAULT, cloud: undefined, sync: syncOf(backupVault, false) })).text;
  const key = pc.cloud.snapshotKey(new Date(Date.UTC(2026, 8, 28, 9)), "5e5e5e5e-1c1d-4e5f-8a9b-0c1d2e3f4a5b");
  r2.put(key, backup, new Date(Date.UTC(2026, 8, 28, 9)));
  const base = fetchTransport(r2);
  let host;
  const transport = async (req) => {
    const res = await base(req);
    if (lockMidway && req.method === "GET" && decodeURIComponent(req.url).endsWith(key)) await host.lock(); // the app locks while the backup downloads
    return res;
  };
  const p = phone(t, { transport });
  host = p.host;
  assert.deepEqual(await p.host.restoreFile(current, MASTER), { ok: true });
  assert.notEqual(await removedAfter(p), undefined, "the current vault has the removal");
  const done = await p.host.restore(R2_KEYS, key, MASTER, undefined, true);
  return { p, done };
}

test("audit lead 3: a restore over the same vault keeps its device removals, even when the app locks while the backup downloads", async (t) => {
  const plain = await restoreOverLockedOut(t, { backupVault: "v1" });
  assert.equal(plain.done.ok, true);
  assert.notEqual(await removedAfter(plain.p), undefined);
  const locked = await restoreOverLockedOut(t, { backupVault: "v1", lockMidway: true });
  assert.equal(locked.done.ok, true);
  assert.notEqual(await removedAfter(locked.p), undefined, "the removal survives a lock during the download");
});

test("audit lead 3: a restore of a different vault carries nothing from the vault it replaces", async (t) => {
  const { p, done } = await restoreOverLockedOut(t, { backupVault: "v2" });
  assert.equal(done.ok, true);
  assert.equal(await removedAfter(p), undefined, "another vault's removals are not this one's");
});

const NEW_MASTER = "Harbor-Kettle-Violet-62 orbit gazelle";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A phone connected to the bucket that backed up three times under MASTER, then changed its master password.
async function changedMaster(t, options) {
  const p = phone(t, options);
  assert.equal((await p.host.restore(R2_KEYS, (await pcBackup(p)).key, MASTER)).ok, true);
  const mine = () => [...r2.objects.keys()].filter((k) => pc.cloud.snapshotOwner(k) === p.installId());
  for (let i = 0; i < 3; i++) {
    await p.host.toggleFavorite("e-mail");
    await until(() => mine().length >= i + 1);
    await sleep(15);
  }
  const before = mine();
  assert.equal((await p.host.changeMaster(MASTER, NEW_MASTER)).ok, true);
  await sleep(15);
  await p.host.toggleFavorite("e-mail");
  await until(() => mine().length > before.length);
  return { p, mine, before };
}

test("audit lead 7: after a master password change the phone can delete its old-password snapshots, and says so until it has", async (t) => {
  const { p, mine, before } = await changedMaster(t);
  assert.equal((await p.host.cloudStatus()).olderBackups, true, "the notice is on");
  const pcKeys = [...r2.objects.keys()].filter((k) => pc.cloud.snapshotOwner(k) === PC_ID);

  const done = await p.host.forgetOlderBackups();
  assert.deepEqual([done.ok, done.refused], [true, 0]);
  assert.equal(done.deleted >= 3, true);
  const left = mine();
  for (const key of before) assert.equal(left.includes(key), false, `${key} is gone`);
  assert.deepEqual([...r2.objects.keys()].filter((k) => pc.cloud.snapshotOwner(k) === PC_ID), pcKeys, "another device's snapshots are left alone");
  const fresh = left.at(-1);
  assert.notEqual(await pc.crypto.openFile(NEW_MASTER, JSON.parse(r2.objects.get(fresh).toString("utf8"))), null, "what stays opens with the new password");
  assert.equal((await p.host.cloudStatus()).olderBackups, undefined, "the notice is off");
});

test("audit lead 7: a snapshot the bucket's lock refuses to delete is counted, skipped, and keeps the notice", async (t) => {
  const base = fetchTransport(r2);
  let refuse = "";
  const transport = async (req) => (req.method === "DELETE" && refuse && decodeURIComponent(req.url).endsWith(refuse) ? { status: 403, body: "<Error><Code>AccessDenied</Code></Error>" } : base(req));
  const { p, before } = await changedMaster(t, { transport });
  refuse = before[0];
  const done = await p.host.forgetOlderBackups();
  assert.deepEqual([done.ok, done.refused], [true, 1]);
  assert.equal(r2.objects.has(before[0]), true);
  assert.equal(r2.objects.has(before[1]), false, "the rest still go");
  assert.equal((await p.host.cloudStatus()).olderBackups, true, "the old password still opens one, so the notice stays");
});

test("audit hardening: disableBiometric and setSettings need an unlocked vault", async (t) => {
  const p = phone(t);
  assert.equal((await p.host.restore(R2_KEYS, (await pcBackup(p)).key, MASTER)).ok, true);
  await p.host.lock();
  await assert.rejects(() => p.host.disableBiometric(), /locked/i);
  await assert.rejects(() => p.host.setSettings({ lockGrace: 0 }), /locked/i);
});
