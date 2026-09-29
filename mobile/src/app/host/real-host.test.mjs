// The real host end to end in Node: the phone's files in a temp folder (with the plugin's rename), HTTP
// to a fake R2 that checks every signature with the PC's signer, fake fingerprint and clipboard
// plugins. The PC's own code reads and writes the same vault file.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRealHost } from "./real-host.ts";
import { MAX_VAULT_BYTES } from "./vault-file.ts";
import { R2_KEYS, fakeClipboard, fakeKeystore, fakeR2, fetchTransport, nodeFs, pc, pcVaultNearCap, pcVaultText, tempDir, until } from "./test/fixtures.mjs";

const MASTER = "Lantern-Mango-Quiet-47";
const PC_ID = "9d9d9d9d-1c1d-4e5f-8a9b-0c1d2e3f4a5b";
const PERSONAL = "5c1f7c1e-0000-4000-8000-000000000001";
const PC_VAULT = {
  spaces: [{ id: PERSONAL, name: "Personal", kind: "personal" }],
  entries: [
    { id: "e-mail", spaceId: PERSONAL, kind: "login", title: "Mail", tags: [], favorite: false, notes: "", updatedAt: "2026-09-20", username: "sam.home@example.com", password: "Mail-Pass-2291!", url: "mail.example.com", signIn: "password" },
    { id: "e-router", spaceId: PERSONAL, kind: "device", title: "Router", tags: [], favorite: false, notes: "", updatedAt: "2026-09-20", type: "router", adminUrl: "192.168.0.1", adminPassword: "Rtr!8842" },
    { id: "e-due", spaceId: PERSONAL, kind: "due", title: "Old due item", tags: [], favorite: false, notes: "", updatedAt: "2026-09-01", agency: "Water", schedule: "monthly" },
  ],
  cloud: { endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "kapevault-e2e", accessKeyId: "pc-key", secretAccessKey: "pc-secret", auto: true },
  olderBackupsPending: true,
};

// A bucket per test holding the PC's snapshot: the phones sync now, so one test's phone must not merge
// another's changes.
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

function phone(t, { dir = tempDir(), ...extra } = {}) {
  const keystore = fakeKeystore();
  const clipboard = fakeClipboard();
  const opened = [];
  const host = createRealHost({ fs: nodeFs(dir), transport: fetchTransport(r2), keystore, clipboard, openUrl: (u) => opened.push(u), model: "Pixel 8", backupDelayMs: 30, retryMs: 50, ...extra });
  t.after(() => host.lock());
  const file = path.join(dir, "vault.kapevault");
  const installId = () => JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8")).installId;
  const onDisk = () => pc.crypto.openFile(MASTER, JSON.parse(fs.readFileSync(file, "utf8")));
  return { host, dir, file, keystore, clipboard, opened, installId, onDisk };
}

async function firstRun(t, options) {
  const p = phone(t, options);
  const backup = (await p.host.listBackups(R2_KEYS)).backups.find((b) => b.key.includes(PC_ID));
  assert.equal((await p.host.restore(R2_KEYS, backup.key, MASTER)).ok, true);
  await settled(p);
  return p;
}

// The sync after an unlock has run, and the snapshot it left owed is up: the newest one this phone
// sent is the file on disk.
async function settled(p) {
  await until(async () => (await p.host.syncStatus()).lastAt && (await p.host.syncStatus()).state !== "syncing");
  await until(() => {
    const newest = mine(p.installId()).at(-1);
    return newest && r2.objects.get(newest).toString("utf8") === fs.readFileSync(p.file, "utf8");
  });
}
const mine = (id) => [...r2.objects.keys()].filter((k) => pc.cloud.snapshotOwner(k) === id);

test("first run: list the PC's backups, restore one with its master password, and the PC opens what the phone wrote", async (t) => {
  const { host, file, installId, onDisk } = phone(t);
  assert.equal(await host.state(), "first-run");
  assert.match((await host.listBackups({ ...R2_KEYS, url: "https://example.com/b-1" })).error, /S3 API URL/);
  assert.match((await host.listBackups({ ...R2_KEYS, accessKeyId: "someone-else" })).error, /R2 refused the keys/);
  const listed = await host.listBackups(R2_KEYS);
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.backups.map((b) => [b.device, b.platform]), [["PC", "windows"]]);

  assert.deepEqual(await host.restore(R2_KEYS, listed.backups[0].key, "wrong password"), { ok: false, error: "Wrong master password for that backup." });
  assert.equal(await host.state(), "first-run", "a wrong password changes nothing");

  const states = [];
  host.onState((s) => states.push(s));
  assert.deepEqual(await host.restore(R2_KEYS, listed.backups[0].key, MASTER), { ok: true });
  assert.deepEqual(states, ["unlocked"]);
  const view = await host.view();
  assert.deepEqual(view.entries.map((e) => e.title).sort(), ["Mail", "Old due item", "Router"]);
  assert.equal(view.entries.find((e) => e.id === "e-due").kind, "note", "a removed due item opens as a note");
  const mail = view.entries.find((e) => e.id === "e-mail");
  assert.equal(mail.hasPassword, true);
  assert.equal(mail.password, undefined, "the page never gets a stored secret in a view");
  assert.equal(await host.getSecret("e-mail", "password"), "Mail-Pass-2291!");

  const saved = (await onDisk()).data;
  assert.deepEqual(saved.cloud, { endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "kapevault-e2e", accessKeyId: R2_KEYS.accessKeyId, secretAccessKey: R2_KEYS.secretAccessKey, auto: true }, "this phone's own R2 keys, never the PC's");
  assert.equal(saved.olderBackupsPending, undefined, "the PC's device-local flag stays the PC's");
  assert.deepEqual(await host.cloudStatus(), { connected: true, url: R2_KEYS.url, accessKeyId: R2_KEYS.accessKeyId, auto: true, apart: false });
  assert.ok(!JSON.stringify(await host.cloudStatus()).includes(R2_KEYS.secretAccessKey));
  assert.ok(!fs.readFileSync(file, "utf8").includes(R2_KEYS.secretAccessKey), "the R2 secret is inside the ciphertext only");

  // The phone's snapshot goes up under its own install id, byte for byte the file on disk.
  await settled({ host, installId, file });
  const key = mine(installId()).at(-1);
  assert.equal(r2.objects.get(key).toString("utf8"), fs.readFileSync(file, "utf8"));
  assert.equal(r2.badSignatures, 0, "every request carried a signature the PC's signer agrees with");
});

test("saves are stamped with this phone's id, survive a reopen, and the PC continues the same file", async (t) => {
  const p = await firstRun(t);
  const saved = await p.host.saveEntry({ kind: "login", spaceId: PERSONAL, title: "Bank", tags: [], favorite: false, notes: "", username: "sam", password: "Bank-Pass-1!", url: "bank.example.com", signIn: "password" });
  assert.equal(saved.ok, true);
  const me = p.installId();
  let data = (await p.onDisk()).data;
  assert.deepEqual(data.sync.meta[saved.id].vv, { [me]: 1 });
  await p.host.toggleFavorite(saved.id);
  data = (await p.onDisk()).data;
  assert.deepEqual(data.sync.meta[saved.id].vv, { [me]: 2 });
  assert.equal(data.entries.find((e) => e.id === saved.id).favorite, true);
  await p.host.deleteEntry("e-router");
  data = (await p.onDisk()).data;
  assert.ok(data.sync.gone["e-router"], "a delete is a tombstone");
  assert.ok(!data.entries.some((e) => e.id === "e-router"));
  assert.deepEqual((await p.host.saveEntry({ kind: "login", spaceId: "no-such-space", title: "", tags: [], favorite: false, notes: "" })).ok, false);
  await p.host.lock();

  // The PC's own session opens the phone's file, edits it and stamps with its id.
  const pcSession = pc.session.createVaultSession(p.file, { installId: () => PC_ID });
  assert.equal((await pcSession.unlock(MASTER)).ok, true);
  pcSession.saveEntry({ id: saved.id, kind: "login", spaceId: PERSONAL, title: "Bank (PC)", tags: [], favorite: true, notes: "", username: "sam", url: "bank.example.com", signIn: "password" });
  pcSession.lock();

  const again = phone(t, { dir: p.dir });
  assert.equal(await again.host.state(), "locked");
  assert.deepEqual(await again.host.unlock(MASTER), { ok: true });
  const bank = (await again.host.view()).entries.find((e) => e.id === saved.id);
  assert.equal(bank.title, "Bank (PC)");
  assert.equal(await again.host.getSecret(saved.id, "password"), "Bank-Pass-1!", "a secret left undefined keeps the stored one");
  data = (await again.onDisk()).data;
  assert.equal(data.sync.meta[saved.id].vv[PC_ID], 1);
  assert.equal(data.sync.meta[saved.id].vv[me], 2);
});

test("unlock: wrong passwords are counted in a file, the right one clears it", async (t) => {
  const p = await firstRun(t);
  await p.host.lock();
  assert.deepEqual(await p.host.unlock("nope"), { ok: false, error: "Wrong master password. Try again." });
  assert.ok(fs.existsSync(path.join(p.dir, "unlock-throttle.json")));
  assert.deepEqual(await p.host.unlock(MASTER), { ok: true });
  assert.ok(!fs.existsSync(path.join(p.dir, "unlock-throttle.json")));
});

test("fingerprint: on, lock, unlock by fingerprint; a new master password turns it off and re-keys the file", async (t) => {
  const p = await firstRun(t);
  assert.deepEqual(await p.host.biometricStatus(), { available: true, enabled: false, needsMaster: false });
  assert.deepEqual(await p.host.enableBiometric(), { ok: true });
  await p.host.lock();
  await assert.rejects(p.host.view(), /locked/);
  assert.deepEqual(await p.host.unlockBiometric(), { ok: true });
  assert.equal((await p.host.view()).entries.length, 3);

  assert.match((await p.host.changeMaster(MASTER, "short")).error, /./, "the rule refuses a weak one");
  assert.deepEqual(await p.host.changeMaster("not it", "Harbor-Pine-Slack-2291-Wren"), { ok: false, error: "The current password is wrong." });
  assert.deepEqual(await p.host.changeMaster(MASTER, "Harbor-Pine-Slack-2291-Wren"), { ok: true, biometricOff: true });
  assert.equal((await p.host.biometricStatus()).enabled, false);
  const file = JSON.parse(fs.readFileSync(p.file, "utf8"));
  assert.equal(await pc.crypto.openFile(MASTER, file), null);
  const opened = await pc.crypto.openFile("Harbor-Pine-Slack-2291-Wren", file);
  assert.equal(opened.data.olderBackupsPending, true, "older R2 snapshots still open with the old password");
  assert.equal(opened.data.sync.keys.length, 2);
  assert.equal((await p.host.view()).entries.length, 3, "still unlocked, under the new key");
});

test("fingerprint: a wrap that no longer opens the vault is turned off with 'changed'", async (t) => {
  const p = await firstRun(t);
  await p.host.enableBiometric();
  p.keystore.key = Buffer.alloc(32, 7).toString("base64"); // another vault's key
  await p.host.lock();
  const result = await p.host.unlockBiometric();
  assert.equal(result.ok, false);
  assert.equal(result.code, "changed");
  assert.equal((await p.host.biometricStatus()).enabled, false);
  assert.equal(await p.host.state(), "locked");
});

// SECURITY-AUDIT-2026-09-28.md M3: the header's salt is not covered by the tag. Edited, a fingerprint unlock used to
// open it, save it back, and lock the master password out of the vault and every later copy.
test("fingerprint: an edited header salt asks for the master password, writes nothing, and stays on", async (t) => {
  const p = await firstRun(t);
  await p.host.enableBiometric();
  await p.host.lock();
  const real = fs.readFileSync(p.file, "utf8");
  const raw = JSON.parse(real);
  const planted = JSON.stringify({ ...raw, kdf: { ...raw.kdf, salt: Buffer.alloc(16, 9).toString("base64") } });
  fs.writeFileSync(p.file, planted);
  const result = await p.host.unlockBiometric();
  assert.equal(result.ok, false);
  assert.equal(result.code, "master-required", "the unlock screen switches to typing");
  assert.match(result.error, /master password/);
  assert.equal(await p.host.state(), "locked");
  assert.equal(fs.readFileSync(p.file, "utf8"), planted, "nothing was saved over it");
  assert.equal((await p.host.biometricStatus()).enabled, true, "the fingerprint still fits the key");
  fs.writeFileSync(p.file, real);
  assert.deepEqual(await p.host.unlockBiometric(), { ok: true });
});

test("Lock after: the session ends on time, by either clock, and says why", async (t) => {
  const clock = { t: Date.now(), mono: 0 };
  const p = await firstRun(t, { now: () => clock.t, monotonic: () => clock.mono });
  const reasons = [];
  p.host.onState((s, why) => reasons.push([s, why]));
  clock.mono += 8 * 3600_000 - 1;
  await p.host.view();
  clock.t += 8 * 3600_000; // the phone slept: the monotonic clock stood still
  await assert.rejects(p.host.view(), /locked/);
  assert.deepEqual(reasons, [["locked", "session-limit"]]);

  assert.deepEqual(await p.host.setSettings({ lockAfterHours: 0, lockGrace: 7 }), { lockGrace: 30, lockAfterHours: 0, theme: "system", hideFromCapture: true }, "only known values");
  assert.deepEqual(await p.host.unlock(MASTER), { ok: true });
  clock.t += 100 * 3600_000;
  assert.equal((await p.host.view()).entries.length, 3, "Off means no limit");
});

test("hide from screen capture: the window follows the setting, read at start and on every change", async (t) => {
  const calls = [];
  const p = await firstRun(t, { hideFromCapture: async (hidden) => void calls.push(hidden) });
  await p.host.settings();
  assert.deepEqual(calls, [true], "on by default, applied once the settings are read");
  assert.equal((await p.host.setSettings({ hideFromCapture: "no" })).hideFromCapture, true, "only a boolean");
  assert.equal((await p.host.setSettings({ hideFromCapture: false })).hideFromCapture, false);
  assert.equal(calls.at(-1), false);
});

test("copy and open: secrets go to the secure clipboard, a lock clears it, only web links open", async (t) => {
  const p = await firstRun(t);
  await p.host.copySecret("e-mail", "password");
  assert.deepEqual([p.clipboard.text, p.clipboard.sensitive], ["Mail-Pass-2291!", true]);
  await p.host.copyText("sam.home@example.com", "e-mail");
  assert.equal(p.clipboard.sensitive, false);
  await p.host.openEntry("e-mail");
  await p.host.openEntry("e-router");
  assert.deepEqual(p.opened, ["https://mail.example.com/", "http://192.168.0.1/"]);
  const link = await p.host.saveEntry({ kind: "link", spaceId: PERSONAL, title: "Bad", tags: [], favorite: false, notes: "", linkType: "web", location: "javascript:alert(1)" });
  await assert.rejects(p.host.openEntry(link.id), /Only web links/);
  const folder = await p.host.saveEntry({ kind: "link", spaceId: PERSONAL, title: "Docs", tags: [], favorite: false, notes: "", linkType: "folder", location: "C:\\Users\\sam\\Docs" });
  await assert.rejects(p.host.openEntry(folder.id), /on your PC/);
  // A rooted path (path.win32.isAbsolute) used to open as https://shared/Docs.
  for (const location of ["\\Shared\\Docs", "/srv/docs", "\\\\nas\\share", "D:/Docs"]) {
    const rooted = await p.host.saveEntry({ kind: "link", spaceId: PERSONAL, title: "Rooted", tags: [], favorite: false, notes: "", linkType: "web", location });
    await assert.rejects(p.host.openEntry(rooted.id), /on your PC/, location);
  }
  await until(async () => Boolean((await p.onDisk()).data.entries.find((e) => e.id === "e-mail").lastUsedAt));
  await p.host.copySecret("e-mail", "password");
  await p.host.lock();
  assert.equal(p.clipboard.text, "", "lock clears a copied secret now");
});

test("sync: Sync now merges, uploads and lists the devices; auto backup off uploads nothing by itself", async (t) => {
  const p = await firstRun(t);
  assert.equal((await p.host.setCloudAuto(false)).auto, false);
  const before = mine(p.installId()).length;
  await p.host.toggleFavorite("e-mail");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(mine(p.installId()).length, before, "no upload with auto backup off");

  assert.deepEqual(await p.host.syncNow(), { ok: true });
  assert.equal(mine(p.installId()).length, before + 1);
  assert.deepEqual(await p.host.syncNow(), { ok: true });
  assert.equal(mine(p.installId()).length, before + 1, "a sync with nothing new sends nothing");
  const status = await p.host.syncStatus();
  assert.equal(status.state, "idle");
  assert.equal(status.manual, true);
  assert.deepEqual(status.conflicts, []);
  const [me, ...others] = status.devices;
  assert.deepEqual([me.name, me.model, me.platform, me.thisDevice, me.id], ["This phone", "Pixel 8", "android", true, p.installId()]);
  const pcDevice = others.find((d) => d.id === PC_ID);
  // This PC never met another device, so it has no name in the vault yet (sync.test.mjs: once it has).
  assert.deepEqual([pcDevice.name, pcDevice.model, pcDevice.platform, pcDevice.thisDevice], ["Another device", "Windows PC", "windows", false]);
  assert.equal(pcDevice.lastSyncAt, Date.UTC(2026, 8, 26, 9), "by R2's LastModified");
  const onDisk = (await p.onDisk()).data;
  assert.deepEqual([onDisk.sync.devices[p.installId()].name, onDisk.sync.devices[p.installId()].platform], ["Pixel 8", "android"], "it met the PC's snapshot, so it registered");
  assert.equal(status.peer, "Another device");
});

test("restore from the lock screen keeps the vault it replaces, once", async (t) => {
  const p = await firstRun(t);
  const before = fs.readFileSync(p.file, "utf8");
  await p.host.lock();
  const backup = (await p.host.listBackups(R2_KEYS)).backups.find((b) => b.key.includes(PC_ID));
  assert.deepEqual(await p.host.restore(R2_KEYS, backup.key, MASTER), { ok: true });
  assert.equal(fs.readFileSync(path.join(p.dir, "replaced.kapevault"), "utf8"), before);
  await p.host.toggleFavorite("e-mail"); // the vault now differs from the kept one
  await p.host.lock();
  const again = await p.host.restore(R2_KEYS, backup.key, MASTER);
  assert.equal(again.ok, false);
  assert.match(again.error, /already keeps a vault/);
  assert.equal(fs.readFileSync(path.join(p.dir, "replaced.kapevault"), "utf8"), before, "the kept vault is never overwritten");
});

test("Replace without a copy: a taken slot asks first; locked, it needs the CURRENT vault's own master password", async (t) => {
  const p = await firstRun(t);
  const NEW = "Harbor-Kettle-Violet-62";
  await p.host.lock();
  const backup = (await p.host.listBackups(R2_KEYS)).backups.find((b) => b.key.includes(PC_ID));
  assert.deepEqual(await p.host.restore(R2_KEYS, backup.key, MASTER), { ok: true }); // fills the slot
  const kept = fs.readFileSync(path.join(p.dir, "replaced.kapevault"), "utf8");
  // The vault now differs from the kept one, and no longer opens with the backup's password.
  assert.equal((await p.host.changeMaster(MASTER, NEW)).ok, true);
  await p.host.lock();
  const current = fs.readFileSync(p.file, "utf8");
  const unchanged = () => {
    assert.equal(fs.readFileSync(p.file, "utf8"), current, "the vault is not replaced");
    assert.equal(fs.readFileSync(path.join(p.dir, "replaced.kapevault"), "utf8"), kept, "the slot stays as it is");
  };

  const asked = await p.host.restore(R2_KEYS, backup.key, MASTER);
  assert.deepEqual({ ...asked, error: undefined }, { ok: false, needsConfirm: true, needsMaster: true, error: undefined });
  assert.match(asked.error, /already keeps a vault.*without keeping a copy/);
  assert.equal((await p.host.restore(R2_KEYS, backup.key, MASTER, {})).needsConfirm, true, "locked, a confirm alone is not enough");
  const wrong = await p.host.restore(R2_KEYS, backup.key, MASTER, { current: MASTER }); // the backup's password, not this vault's
  assert.deepEqual([wrong.needsConfirm, wrong.needsMaster, wrong.error], [true, true, "Wrong master password for the vault on this phone."]);
  assert.equal(await p.host.state(), "locked");
  unchanged();
  assert.deepEqual(await p.host.restore(R2_KEYS, backup.key, "wrong password", { current: NEW }), { ok: false, error: "Wrong master password for that backup." });
  unchanged();

  assert.deepEqual(await p.host.restore(R2_KEYS, backup.key, MASTER, { current: NEW }), { ok: true });
  assert.equal(await p.host.state(), "unlocked");
  assert.equal(fs.readFileSync(path.join(p.dir, "replaced.kapevault"), "utf8"), kept, "replaced without a copy: the slot is left alone");
  assert.equal((await p.host.view()).entries.find((e) => e.id === "e-mail").favorite, false, "the backup's vault is open");
  assert.notEqual((await p.onDisk()), null, "and written, opening with the backup's password");

  // Unlocked, the open session is the proof: one confirm, no password.
  await p.host.toggleFavorite("e-mail");
  const unlockedAsk = await p.host.restore(R2_KEYS, backup.key, MASTER);
  assert.deepEqual([unlockedAsk.needsConfirm, unlockedAsk.needsMaster], [true, undefined]);
  assert.deepEqual(await p.host.restore(R2_KEYS, backup.key, MASTER, {}), { ok: true });
  assert.equal(fs.readFileSync(path.join(p.dir, "replaced.kapevault"), "utf8"), kept);
});

test("restore from a file while unlocked with R2 on: this phone's R2 setup stays, the vault it replaces is kept", async (t) => {
  const p = await firstRun(t); // connected with R2_KEYS; the backup file carries the PC's own (pc-key)
  const before = fs.readFileSync(p.file, "utf8");
  assert.deepEqual(await p.host.restoreFile(pcText, MASTER), { ok: true });
  const cloud = await p.host.cloudStatus();
  assert.deepEqual([cloud.connected, cloud.url, cloud.accessKeyId], [true, R2_KEYS.url, R2_KEYS.accessKeyId]);
  assert.equal(fs.readFileSync(path.join(p.dir, "replaced.kapevault"), "utf8"), before);
});

test("scanQr: the camera's text; closed says nothing; no camera or no permission points at typing or pasting", async (t) => {
  const answers = [];
  const { host } = phone(t, { scanQr: async (purpose) => answers.shift()(purpose) });
  const reject = (code) => () => Promise.reject(Object.assign(new Error(code), { code }));
  answers.push((purpose) => `scanned for ${purpose}`, reject("canceled"), reject("denied"), reject("denied"), reject("unavailable"), reject("failed"));
  assert.deepEqual(await host.scanQr("setup"), { ok: true, text: "scanned for setup" });
  assert.deepEqual(await host.scanQr("totp"), { ok: false, canceled: true, error: "" });
  assert.match((await host.scanQr("setup")).error, /may not use the camera\. Type the keys instead, or allow the camera/);
  assert.match((await host.scanQr("totp")).error, /may not use the camera\. Paste the key instead/);
  assert.match((await host.scanQr("setup")).error, /no camera KAPEVault can use\. Type the keys instead\./);
  assert.match((await host.scanQr("totp")).error, /camera did not start\. Paste the key instead\./);
});

test("restore from a file: junk and a planted KDF are refused before any key derivation; a real vault file opens with its own password", async (t) => {
  const p = phone(t);
  const throttleFile = path.join(p.dir, "unlock-throttle.json");
  const junk = "PK a zip, not a vault";
  const refused = { ok: false, error: "That file is not a KAPEVault backup. Pick the .kapevault file." };
  assert.deepEqual(p.host.checkBackupFile(junk), refused);
  assert.deepEqual(await p.host.restoreFile(junk, MASTER), refused);
  // A header that would make scrypt run for hours: refused at once, and never counted as a guess.
  const header = JSON.parse(pcText);
  const planted = JSON.stringify({ ...header, kdf: { ...header.kdf, p: 2 ** 20 } });
  const started = Date.now();
  assert.deepEqual(await p.host.restoreFile(planted, MASTER), refused);
  assert.ok(Date.now() - started < 200, "no key derivation ran");
  assert.equal(fs.existsSync(throttleFile), false, "a refused file is not a password guess");
  assert.equal(await p.host.state(), "first-run");

  // A file bigger than any vault is refused by the host itself, whatever the page checked first.
  const tooBig = { ok: false, error: "That file is too big to be a KAPEVault backup." };
  const padded = pcText + " ".repeat(MAX_VAULT_BYTES); // still a valid vault file to JSON.parse
  assert.deepEqual(p.host.checkBackupFile(padded), tooBig);
  assert.deepEqual(await p.host.restoreFile(padded, MASTER), tooBig);

  assert.deepEqual(p.host.checkBackupFile(pcText), { ok: true });
  assert.deepEqual(await p.host.restoreFile(pcText, "wrong password"), { ok: false, error: "Wrong master password for that backup." });
  assert.equal(fs.existsSync(throttleFile), true, "a wrong password is counted like any other");
  assert.equal(fs.existsSync(p.file), false, "and nothing is written");

  assert.deepEqual(await p.host.restoreFile(pcText, MASTER), { ok: true });
  assert.equal(await p.host.state(), "unlocked");
  assert.ok((await p.host.view()).entries.some((e) => e.id === "e-mail"));
  assert.equal((await p.onDisk()).data.entries.length, 3, "written, and the PC's code opens it with the backup's password");
  const cloud = await p.host.cloudStatus();
  assert.deepEqual([cloud.connected, cloud.url, cloud.accessKeyId], [true, "https://0123abcd.r2.cloudflarestorage.com/kapevault-e2e", "pc-key"], "the backup's R2 setup came with it");

  // Locked, a second restore keeps the vault it replaces in the slot, as the R2 restore does.
  const before = fs.readFileSync(p.file, "utf8");
  await p.host.lock();
  assert.deepEqual(await p.host.restoreFile(pcText, MASTER), { ok: true });
  assert.equal(fs.readFileSync(path.join(p.dir, "replaced.kapevault"), "utf8"), before);
});

// Every write of the vault file goes through one size check. A restore, a new master password and
// taking the bucket's vault used to write past MAX_VAULT_BYTES: a vault no backup or restore would take.
// A 64 MB vault takes minutes through the phone's JS hashing here (and can run Node out of memory),
// so the host gets a smaller cap (maxVaultBytes) and the same writes.
const TOO_BIG = { ok: false, error: "The vault would be too big to back up (over 64 MB), so this was not saved. Remove some photos or long notes first." };
const PHONE_MASTER = "Copper-Violet-Harbor-83";

test("the vault is never written over the cap: a save, a restore, a new master password, the bucket's vault", async (t) => {
  const CAP = 256 * 1024;
  const pcKey = await pc.crypto.createKey(MASTER);
  // Just under the cap as the PC wrote it; the phone's copy adds keySalt (restore) or R2 keys too.
  const near = pcVaultNearCap(pcKey, { spaces: PC_VAULT.spaces, entries: PC_VAULT.entries.slice(0, 1) }, PERSONAL, 20, CAP);
  const p = phone(t, { maxVaultBytes: CAP });
  await p.host.createVault(PHONE_MASTER);
  const personal = (await p.host.view()).spaces[0].id;
  const mine = fs.readFileSync(p.file, "utf8");
  const nothingWritten = () => {
    assert.equal(fs.readFileSync(p.file, "utf8"), mine, "the vault file is as it was");
    assert.equal(fs.existsSync(path.join(p.dir, "replaced.kapevault")), false, "and no copy was kept for a restore that did not happen");
  };

  // persist
  assert.deepEqual(await p.host.saveEntry({ kind: "note", spaceId: personal, title: "Huge", tags: [], favorite: false, notes: "", body: "x".repeat(CAP) }), TOO_BIG);
  assert.deepEqual((await p.host.view()).entries, [], "and the open vault is back as saved");
  nothingWritten();

  // replaceWith, from a picked file
  assert.deepEqual(p.host.checkBackupFile(near), { ok: true }, "the file itself is under the cap");
  assert.deepEqual(await p.host.restoreFile(near, MASTER), TOO_BIG);
  nothingWritten();
  assert.deepEqual((await p.host.view()).spaces.map((s) => s.id), [personal], "this phone's vault stays open");

  // useCloudVault
  const pcKeyAt = pc.cloud.snapshotKey(new Date(Date.UTC(2026, 8, 27, 9)), PC_ID);
  r2.put(pcKeyAt, near, new Date(Date.UTC(2026, 8, 27, 9)));
  assert.equal((await p.host.connectCloud(R2_KEYS)).other.key, pcKeyAt);
  assert.deepEqual(await p.host.useCloudVault(R2_KEYS, pcKeyAt, MASTER), TOO_BIG);
  nothingWritten();

  // changeMaster: the PC's near-cap vault on this phone; the new key's sync record pushes it over.
  await p.host.lock();
  const marked = pcVaultNearCap(pcKey, { spaces: PC_VAULT.spaces, entries: [], keySalt: pcKey.salt.toString("base64") }, PERSONAL, 20, CAP);
  fs.writeFileSync(p.file, marked);
  assert.deepEqual(await p.host.unlock(MASTER), { ok: true });
  assert.equal(fs.readFileSync(p.file, "utf8"), marked, "an unlock of a marked vault writes nothing");
  assert.deepEqual(await p.host.changeMaster(MASTER, "Harbor-Kettle-Violet-62"), TOO_BIG);
  assert.equal(fs.readFileSync(p.file, "utf8"), marked);
  await p.host.lock();
  assert.deepEqual(await p.host.unlock(MASTER), { ok: true }, "the old master password still opens it");
});
