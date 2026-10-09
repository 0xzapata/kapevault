// R2 is optional on the phone: first run makes a vault here, and Settings connects R2 later. Each test
// gets its own fake bucket; the PC's own code reads what the phone writes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRealHost } from "./real-host.ts";
import { R2_KEYS, fakeClipboard, fakeKeystore, fakeR2, fetchTransport, nodeFs, pc, tempDir, until, withPro } from "./test/fixtures.mjs";

const PHONE_MASTER = "Copper-Violet-Harbor-83 orbit gazelle";
const PC_MASTER = "Lantern-Mango-Quiet-47 orbit gazelle";
const PC_ID = "9d9d9d9d-1c1d-4e5f-8a9b-0c1d2e3f4a5b";
const PC_PERSONAL = "5c1f7c1e-0000-4000-8000-000000000001";
const PC_VAULT = {
  spaces: [{ id: PC_PERSONAL, name: "Personal", kind: "personal" }, { id: "sp-acme", name: "Acme", kind: "client" }],
  entries: [{ id: "e-mail", spaceId: PC_PERSONAL, kind: "login", title: "Mail", tags: [], favorite: false, notes: "", updatedAt: "2026-09-20", username: "sam.home@example.com", password: "Mail-Pass-2291!", url: "mail.example.com", signIn: "password" }],
};

async function bucket(t) {
  const r2 = await fakeR2();
  t.after(() => r2.close());
  return r2;
}

function phone(t, r2, dir = withPro(tempDir())) {
  const host = createRealHost({ fs: nodeFs(dir), transport: fetchTransport(r2), keystore: fakeKeystore(), clipboard: fakeClipboard(), scanQr: async () => "", openUrl: () => {}, model: "Pixel 8", backupDelayMs: 30, retryMs: 50 });
  t.after(() => host.lock());
  const read = (name) => fs.readFileSync(path.join(dir, name), "utf8");
  const installId = () => JSON.parse(read("settings.json")).installId;
  const mine = () => [...r2.objects.keys()].filter((k) => pc.cloud.snapshotOwner(k) === installId());
  return { host, dir, read, installId, mine };
}

// The PC's vault in the bucket, as the PC uploads it.
async function pcSnapshot(r2, data = PC_VAULT) {
  const { key, kdf, salt } = await pc.crypto.createKey(PC_MASTER);
  r2.put(pc.cloud.snapshotKey(new Date(), PC_ID), JSON.stringify(pc.crypto.encryptWithKey(key, kdf, salt, data)));
  return { key, kdf, salt };
}

const login = (title, extra = {}) => ({ kind: "login", spaceId: "", title, tags: [], favorite: false, notes: "", username: "sam", password: `${title}-Pass-7731!`, url: `${title.toLowerCase()}.example.com`, signIn: "password", ...extra });

test("createVault: first run makes a vault on the phone, the PC's way, and it unlocks again", async (t) => {
  const p = phone(t, await bucket(t));
  assert.equal(await p.host.state(), "first-run");
  assert.match((await p.host.createVault("short")).error, /12 characters|Strong/);
  assert.equal(await p.host.state(), "first-run", "a refused password writes nothing");
  assert.deepEqual(await p.host.createVault(PHONE_MASTER), { ok: true });
  assert.equal(await p.host.state(), "unlocked");
  assert.deepEqual(await p.host.createVault(PHONE_MASTER), { ok: false, error: "A vault already exists." });

  const { spaces } = await p.host.view();
  assert.deepEqual(spaces.map((s) => [s.name, s.kind]), [["Personal", "personal"]]);
  const saved = await p.host.saveEntry({ ...login("Bank"), spaceId: spaces[0].id });
  assert.equal(saved.ok, true);
  const onDisk = (await pc.crypto.openFile(PHONE_MASTER, JSON.parse(p.read("vault.kapevault")))).data;
  assert.equal(onDisk.sync.vaultId, spaces[0].id, "the Personal space's id names the vault");
  assert.equal(onDisk.sync.meta[saved.id].vv[p.installId()], 1, "stamped as this phone's change");
  assert.equal(onDisk.cloud, undefined, "no R2 until Settings connects it");
  assert.deepEqual(await p.host.cloudStatus(), { connected: false, url: "", accessKeyId: "", auto: false, apart: false });
  assert.equal((await p.host.syncStatus()).state, "off", "the sync line stays quiet");

  await p.host.lock();
  assert.equal((await p.host.unlock(PHONE_MASTER)).ok, true);
  assert.deepEqual((await p.host.view()).entries.map((e) => e.title), ["Bank"]);
});

test("connect an empty bucket: this phone's vault starts backing up", async (t) => {
  const r2 = await bucket(t);
  const p = phone(t, r2);
  await p.host.createVault(PHONE_MASTER);
  const { spaces } = await p.host.view();
  await p.host.saveEntry({ ...login("Bank"), spaceId: spaces[0].id });
  assert.match((await p.host.connectCloud({ ...R2_KEYS, accessKeyId: "someone-else" })).error, /R2 refused the keys/);
  assert.deepEqual(await p.host.connectCloud(R2_KEYS), { ok: true });
  assert.deepEqual(await p.host.cloudStatus(), { connected: true, url: R2_KEYS.url, accessKeyId: R2_KEYS.accessKeyId, auto: true, apart: false });
  await until(() => p.mine().length === 1);
  const uploaded = (await pc.crypto.openFile(PHONE_MASTER, JSON.parse(r2.objects.get(p.mine()[0]).toString("utf8")))).data;
  assert.deepEqual(uploaded.entries.map((e) => e.title), ["Bank"]);
  assert.equal((await p.host.syncStatus()).apart, false);
});

test("connect a bucket holding this same vault: it just connects", async (t) => {
  const r2 = await bucket(t);
  const { key, kdf, salt } = await pcSnapshot(r2);
  const p = phone(t, r2);
  fs.writeFileSync(path.join(p.dir, "vault.kapevault"), JSON.stringify(pc.crypto.encryptWithKey(key, kdf, salt, PC_VAULT))); // a copy of the PC's vault
  assert.equal((await p.host.unlock(PC_MASTER)).ok, true);
  assert.deepEqual(await p.host.connectCloud(R2_KEYS), { ok: true });
  assert.equal((await p.host.cloudStatus()).connected, true);
});

// The phone's own vault: Personal (a login, and one signed in through it), a client with an item.
async function phoneWithItems(t, r2) {
  const p = phone(t, r2);
  await p.host.createVault(PHONE_MASTER);
  const personal = (await p.host.view()).spaces[0].id;
  const google = (await p.host.saveEntry({ ...login("Google"), spaceId: personal })).id;
  await p.host.saveEntry({ ...login("Notion"), spaceId: personal, signIn: "google", viaEntryId: google, password: undefined });
  const acme = (await p.host.addSpace("ACME")).id;
  await p.host.saveEntry({ ...login("Acme portal"), spaceId: acme });
  const newClient = (await p.host.addSpace("Harbor & Pine")).id;
  await p.host.saveEntry({ kind: "note", spaceId: newClient, title: "Server steps", tags: [], favorite: false, notes: "", body: "1. SSH in." });
  return { ...p, before: p.read("vault.kapevault") };
}

test("another vault in the bucket: Use the vault from PC brings every phone item over as a new item", async (t) => {
  const r2 = await bucket(t);
  await pcSnapshot(r2);
  const p = await phoneWithItems(t, r2);
  const oldIds = new Set((await p.host.view()).entries.map((e) => e.id));

  const asked = await p.host.connectCloud(R2_KEYS);
  assert.equal(asked.ok, true);
  assert.deepEqual([asked.other.device, asked.other.platform], ["PC", "windows"]);
  assert.equal((await p.host.cloudStatus()).connected, false, "asking saves nothing");
  assert.equal(p.read("vault.kapevault"), p.before);

  assert.deepEqual(await p.host.useCloudVault(R2_KEYS, asked.other.key, "wrong password"), { ok: false, error: "Wrong master password for that backup." });
  assert.equal(p.read("vault.kapevault"), p.before, "a wrong password changes nothing");

  assert.deepEqual(await p.host.useCloudVault(R2_KEYS, asked.other.key, PC_MASTER), { ok: true, carried: 4 });
  const view = await p.host.view();
  const byTitle = Object.fromEntries(view.entries.map((e) => [e.title, e]));
  assert.deepEqual(Object.keys(byTitle).sort(), ["Acme portal", "Google", "Mail", "Notion", "Server steps"]);
  assert.equal(byTitle.Mail.id, "e-mail", "the PC's items stay as they are");
  for (const title of ["Google", "Notion", "Acme portal", "Server steps"]) assert.equal(oldIds.has(byTitle[title].id), false, `${title} came over with a new id`);
  assert.equal(byTitle.Notion.viaEntryId, byTitle.Google.id, "a sign-in through a carried item follows it");
  assert.equal(await p.host.getSecret(byTitle.Google.id, "password"), "Google-Pass-7731!", "secrets come over");
  assert.equal(byTitle.Google.spaceId, PC_PERSONAL, "Personal joins Personal");
  assert.equal(byTitle["Acme portal"].spaceId, "sp-acme", "a client joins the one of the same name");
  const harbor = view.spaces.find((s) => s.name === "Harbor & Pine");
  assert.equal(byTitle["Server steps"].spaceId, harbor?.id, "a client the vault lacks comes over");

  const onDisk = (await pc.crypto.openFile(PC_MASTER, JSON.parse(p.read("vault.kapevault")))).data;
  for (const title of ["Google", "Notion", "Acme portal", "Server steps"]) assert.equal(onDisk.sync.meta[byTitle[title].id].vv[p.installId()] >= 1, true, `${title} is stamped as this phone's, so it syncs out`);
  assert.equal(onDisk.sync.vaultId, PC_PERSONAL, "the PC's vault, by id");
  assert.equal(p.read("replaced.kapevault"), p.before, "this phone's old vault is kept in the slot");
  assert.notEqual(await pc.crypto.openFile(PHONE_MASTER, JSON.parse(p.read("replaced.kapevault"))), null);
  assert.deepEqual(await p.host.cloudStatus(), { connected: true, url: R2_KEYS.url, accessKeyId: R2_KEYS.accessKeyId, auto: true, apart: false });
  await until(() => p.mine().length >= 1);
  const uploaded = (await pc.crypto.openFile(PC_MASTER, JSON.parse(r2.objects.get(p.mine().at(-1)).toString("utf8")))).data;
  assert.equal(uploaded.entries.length, 5, "the PC gets every item in the next snapshot");

  await p.host.lock();
  assert.equal((await p.host.unlock(PC_MASTER)).ok, true, "the phone now opens with the PC's master password");
});

test("another vault in the bucket: Keep this phone's vault backs up, with no sync", async (t) => {
  const r2 = await bucket(t);
  await pcSnapshot(r2);
  const pcKeys = new Set(r2.objects.keys());
  const p = await phoneWithItems(t, r2);
  const asked = await p.host.connectCloud(R2_KEYS);
  assert.ok(asked.other);
  assert.deepEqual(await p.host.keepThisVault(R2_KEYS), { ok: true });
  assert.deepEqual(await p.host.cloudStatus(), { connected: true, url: R2_KEYS.url, accessKeyId: R2_KEYS.accessKeyId, auto: true, apart: true });
  await until(() => p.mine().length >= 1);
  assert.equal((await p.host.syncStatus()).apart, true, "the sync line says why");
  assert.deepEqual((await p.host.view()).entries.map((e) => e.title).sort(), ["Acme portal", "Google", "Notion", "Server steps"], "nothing merged in");
  for (const key of pcKeys) assert.ok(r2.objects.has(key), "the PC's backups are left alone");
  assert.equal(fs.existsSync(path.join(p.dir, "replaced.kapevault")), false);
});
