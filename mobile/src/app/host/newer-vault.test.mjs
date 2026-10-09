// A vault, or a snapshot, a newer KAPEVault wrote: the phone refuses it, merges nothing from it and
// writes nothing over it (FORMAT.md, Newer files). Same fixtures as sync.test.mjs: the PC's real code on
// the other side of one fake R2.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRealHost } from "./real-host.ts";
import { R2_KEYS, fakeClipboard, fakeKeystore, fakeR2, fetchTransport, nodeFs, pc, pcDevice, tempDir, until, withPro } from "./test/fixtures.mjs";

const MASTER = "Lantern-Mango-Quiet-47 orbit gazelle";
const NEW_MASTER = "Harbor-Kettle-Violet-62 orbit gazelle";
const PC_ID = "9d9d9d9d-1c1d-4e5f-8a9b-0c1d2e3f4a5b";
const MESSAGE = "This vault was saved by a newer KAPEVault. Update this app to open it.";

// What a newer app does to a file: edit(data, header) changes the decrypted JSON and the file header,
// and the result is sealed under the same key.
async function sealNewer(text, master, edit) {
  const opened = await pc.crypto.openFile(master, JSON.parse(text));
  const header = {};
  const data = structuredClone(opened.data);
  edit(data, header);
  return JSON.stringify({ ...pc.crypto.encryptWithKey(opened.key, opened.kdf, opened.salt, data), ...header });
}

const EDITS = {
  "a file header at version 2": (_data, header) => {
    header.version = 2;
  },
  "a minReader of 2": (data) => {
    data.minReader = 2;
  },
  "a sync object at v 2": (data) => {
    data.sync = { ...data.sync, v: 2 };
  },
};

function phoneDevice(t, r2) {
  const dir = withPro(tempDir());
  const host = createRealHost({ fs: nodeFs(dir), transport: fetchTransport(r2), keystore: fakeKeystore(), clipboard: fakeClipboard(), scanQr: async () => "", openUrl: () => {}, model: "Pixel 8", backupDelayMs: 30, retryMs: 50, syncDelayMs: 60_000 });
  t.after(() => host.lock());
  const file = path.join(dir, "vault.kapevault");
  const idle = () => until(async () => (await host.syncStatus()).state !== "syncing");
  return {
    host,
    dir,
    file,
    status: () => host.syncStatus(),
    async sync() {
      await idle();
      await host.syncNow();
      await idle();
    },
    titles: async () => (await host.view()).entries.map((e) => e.title).sort(),
    onDisk: async (master = MASTER) => (await pc.crypto.openFile(master, JSON.parse(fs.readFileSync(file, "utf8")))).data,
  };
}

// The PC with a few items, a phone restored from its backup, both synced twice.
async function pair(t) {
  const r2 = await fakeR2();
  t.after(() => r2.close());
  const desk = pcDevice(r2, { id: PC_ID });
  const personal = (await desk.vault.create(MASTER)).vault.spaces[0].id;
  desk.vault.setCloud(pc.cloud.configFromInput(R2_KEYS));
  desk.vault.saveEntry({ kind: "note", spaceId: personal, title: "Server steps", body: "1. SSH in." });
  await desk.cloud.backupNow();
  t.after(() => desk.sync.locked());
  const phone = phoneDevice(t, r2);
  const backup = (await phone.host.listBackups(R2_KEYS)).backups[0];
  assert.deepEqual(await phone.host.restore(R2_KEYS, backup.key, MASTER), { ok: true });
  const pcSync = async () => {
    await until(() => desk.sync.status().state !== "running");
    return desk.sync.syncNow();
  };
  await phone.sync();
  await pcSync();
  await phone.sync();
  await pcSync();
  return { r2, desk, phone, personal, pcSync };
}

for (const [what, edit] of Object.entries(EDITS)) {
  test(`unlock refuses ${what}: the newer message, nothing is written, and the key is wiped`, async (t) => {
    const r2 = await fakeR2();
    t.after(() => r2.close());
    const desk = pcDevice(r2, { id: PC_ID });
    await desk.vault.create(MASTER);
    const phone = phoneDevice(t, r2);
    const text = await sealNewer(fs.readFileSync(desk.file, "utf8"), MASTER, edit);
    fs.writeFileSync(phone.file, text);
    assert.equal(await phone.host.state(), "locked", "a newer file is still a vault file, never a first run");
    for (let i = 0; i < 6; i++) assert.deepEqual(await phone.host.unlock(MASTER), { ok: false, newer: true, error: MESSAGE }, "the spinner's promise settles with the message");
    assert.equal(fs.existsSync(path.join(phone.dir, "unlock-throttle.json")), false, "six tries are not six wrong passwords");
    assert.equal(await phone.host.state(), "locked");
    assert.equal(fs.readFileSync(phone.file, "utf8"), text, "byte for byte as it was");
    assert.deepEqual(fs.readdirSync(phone.dir).filter((f) => f.endsWith(".next")), [], "no half-made copy left beside it");
  });
}

for (const [what, edit] of Object.entries(EDITS)) {
  test(`fingerprint unlock refuses ${what}: the newer message, nothing is written, and the fingerprint stays on`, async (t) => {
    const { phone } = await pair(t);
    assert.deepEqual(await phone.host.enableBiometric(), { ok: true });
    await phone.host.lock();
    const text = await sealNewer(fs.readFileSync(phone.file, "utf8"), MASTER, edit);
    fs.writeFileSync(phone.file, text);
    assert.deepEqual(await phone.host.unlockBiometric(), { ok: false, code: "failed", error: MESSAGE });
    assert.equal(await phone.host.state(), "locked");
    assert.equal((await phone.host.biometricStatus()).enabled, true, "it still fits the key");
    assert.equal(fs.readFileSync(phone.file, "utf8"), text, "byte for byte as it was");
  });
}

for (const [what, edit] of Object.entries(EDITS)) {
  test(`restoring a file with ${what} says it is newer and writes nothing`, async (t) => {
    const r2 = await fakeR2();
    t.after(() => r2.close());
    const desk = pcDevice(r2, { id: PC_ID });
    await desk.vault.create(MASTER);
    const phone = phoneDevice(t, r2);
    const text = await sealNewer(fs.readFileSync(desk.file, "utf8"), MASTER, edit);
    const verdict = { ok: false, newer: true, error: MESSAGE };
    if (edit === EDITS["a file header at version 2"]) assert.deepEqual(phone.host.checkBackupFile(text), verdict);
    for (let i = 0; i < 6; i++) assert.deepEqual(await phone.host.restoreFile(text, MASTER), verdict);
    assert.equal(fs.existsSync(phone.file), false, "nothing is written");
    assert.equal(fs.existsSync(path.join(phone.dir, "unlock-throttle.json")), false, "and no miss is counted");
    assert.equal(await phone.host.state(), "first-run");
  });
}

for (const [what, edit] of Object.entries(EDITS)) {
  test(`restoring a cloud backup with ${what} says it is newer and writes nothing`, async (t) => {
    const r2 = await fakeR2();
    t.after(() => r2.close());
    const desk = pcDevice(r2, { id: PC_ID });
    await desk.vault.create(MASTER);
    desk.vault.setCloud(pc.cloud.configFromInput(R2_KEYS));
    await desk.cloud.backupNow();
    t.after(() => desk.sync.locked());
    const phone = phoneDevice(t, r2);
    const backup = (await phone.host.listBackups(R2_KEYS)).backups[0];
    r2.put(backup.key, await sealNewer(r2.objects.get(backup.key).toString("utf8"), MASTER, edit), new Date());
    assert.deepEqual(await phone.host.restore(R2_KEYS, backup.key, MASTER), { ok: false, newer: true, error: MESSAGE });
    assert.equal(fs.existsSync(phone.file), false, "nothing is written");
    assert.equal(fs.existsSync(path.join(phone.dir, "unlock-throttle.json")), false, "and no miss is counted");
  });
}

// Only a claim inside the ciphertext is authenticated; a header is what anyone with the bucket keys can
// write (the tests after these).
const SEALED = Object.entries(EDITS).filter(([what]) => what !== "a file header at version 2");

for (const [what, edit] of SEALED) {
  test(`a PC snapshot with ${what} is skipped and named, never merged; the phone's vault is not touched`, async (t) => {
    const { r2, desk, phone, personal, pcSync } = await pair(t);
    desk.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock from the PC", body: "b" });
    await pcSync();
    const newest = pc.cloud.snapshotKey(new Date(Date.now() + 86_400_000), PC_ID);
    const real = [...r2.objects.keys()].filter((k) => pc.cloud.snapshotOwner(k) === PC_ID).sort().at(-1);
    r2.put(newest, await sealNewer(r2.objects.get(real).toString("utf8"), MASTER, edit), new Date(Date.now() + 86_400_000));
    const itemsBefore = await phone.titles();
    const sync = (await phone.onDisk()).sync;
    await phone.sync();
    const status = await phone.status();
    assert.deepEqual(status.problems, ["DESKTOP-4F2A runs a newer KAPEVault. Update this app."]);
    assert.equal(status.error ?? "", "", "a newer device is not a failed run");
    assert.deepEqual(await phone.titles(), itemsBefore, "nothing of it is merged");
    const after = (await phone.onDisk()).sync;
    assert.deepEqual(after.gone, sync.gone, "the sync record keeps its tombstones");
    assert.deepEqual(after.devices, sync.devices);
  });
}

// Security re-scan 2026-10-10: about 35 bytes with no vault key, planted as the PC's newest object, said
// "update this app" and stopped the PC's real snapshots for good. A header is not authenticated, so it is
// passed over like any other plant that will not open.
for (const [what, plant] of [
  ["a bare header claiming version 2", async () => '{"format":"kapevault","version":2}'],
  ["a real snapshot with its header edited to version 2", (real) => sealNewer(real, MASTER, EDITS["a file header at version 2"])],
]) {
  test(`${what} in the PC's folder does not stop its real snapshots, and says nothing of a newer app`, async (t) => {
    const { r2, desk, phone, personal, pcSync } = await pair(t);
    desk.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock from the PC", body: "b" });
    await pcSync();
    const newest = pc.cloud.snapshotKey(new Date(Date.now() + 86_400_000), PC_ID);
    const real = [...r2.objects.keys()].filter((k) => pc.cloud.snapshotOwner(k) === PC_ID).sort().at(-1);
    r2.put(newest, await plant(r2.objects.get(real).toString("utf8")), new Date(Date.now() + 86_400_000));
    const gets = () => r2.requests.filter((r) => r.method === "GET" && r.key === newest).length;
    await phone.sync();
    assert.ok((await phone.titles()).includes("Mock from the PC"), "the PC's real snapshot is still merged");
    assert.deepEqual((await phone.status()).problems, []);
    await phone.sync();
    assert.equal(gets(), 1, "downloaded once, like any plant that will not open");
  });
}

for (const [what, edit] of SEALED) {
  test(`a PC snapshot with ${what} is downloaded once and named on every run, then read again when it changes`, async (t) => {
    const { r2, desk, phone, personal, pcSync } = await pair(t);
    desk.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock from the PC", body: "b" });
    await pcSync();
    const newest = pc.cloud.snapshotKey(new Date(Date.now() + 86_400_000), PC_ID);
    const real = [...r2.objects.keys()].filter((k) => pc.cloud.snapshotOwner(k) === PC_ID).sort().at(-1);
    const planted = await sealNewer(r2.objects.get(real).toString("utf8"), MASTER, edit);
    r2.put(newest, planted, new Date(Date.now() + 86_400_000));
    const gets = () => r2.requests.filter((r) => r.method === "GET" && r.key === newest).length;
    await phone.sync();
    assert.equal(gets(), 1);
    for (let i = 0; i < 2; i++) {
      await phone.sync();
      assert.deepEqual((await phone.status()).problems, ["DESKTOP-4F2A runs a newer KAPEVault. Update this app."], "still named");
    }
    assert.equal(gets(), 1, "but not downloaded again");
    r2.put(newest, planted, new Date(Date.now() + 2 * 86_400_000)); // the object changed
    await phone.sync();
    assert.equal(gets(), 2, "read again once it changed");
  });
}

for (const what of ["a sync object at v 2", "a file header at version 2"]) {
test(`a newer PC's snapshot (${what}) under a new master password is refused when its master password is typed, and nothing is written`, async (t) => {
  const { r2, desk, phone, pcSync } = await pair(t);
  assert.equal((await desk.vault.changeMaster(MASTER, NEW_MASTER)).ok, true);
  await pcSync();
  await phone.sync();
  assert.equal((await phone.status()).newMaster, "DESKTOP-4F2A");
  const real = [...r2.objects.keys()].filter((k) => pc.cloud.snapshotOwner(k) === PC_ID).sort().at(-1);
  r2.put(real, await sealNewer(r2.objects.get(real).toString("utf8"), NEW_MASTER, EDITS[what]), new Date(Date.now() + 86_400_000));
  const before = fs.readFileSync(phone.file, "utf8");
  assert.deepEqual(await phone.host.adoptSyncKey(NEW_MASTER), { ok: false, error: MESSAGE });
  assert.equal((await phone.status()).review, null);
  assert.equal(fs.readFileSync(phone.file, "utf8"), before, "the file is byte for byte as it was");
});
}

test("a vault this phone saved carries minReader 1", async (t) => {
  const { phone, personal } = await pair(t);
  await phone.host.saveEntry({ kind: "note", spaceId: personal, title: "Mock", tags: [], favorite: false, notes: "", body: "b" });
  assert.equal((await phone.onDisk()).minReader, 1);
});
