// Phone <-> PC sync, end to end in Node: the phone's real host (real-host.ts + sync.ts) on one side, the
// PC's REAL session, cloud backup and sync loop (electron/*.cjs, test/fixtures.mjs pcDevice) on the
// other, one fake R2 bucket between them that checks every signature with the PC's signer.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isConflictCopy, snapshotKey } from "@core";
import { createRealHost } from "./real-host.ts";
import { olderKeyQuestion } from "./restore.ts";
import { syncLineText } from "../features/sync/sync-text.ts";
import { R2_KEYS, fakeClipboard, fakeKeystore, fakeR2, fetchTransport, fillNearCap, nodeFs, pc, pcDevice, tempDir, until, wait, withPro } from "./test/fixtures.mjs";

const MASTER = "Lantern-Mango-Quiet-47 orbit gazelle";
const NEW_MASTER = "Harbor-Kettle-Violet-62 orbit gazelle";
const PC_ID = "9d9d9d9d-1c1d-4e5f-8a9b-0c1d2e3f4a5b";

// wrap: stands between the phone and the bucket (a test holds a download back with it). maxVaultBytes:
// a smaller cap than 64 MB (real-host.test.mjs). wrapFs: stands between the phone and its files. pro:
// KAPEVault Pro already bought (pro.json); billing: the Billing plugin, when a test buys it. resume():
// the app back on screen.
function phoneDevice(t, r2, { wrap = (send) => send, maxVaultBytes, wrapFs = (files) => files, pro = true, billing } = {}) {
  const dir = pro ? withPro(tempDir()) : tempDir();
  const keystore = fakeKeystore();
  let resume = () => {};
  const host = createRealHost({ fs: wrapFs(nodeFs(dir)), transport: wrap(fetchTransport(r2)), keystore, clipboard: fakeClipboard(), scanQr: async () => "", openUrl: () => {}, model: "Pixel 8", backupDelayMs: 30, retryMs: 50, syncDelayMs: 60_000, maxVaultBytes, billing, onResume: (fn) => (resume = fn) });
  t.after(() => host.lock());
  const file = path.join(dir, "vault.kapevault");
  const installId = () => JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8")).installId;
  const status = () => host.syncStatus();
  const idle = () => until(async () => (await status()).state !== "syncing");
  return {
    host,
    dir,
    file,
    keystore,
    installId,
    status,
    idle,
    resume: () => resume(),
    // Sync now, after any automatic run still in flight (Sync now would only wait for that one).
    async sync() {
      await idle();
      const result = await host.syncNow();
      await idle();
      return result;
    },
    titles: async () => (await host.view()).entries.map((e) => e.title).sort(),
    onDisk: async (master = MASTER) => (await pc.crypto.openFile(master, JSON.parse(fs.readFileSync(file, "utf8")))).data,
  };
}

const pcSync = async (dev) => {
  await until(() => dev.sync.status().state !== "running");
  return dev.sync.syncNow();
};

// A PC with cloud backup on and ten items, and a phone restored from its backup; both have synced
// twice, so each knows the other by name.
async function pair(t, extra) {
  const r2 = await fakeR2();
  t.after(() => r2.close());
  const desk = pcDevice(r2, { id: PC_ID });
  const personal = (await desk.vault.create(MASTER)).vault.spaces[0].id;
  desk.vault.setCloud(pc.cloud.configFromInput(R2_KEYS));
  const { id: mail } = desk.vault.saveEntry({ kind: "login", spaceId: personal, title: "Mail", username: "sam.home@example.com", password: "Mail-Pass-2291!", url: "mail.example.com" });
  const { id: note } = desk.vault.saveEntry({ kind: "note", spaceId: personal, title: "Server steps", body: "1. SSH in." });
  for (let i = 0; i < 8; i++) desk.vault.saveEntry({ kind: "link", spaceId: personal, title: `Link ${i}`, linkType: "web", location: `https://example.com/${i}` });
  await desk.cloud.backupNow();
  t.after(() => desk.sync.locked());

  const phone = phoneDevice(t, r2, extra);
  const backup = (await phone.host.listBackups(R2_KEYS)).backups[0];
  assert.deepEqual(await phone.host.restore(R2_KEYS, backup.key, MASTER), { ok: true });
  await phone.sync(); // the phone's snapshot is up
  await pcSync(desk); // the PC meets the phone and registers
  await phone.sync(); // both know each other by name now
  await pcSync(desk);
  return { r2, desk, phone, personal, mail, note };
}

const puts = (r2) => r2.requests.filter((r) => r.method === "PUT" && r.key.startsWith("kapevault/snapshots/")).length;

// Google Play, as the Billing plugin: owned is this account's purchase; asked counts the calls.
function fakePlay(owned) {
  const play = {
    owned,
    asked: 0,
    status: async () => (play.asked++, { owned: play.owned, pending: false, price: "US$9.99" }),
    buy: async () => (play.asked++, (play.owned = true), { owned: true, pending: false }),
  };
  return play;
}

// Pro refunded: Play says not owned when the app comes back on screen.
async function refund(phone, play) {
  play.owned = false;
  phone.resume();
  await until(async () => (await phone.status()).backupOnly);
}

const backupOnlyKey = (k) => k.endsWith("-backup-only.kapevault");
// The phone's snapshots, oldest first (the key names the time).
const sentBy = (r2, phone) => [...r2.objects.keys()].filter((k) => pc.cloud.snapshotOwner(k) === phone.installId()).sort();
const phoneNote = (spaceId, title) => ({ kind: "note", spaceId, title, tags: [], favorite: false, notes: "", body: "typed on the phone" });

test("device names both ways: the PC lists the phone by its model, the phone the PC by its name; the check codes match", async (t) => {
  const { desk, phone } = await pair(t);
  const onPc = desk.sync.status();
  assert.deepEqual(onPc.devices.map((d) => [d.name, d.platform]), [["Pixel 8", "android"]]);
  assert.deepEqual(onPc.lastSync.with, ["Pixel 8"]);
  const status = await phone.status();
  const [me, ...others] = status.devices;
  assert.deepEqual([me.name, me.model, me.thisDevice], ["This phone", "Pixel 8", true]);
  assert.deepEqual(others.map((d) => [d.name, d.model, d.platform, d.thisDevice]), [["DESKTOP-4F2A", "Windows PC", "windows", false]]);
  assert.ok(others[0].lastSyncAt > 0, "last seen from R2's LastModified");
  assert.equal(status.peer, "DESKTOP-4F2A");
  assert.match(syncLineText(status, () => "just now").text, /^Synced with DESKTOP-4F2A · just now$/);
  const onDisk = await phone.onDisk();
  assert.deepEqual(onDisk.sync.devices[phone.installId()], { ...onDisk.sync.devices[phone.installId()], name: "Pixel 8", platform: "android" }, "the phone registered in the vault");
  assert.equal(status.fingerprint, onPc.fingerprint, "both devices hold the same shared state");
  assert.deepEqual(status.problems, []);
});

test("an edit on the PC reaches the phone, an edit on the phone reaches the PC, secrets included", async (t) => {
  const { r2, desk, phone, personal } = await pair(t);
  const { id: pcItem } = desk.vault.saveEntry({ kind: "login", spaceId: personal, title: "Bank", username: "sam", password: "Bank-Pass-1!", url: "bank.example.com" });
  await pcSync(desk);
  await phone.sync();
  assert.ok((await phone.titles()).includes("Bank"));
  assert.equal(await phone.host.getSecret(pcItem, "password"), "Bank-Pass-1!");

  const saved = await phone.host.saveEntry({ kind: "note", spaceId: personal, title: "Phone note", tags: [], favorite: false, notes: "", body: "typed on the phone" });
  await phone.sync();
  await pcSync(desk);
  assert.ok(desk.titles().includes("Phone note"));
  assert.equal(desk.vault.getSecret(saved.id, "body"), "typed on the phone");
  const data = await phone.onDisk();
  assert.equal(data.sync.meta[saved.id].vv[phone.installId()], 1, "stamped as the phone's change, never restamped by the merge");
  await phone.sync();
  assert.equal((await phone.status()).fingerprint, desk.sync.status().fingerprint);
  assert.equal(r2.badSignatures, 0);
});

test("without Pro the phone backs up and restores, but neither it nor the PC's real sync merges the other; once bought, both do", async (t) => {
  const r2 = await fakeR2();
  t.after(() => r2.close());
  const desk = pcDevice(r2, { id: PC_ID });
  const personal = (await desk.vault.create(MASTER)).vault.spaces[0].id;
  desk.vault.setCloud(pc.cloud.configFromInput(R2_KEYS));
  desk.vault.saveEntry({ kind: "note", spaceId: personal, title: "PC note", body: "from the PC" });
  await desk.cloud.backupNow();
  t.after(() => desk.sync.locked());

  const play = fakePlay(false);
  const phone = phoneDevice(t, r2, { pro: false, billing: play });
  const backup = (await phone.host.listBackups(R2_KEYS)).backups[0];
  assert.deepEqual(await phone.host.restore(R2_KEYS, backup.key, MASTER), { ok: true }, "a restore is free, a PC backup too");
  await phone.host.saveEntry(phoneNote(personal, "Phone note"));
  assert.deepEqual(await phone.sync(), { ok: true });
  desk.vault.saveEntry({ kind: "note", spaceId: personal, title: "PC later", body: "after the restore" });
  await pcSync(desk);
  await phone.sync();

  const sent = () => [...r2.objects.keys()].filter((k) => pc.cloud.snapshotOwner(k) === phone.installId());
  assert.ok(sent().length > 0 && sent().every((k) => k.endsWith("-backup-only.kapevault")), sent().join());
  assert.ok(!desk.titles().includes("Phone note"), "the PC never merges a phone without Pro");
  assert.ok(!(await phone.titles()).includes("PC later"), "the phone without Pro never merges the PC");
  assert.deepEqual(desk.sync.status().devices, [], "the PC never met it");
  const status = await phone.status();
  assert.equal(status.backupOnly, true);
  assert.equal(status.lastAt, undefined);
  assert.match(syncLineText(status, () => "just now").text, /^Backed up · just now$/);
  assert.ok((await desk.cloud.list()).some((b) => sent().includes(b.key) && b.otherDevice), "the PC can restore the phone's backup");
  assert.equal((await phone.host.adoptSyncKey(MASTER)).ok, false);
  assert.equal(play.asked, 0, "a phone that never touched Pro never asked Google Play");

  assert.equal((await phone.host.buyPro()).owned, true);
  await phone.sync();
  assert.ok((await phone.titles()).includes("PC later"), "bought: the phone merges the PC");
  assert.ok(sent().some((k) => !k.endsWith("-backup-only.kapevault")), "the same vault went up again as a snapshot the PC merges");
  await pcSync(desk);
  assert.ok(desk.titles().includes("Phone note"), "bought: the PC merges the phone");
  assert.equal((await phone.status()).backupOnly, false);
  assert.equal(r2.badSignatures, 0);
});

test("without Pro a failed backup is not said forever: the next Sync now that goes up clears it", async (t) => {
  let failPut = false;
  const wrap = (send) => async (request) => {
    if (failPut && request.method === "PUT") {
      failPut = false;
      throw new Error("No network.");
    }
    return send(request);
  };
  const { phone, personal } = await pair(t, { pro: false, wrap });
  await phone.host.setCloudAuto(false); // only Sync now uploads
  await phone.host.saveEntry(phoneNote(personal, "Phone note"));
  failPut = true;
  assert.equal((await phone.sync()).ok, false);
  assert.equal((await phone.status()).state, "error");
  assert.deepEqual(await phone.sync(), { ok: true });
  assert.equal((await phone.status()).state, "idle");
});

test("without Pro, with automatic backup on, the next automatic backup that goes up clears a failed Back up now", async (t) => {
  let failPut = false;
  const wrap = (send) => async (request) => {
    if (failPut && request.method === "PUT") {
      failPut = false;
      throw new Error("No network.");
    }
    return send(request);
  };
  const { phone, personal } = await pair(t, { pro: false, wrap });
  let heard = null; // what the screens were last told (they update from onSync, they do not ask)
  t.after(phone.host.onSync((s) => (heard = s)));
  await phone.host.saveEntry(phoneNote(personal, "Phone note"));
  failPut = true;
  assert.equal((await phone.sync()).ok, false);
  assert.equal(heard?.state, "error");
  await phone.host.saveEntry(phoneNote(personal, "Later note")); // its automatic backup goes up
  await until(() => heard?.state === "idle");
});

test("without Pro, an automatic backup that fails tells the screens", async (t) => {
  let failPut = false;
  const wrap = (send) => async (request) => {
    if (failPut && request.method === "PUT") throw new Error("No network.");
    return send(request);
  };
  const { phone, personal } = await pair(t, { pro: false, wrap });
  let heard = null;
  t.after(phone.host.onSync((s) => (heard = s)));
  failPut = true;
  await phone.host.saveEntry(phoneNote(personal, "Phone note")); // its automatic backup fails
  await until(() => heard?.state === "error");
  failPut = false;
});

test("the Sync sheet names no other phone from its backup-only snapshots; this phone's own still date its row", async (t) => {
  const { r2, phone, personal } = await pair(t, { pro: false });
  const other = "7e7e7e7e-1c1d-4e5f-8a9b-0c1d2e3f4a5b";
  r2.put(snapshotKey(new Date(), other, "backup-only"), "a phone without Pro");
  await phone.host.saveEntry(phoneNote(personal, "Phone note")); // an upload, then its listing
  await phone.sync();
  const [me, ...others] = (await phone.status()).devices;
  assert.ok(me.lastSyncAt > 0, "this phone's backup-only snapshots date its own row");
  assert.ok(!others.some((d) => d.id === other), others.map((d) => d.id).join());
});

test("a refund: Pro goes, a held review with it (and the one a sync in flight would hold), and the next upload is backup-only", async (t) => {
  let gate = null;
  const hold = (send) => async (request) => {
    if (gate && request.method === "GET" && request.url.includes(PC_ID)) {
      gate.hit = true;
      await gate.open;
    }
    return send(request);
  };
  const play = fakePlay(true);
  const { r2, desk, phone } = await pair(t, { billing: play, wrap: hold });
  for (const link of desk.vault.publicView().entries.filter((e) => e.title.startsWith("Link ")).slice(0, 6)) gone(desk, link.id);
  await pcSync(desk);
  await phone.sync();
  assert.ok((await phone.status()).review, "a review waits");
  let release;
  gate = { hit: false, open: new Promise((r) => (release = r)) };
  await refund(phone, play); // the resume also started a sync, held at its download until Pro is gone
  await until(() => gate.hit);
  gate = null;
  release();
  await phone.idle();
  assert.equal((await phone.status()).review, null);
  assert.deepEqual(await phone.sync(), { ok: true });
  assert.ok(backupOnlyKey(sentBy(r2, phone).at(-1)), sentBy(r2, phone).at(-1));
});

test("Pro bought again after a refund, nothing new on the PC: the same vault goes up again as a snapshot the PC merges", async (t) => {
  const play = fakePlay(true);
  const { r2, desk, phone, personal } = await pair(t, { billing: play });
  await refund(phone, play);
  await phone.host.saveEntry(phoneNote(personal, "Phone note"));
  assert.deepEqual(await phone.sync(), { ok: true });
  assert.ok(backupOnlyKey(sentBy(r2, phone).at(-1)));
  await pcSync(desk);
  assert.ok(!desk.titles().includes("Phone note"));

  assert.equal((await phone.host.buyPro()).owned, true);
  await until(() => !backupOnlyKey(sentBy(r2, phone).at(-1)));
  await pcSync(desk);
  assert.ok(desk.titles().includes("Phone note"), "the PC merges the phone");
});

test("Pro bought while a backup-only upload is on its way: the vault still goes up again as a snapshot the PC merges", async (t) => {
  let gate = null;
  const hold = (send) => async (request) => {
    if (gate && request.method === "PUT") {
      gate.hit = true;
      await gate.open;
    }
    return send(request);
  };
  const play = fakePlay(true);
  const { r2, desk, phone, personal } = await pair(t, { billing: play, wrap: hold });
  await refund(phone, play);
  await phone.host.setCloudAuto(false); // only Sync now uploads
  await phone.host.saveEntry(phoneNote(personal, "Phone note"));
  let release;
  gate = { hit: false, open: new Promise((r) => (release = r)) };
  const backingUp = phone.host.syncNow();
  await until(() => gate.hit);
  gate = null;
  assert.equal((await phone.host.buyPro()).owned, true);
  release();
  assert.deepEqual(await backingUp, { ok: true });
  await until(() => !backupOnlyKey(sentBy(r2, phone).at(-1)));
  await pcSync(desk);
  assert.ok(desk.titles().includes("Phone note"), "the PC merges the phone");
});

test("both change the same item before syncing: a conflict copy, the same on both; a login's losing password goes to its history", async (t) => {
  const { desk, phone, personal, mail, note } = await pair(t);
  desk.vault.saveEntry({ id: note, kind: "note", spaceId: personal, title: "Server steps", body: "PC version" });
  desk.vault.saveEntry({ id: mail, kind: "login", spaceId: personal, title: "Mail", username: "sam.home@example.com", password: "PC-Pass-5510!", url: "mail.example.com" });
  await phone.host.saveEntry({ id: note, kind: "note", spaceId: personal, title: "Server steps", tags: [], favorite: false, notes: "", body: "Phone version" });
  await phone.host.saveEntry({ id: mail, kind: "login", spaceId: personal, title: "Mail", tags: [], favorite: false, notes: "", username: "sam.home@example.com", password: "Phone-Pass-7731!", url: "mail.example.com", signIn: "password" });
  await pcSync(desk);
  await phone.sync();
  await pcSync(desk);
  await phone.sync();

  const copies = (await phone.host.view()).entries.filter((e) => isConflictCopy(e.title));
  assert.equal(copies.length, 1, "one copy, for the note (a password alone never makes one)");
  const pcCopies = desk.vault.publicView().entries.filter((e) => isConflictCopy(e.title));
  assert.deepEqual(pcCopies.map((e) => e.id), copies.map((e) => e.id), "the same copy, by id, on both");
  const bodies = [await phone.host.getSecret(note, "body"), await phone.host.getSecret(copies[0].id, "body")].sort();
  assert.deepEqual(bodies, ["PC version", "Phone version"], "nothing typed is lost");
  const [conflict] = (await phone.status()).conflicts;
  assert.equal(conflict.id, copies[0].id);
  assert.equal(conflict.originalId, note);
  assert.ok(["DESKTOP-4F2A", "Pixel 8"].includes(conflict.device), conflict.device);
  assert.ok(conflict.at > 0);

  const login = (await phone.host.view()).entries.find((e) => e.id === mail);
  const history = await Promise.all(login.history.map((_, i) => phone.host.getSecret(mail, "history", i)));
  const current = await phone.host.getSecret(mail, "password");
  assert.ok(["PC-Pass-5510!", "Phone-Pass-7731!"].includes(current), current);
  assert.ok(history.includes(current === "PC-Pass-5510!" ? "Phone-Pass-7731!" : "PC-Pass-5510!"), `the losing password is in the history: ${history.length} kept`);
  assert.equal((await phone.status()).fingerprint, desk.sync.status().fingerprint);
});

// Delete moves an item to the Trash; these tests are about a real delete, so it is emptied from there.
const gone = (desk, id) => {
  desk.vault.deleteEntry(id);
  desk.vault.deleteForever(id);
};

test("a delete on one device is a tombstone on the other, both ways", async (t) => {
  const { desk, phone } = await pair(t);
  const link0 = desk.vault.publicView().entries.find((e) => e.title === "Link 0").id;
  gone(desk, link0);
  await pcSync(desk);
  await phone.sync();
  assert.ok(!(await phone.titles()).includes("Link 0"));
  assert.ok((await phone.onDisk()).sync.gone[link0], "kept as a tombstone");

  const link1 = (await phone.host.view()).entries.find((e) => e.title === "Link 1").id;
  await phone.host.deleteEntry(link1);
  await phone.host.deleteForever(link1);
  await phone.sync();
  await pcSync(desk);
  assert.ok(!desk.titles().includes("Link 1"));
  // A stale snapshot never brings it back.
  await phone.sync();
  assert.ok(!(await phone.titles()).includes("Link 0"));
});

test("the delete gate: more than 5 deletes wait for a review on the phone; Not now keeps them, Apply deletes", async (t) => {
  const { desk, phone } = await pair(t);
  const links = desk.vault.publicView().entries.filter((e) => e.title.startsWith("Link ")).slice(0, 6);
  for (const link of links) gone(desk, link.id);
  await pcSync(desk);
  await phone.sync();
  let status = await phone.status();
  assert.deepEqual(status.review.reasons, ["deletes"]);
  assert.deepEqual(status.review.from, ["DESKTOP-4F2A"]);
  assert.deepEqual([...status.review.deleted].sort(), links.map((l) => l.title).sort());
  assert.equal(syncLineText(status, () => "").text, "Changes from DESKTOP-4F2A wait for you");
  assert.equal((await phone.titles()).filter((t) => t.startsWith("Link ")).length, 8, "nothing deleted before Apply");

  await phone.sync(); // Not now, then another sync: it still waits
  assert.ok((await phone.status()).review);
  // A save meanwhile is kept when the held merge is applied.
  const saved = await phone.host.saveEntry({ kind: "note", spaceId: (await phone.host.view()).spaces[0].id, title: "Typed while waiting", tags: [], favorite: false, notes: "", body: "keep me" });
  assert.deepEqual(await phone.host.applySync(), { ok: true, biometricOff: false });
  status = await phone.status();
  assert.equal(status.review, null);
  const titles = await phone.titles();
  assert.equal(titles.filter((t) => t.startsWith("Link ")).length, 2);
  assert.ok(titles.includes("Typed while waiting"));
  assert.equal(await phone.host.getSecret(saved.id, "body"), "keep me");
  await phone.sync();
  await pcSync(desk);
  assert.ok(desk.titles().includes("Typed while waiting"));
  assert.equal((await phone.status()).fingerprint, desk.sync.status().fingerprint);
});

test("a save made while sync downloads is merged, never overwritten", async (t) => {
  let gate = null;
  const hold = (send) => async (request) => {
    if (gate && request.method === "GET" && request.url.includes(PC_ID)) {
      gate.hit = true;
      await gate.open;
    }
    return send(request);
  };
  const { desk, phone, personal } = await pair(t, { wrap: hold });
  desk.vault.saveEntry({ kind: "note", spaceId: personal, title: "From the PC", body: "p" });
  await pcSync(desk);
  let release;
  gate = { hit: false, open: new Promise((r) => (release = r)) };
  await phone.idle();
  const syncing = phone.host.syncNow();
  await until(() => gate.hit);
  const saved = await phone.host.saveEntry({ kind: "note", spaceId: personal, title: "Typed during the download", tags: [], favorite: false, notes: "", body: "q" });
  gate = null;
  release();
  assert.deepEqual(await syncing, { ok: true });
  const titles = await phone.titles();
  assert.ok(titles.includes("From the PC") && titles.includes("Typed during the download"), titles.join(" | "));
  assert.equal((await phone.onDisk()).sync.meta[saved.id].vv[phone.installId()], 1);
});

test("a new master password on the PC: the phone says why it cannot sync, asks for it (throttled), adopts it, and fingerprint unlock turns off", async (t) => {
  const { desk, phone } = await pair(t);
  assert.deepEqual(await phone.host.enableBiometric(), { ok: true });
  assert.equal((await desk.vault.changeMaster(MASTER, NEW_MASTER)).ok, true);
  await pcSync(desk);
  await phone.sync();
  let status = await phone.status();
  assert.equal(status.newMaster, "DESKTOP-4F2A");
  assert.equal(syncLineText(status, () => "").text, "DESKTOP-4F2A has a new master password");

  assert.deepEqual(await phone.host.adoptSyncKey("not it at all"), { ok: false, error: "That is not the master password set on DESKTOP-4F2A." });
  assert.ok(fs.existsSync(path.join(phone.dir, "unlock-throttle.json")), "a wrong one counts like a wrong unlock");
  assert.deepEqual(await phone.host.adoptSyncKey(NEW_MASTER), { ok: true });
  status = await phone.status();
  assert.deepEqual(status.review.reasons, ["key"]);
  assert.equal(await pc.crypto.openFile(NEW_MASTER, JSON.parse(fs.readFileSync(phone.file, "utf8"))), null, "nothing changes before Apply");
  assert.deepEqual(await phone.host.applySync(), { ok: true, biometricOff: true });
  assert.equal((await phone.host.biometricStatus()).enabled, false, "the fingerprint wrap held the old key");
  const data = await phone.onDisk(NEW_MASTER);
  assert.equal(data.sync.keys.length, 2);
  // A password proven on a snapshot never clears the miss count (SECURITY-AUDIT-2026-09-28.md L1): a snapshot
  // planted under a password of its own would otherwise reset it. Only this vault's own unlock does.
  assert.ok(fs.existsSync(path.join(phone.dir, "unlock-throttle.json")));

  await phone.sync();
  await pcSync(desk);
  assert.equal(desk.sync.status().newMaster, null, "the PC opens the phone's snapshots with no prompt");
  assert.deepEqual(desk.sync.status().problems, []);
  assert.equal((await phone.status()).fingerprint, desk.sync.status().fingerprint);
  await phone.host.lock();
  assert.deepEqual(await phone.host.unlock(NEW_MASTER), { ok: true });
  assert.ok(!fs.existsSync(path.join(phone.dir, "unlock-throttle.json")), "cleared by this vault's own unlock");
});

// Security re-scan 2026-10-10 (as on the PC): restoring a backup made before a lock-out put back the old
// key and dropped the removal, so the lost device's copy of that key opened every later upload.
test("restoring a backup from before a lock-out keeps the removal and the new key, from a file or from R2", async (t) => {
  const { r2, desk, phone } = await pair(t);
  const LOST = "eeeeeeee-1c1d-4e5f-8a9b-0c1d2e3f4a5b";
  const fileBefore = fs.readFileSync(phone.file, "utf8"); // under MASTER, before the removal
  const snapshotBefore = [...r2.objects.keys()].filter((k) => pc.cloud.snapshotOwner(k) === PC_ID).sort().at(-1);
  desk.vault.revokeDevice(LOST);
  assert.equal((await desk.vault.changeMaster(MASTER, NEW_MASTER)).ok, true); // the lock-out, finished on the PC
  await pcSync(desk);
  await phone.sync();
  assert.deepEqual(await phone.host.adoptSyncKey(NEW_MASTER), { ok: true });
  assert.equal((await phone.host.applySync()).ok, true);
  assert.ok((await phone.onDisk(NEW_MASTER)).sync.devices[LOST].revokedAt);

  const keptOut = async (what) => {
    const data = await phone.onDisk(NEW_MASTER);
    assert.ok(data, `${what}: the restored vault opens with the new master password`);
    assert.equal(await pc.crypto.openFile(MASTER, JSON.parse(fs.readFileSync(phone.file, "utf8"))), null, `${what}: and not with the old one`);
    assert.ok(data.sync.devices[LOST].revokedAt, `${what}: the lost device stays removed`);
    assert.equal(data.sync.keys.at(-1).salt, JSON.parse(fs.readFileSync(phone.file, "utf8")).kdf.salt, `${what}: the key history ends with the file's key`);
  };
  assert.deepEqual(await phone.host.restoreFile(fileBefore, MASTER), { ok: true });
  await keptOut("a file");
  fs.rmSync(path.join(phone.dir, "replaced.kapevault"), { force: true }); // the slot, free for the next restore
  assert.deepEqual(await phone.host.restore(R2_KEYS, snapshotBefore, MASTER, undefined, true), { ok: true });
  await keptOut("an R2 backup");
});

test("the phone under the old master password is 'behind' on the PC until it adopts the new one", async (t) => {
  const { desk, phone, personal } = await pair(t);
  assert.equal((await desk.vault.changeMaster(MASTER, NEW_MASTER)).ok, true);
  await pcSync(desk);
  await phone.host.saveEntry({ kind: "note", spaceId: personal, title: "Before adopting", tags: [], favorite: false, notes: "", body: "b" });
  await phone.sync();
  await pcSync(desk);
  assert.deepEqual(desk.sync.status().problems, ["Pixel 8 still uses the old master password. Unlock it there."]);
  assert.ok(!desk.titles().includes("Before adopting"));
  await phone.host.adoptSyncKey(NEW_MASTER);
  await phone.host.applySync();
  await phone.sync();
  await pcSync(desk);
  assert.ok(desk.titles().includes("Before adopting"), "nothing typed on the phone meanwhile is lost");
});

// Sync's re-keyed write goes through the same size check as every save (real-host writeVault).
test("adopting a new master password never writes a vault over the cap: Apply says why, the old key still opens it", async (t) => {
  const CAP = 256 * 1024;
  const { desk, phone, personal } = await pair(t, { maxVaultBytes: CAP });
  assert.equal((await desk.vault.changeMaster(MASTER, NEW_MASTER)).ok, true);
  await pcSync(desk);
  await phone.sync();
  assert.equal((await phone.status()).newMaster, "DESKTOP-4F2A");
  assert.deepEqual(await phone.host.adoptSyncKey(NEW_MASTER), { ok: true });
  // The vault grows after the review was held: Apply merges again into it (no uploads meanwhile).
  await phone.host.setCloudAuto(false);
  await fillNearCap(phone.host, phone.file, personal, 20, CAP);
  const before = fs.readFileSync(phone.file, "utf8");
  assert.deepEqual(await phone.host.applySync(), { ok: false, error: "The vault would be too big to back up (over 64 MB), so this was not saved. Remove some photos or long notes first." });
  assert.equal(fs.readFileSync(phone.file, "utf8"), before, "nothing written");
  assert.ok((await phone.onDisk(MASTER)).entries.some((e) => e.title === "Long"));
  assert.ok((await phone.titles()).includes("Long"), "still open under the old key");
});

test("adopting a new master password whose write fails without a reason says so in sync's words", async (t) => {
  let failing = false;
  const wrapFs = (files) => ({
    ...files,
    async replace(name, text) {
      if (failing && name.includes("kapevault")) throw new Error("");
      return files.replace(name, text);
    },
  });
  const { desk, phone } = await pair(t, { wrapFs });
  assert.equal((await desk.vault.changeMaster(MASTER, NEW_MASTER)).ok, true);
  await pcSync(desk);
  await phone.sync();
  assert.deepEqual(await phone.host.adoptSyncKey(NEW_MASTER), { ok: true });
  failing = true;
  assert.deepEqual(await phone.host.applySync(), { ok: false, error: "Could not save the synced vault." });
});

test("a restore made the vault on all devices (epoch) on the PC: the phone follows after a review, its own new item kept as a conflict copy", async (t) => {
  const { r2, desk, phone, personal } = await pair(t);
  const backupKey = [...r2.objects.keys()].filter((k) => k.includes(PC_ID)).sort().at(-1);
  const backup = r2.objects.get(backupKey).toString("utf8");
  desk.vault.saveEntry({ kind: "note", spaceId: personal, title: "Made after the backup", body: "x" });
  await pcSync(desk);
  await phone.sync();
  await phone.host.saveEntry({ kind: "note", spaceId: personal, title: "Phone only", tags: [], favorite: false, notes: "", body: "y" });

  const check = await desk.vault.verifyBackup(backup, MASTER);
  desk.vault.commitRestore(backup, check.opened, { cloud: desk.vault.cloudConfig() });
  desk.sync.pauseAfterRestore();
  await desk.sync.answerRestore(true);
  await phone.sync();
  const status = await phone.status();
  assert.deepEqual(status.review.reasons, ["epoch"]);
  assert.equal((await phone.host.applySync()).ok, true);
  const data = await phone.onDisk();
  assert.equal(data.sync.epoch.id, (await pc.crypto.openFile(MASTER, JSON.parse(fs.readFileSync(desk.file, "utf8")))).data.sync.epoch.id);
  const titles = await phone.titles();
  assert.ok(titles.some((t) => t.startsWith("Phone only (conflict copy")), titles.join(" | "));
  await phone.sync();
  await pcSync(desk);
  await phone.sync();
  assert.equal((await phone.status()).fingerprint, desk.sync.status().fingerprint);
});

test("removed on the PC: the phone stops syncing, says so, and never rejoins with the same id", async (t) => {
  const { desk, phone, personal } = await pair(t);
  const ref = desk.sync.status().devices.find((d) => d.name === "Pixel 8").ref;
  desk.sync.revoke(ref);
  await pcSync(desk);
  await phone.sync();
  // Security re-scan 2026-10-10: anyone with the vault key could switch the phone off for good, unseen.
  // The removal waits for a review, and nothing changes on the phone before Apply.
  const asked = await phone.status();
  assert.deepEqual(asked.review?.reasons, ["removed"]);
  assert.equal(asked.removed, false);
  assert.equal((await phone.onDisk()).sync.devices[phone.installId()].revokedAt, undefined, "nothing written before Apply");
  assert.equal((await phone.host.applySync()).ok, true);
  const status = await phone.status();
  assert.equal(status.removed, true);
  assert.equal(syncLineText(status, () => "").text, "This phone was removed from sync");
  assert.ok((await phone.onDisk()).sync.devices[phone.installId()].revokedAt);

  await phone.host.saveEntry({ kind: "note", spaceId: personal, title: "After removal", tags: [], favorite: false, notes: "", body: "z" });
  desk.vault.saveEntry({ kind: "note", spaceId: personal, title: "PC after removal", body: "w" });
  await phone.sync();
  await pcSync(desk);
  assert.ok(!desk.titles().includes("After removal"), "the PC never merges it again");
  assert.ok(!(await phone.titles()).includes("PC after removal"), "the phone no longer merges either");
  assert.ok((await phone.onDisk()).sync.devices[phone.installId()].revokedAt, "registering again never lifts it");
  assert.equal(desk.sync.status().devices.length, 0);
});

test("no-change syncs send nothing", async (t) => {
  const { r2, desk, phone } = await pair(t);
  await phone.sync();
  await pcSync(desk);
  await wait(100);
  const before = puts(r2);
  for (let i = 0; i < 3; i++) {
    await phone.sync();
    await pcSync(desk);
  }
  await wait(100);
  assert.equal(puts(r2), before);
});

test("the older-key question is true for a restore that drops the key and for one that keeps it", () => {
  const drops = olderKeyQuestion("DESKTOP-4F2A", false);
  assert.match(drops, /before the master password was changed on DESKTOP-4F2A/);
  assert.match(drops, /will see this phone as behind/);
  assert.doesNotMatch(drops, /keeps this phone's current master password/);
  const keeps = olderKeyQuestion("DESKTOP-4F2A", true);
  assert.match(keeps, /The restore keeps this phone's current master password\. If that one is older than the one on DESKTOP-4F2A/);
  assert.match(keeps, /Restore it anyway\?$/);
});

test("restoring a backup made before a newer master password: said first, restored only on Restore anyway", async (t) => {
  const { r2, desk } = await pair(t);
  const oldKey = [...r2.objects.keys()].filter((k) => k.includes(PC_ID)).sort().at(-1);
  assert.equal((await desk.vault.changeMaster(MASTER, NEW_MASTER)).ok, true);
  await pcSync(desk);

  const fresh = phoneDevice(t, r2);
  const asked = await fresh.host.restore(R2_KEYS, oldKey, MASTER);
  assert.equal(asked.ok, false);
  assert.equal(asked.olderKey, true);
  assert.match(asked.error, /before the master password was changed on DESKTOP-4F2A/);
  assert.equal(await fresh.host.state(), "first-run", "nothing restored yet");
  assert.deepEqual(await fresh.host.restore(R2_KEYS, oldKey, MASTER, undefined, true), { ok: true });
  await fresh.idle();
  assert.equal((await fresh.status()).newMaster, "DESKTOP-4F2A", "and the phone then asks for the newer one");

  const other = phoneDevice(t, r2);
  const newest = (await other.host.listBackups(R2_KEYS)).backups.find((b) => b.key.includes(PC_ID)).key;
  assert.deepEqual(await other.host.restore(R2_KEYS, newest, NEW_MASTER), { ok: true }, "the newest backup restores with no question");
});

// SYNC audit 2026-10-04 (crypto 9, as on the PC): anyone with the bucket keys can put one file under a
// known device's folder; it must not hide that device's real snapshots.
test("a planted unknown-password snapshot in the PC's folder does not hide its real ones", async (t) => {
  const { r2, desk, phone, personal } = await pair(t);
  desk.vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock PC note", body: "b" });
  await pcSync(desk);
  const stranger = pcDevice(r2, { id: "00000000-0000-4000-8000-000000000002", name: "Junk" });
  await stranger.vault.create("xK9#mQ2$vL7@pZ4!wR8&tN3");
  r2.put(`kapevault/snapshots/${PC_ID}/2026-09-27T07-00-00-000Z.kapevault`, fs.readFileSync(stranger.file), new Date(Date.now() + 86_400_000));
  await phone.sync();
  assert.ok((await phone.titles()).includes("Mock PC note"), "the PC's real snapshot is still merged");
  assert.equal((await phone.status()).newMaster, "DESKTOP-4F2A", "and the prompt is still shown");
});

// SECURITY-AUDIT M-1: planted device folders cost downloads on every run; the phone reads a few per run and never a failed one again.
test("planted junk devices: a few read per run, none again once they failed, and the PC is still synced", async (t) => {
  const { r2, phone } = await pair(t);
  for (let n = 1; n <= 30; n++) {
    const k = `kapevault/snapshots/00000000-0000-4000-8000-${String(n).padStart(12, "0")}/2026-09-27T07-00-00-000Z.kapevault`;
    r2.put(k, "not a vault");
  }
  const gets = () => r2.requests.filter((r) => r.method === "GET" && r.key.startsWith("kapevault/snapshots/")).length;
  let before = gets();
  await phone.sync();
  assert.ok(gets() - before <= 3 * 9, "the PC plus 8 newcomers, three tries each");
  for (let i = 0; i < 5; i++) await phone.sync();
  before = gets();
  await phone.sync();
  assert.equal(gets() - before, 0, "the PC has nothing new and the junk is remembered");
  assert.deepEqual((await phone.status()).problems, []);
});
