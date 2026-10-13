import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { HISTORY_LIMIT, KINDS, patchEntry, upsertEntry } from "./entries.js";

// upsertEntry's rules per kind, pinned field by field: what a save keeps, cleans, defaults and refuses.
const NOW = Date.UTC(2026, 8, 29, 4); // noon in PHT: the same local day everywhere near UTC+8 and UTC
mock.timers.enable({ apis: ["Date"], now: NOW });
let uuids = 0;
mock.method(globalThis.crypto, "randomUUID", () => `id-${++uuids}`);
const TODAY = new Date(NOW).toLocaleDateString("en-CA");
const JPEG = `data:image/jpeg;base64,${btoa("\xff\xd8\xff\xe0 mock jpeg")}`;

const vault = () => ({ spaces: [{ id: "s", name: "Personal", kind: "personal" }], entries: [] });
const common = { spaceId: "s", title: " Mock item ", tags: [" a ", "", "b"], favorite: 1, notes: "n", brand: "github", heldFor: " Mama " };
const base = (id, over = {}) => ({ id, spaceId: "s", title: "Mock item", tags: ["a", "b"], favorite: true, notes: "n", updatedAt: TODAY, brand: "github", lastUsedAt: undefined, heldFor: "Mama", ...over });
const save = (data, input) => {
  const id = upsertEntry(data, input);
  return data.entries.find((e) => e.id === id);
};

test("every kind: the shared fields are cleaned the same way; a bad brand, space, title or kind is refused", () => {
  const data = vault();
  assert.throws(() => upsertEntry(data, { ...common, kind: "note", title: "  " }), /Title is required/);
  assert.throws(() => upsertEntry(data, { ...common, kind: "note", spaceId: "nope" }), /Unknown space/);
  assert.throws(() => upsertEntry(data, { ...common, kind: "passkey" }), /Unknown item type/);
  assert.equal(save(data, { ...common, kind: "note", brand: "Not A Slug" }).brand, undefined);
});

test("login: history, 2FA, sign-in, via, questions, and what an edit keeps", () => {
  const data = vault();
  const bank = save(data, { ...common, kind: "login", username: " me ", password: "one", url: " https://x ", signIn: "password", totp: "JBSWY3DPEHPK3PXP" });
  assert.deepEqual(bank, {
    ...base(bank.id), kind: "login", username: "me", password: "one", url: "https://x", signIn: "password", viaEntryId: undefined,
    totp: "otpauth://totp/KAPEVault?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&digits=6&period=30", history: undefined, passwordChangedAt: TODAY, recoveryCodes: undefined, questions: undefined, lifecycle: undefined,
  });
  // Nothing secret sent: the password, 2FA and questions stay.
  const q = save(data, { ...common, id: bank.id, kind: "login", questions: [{ question: "Pet?", answer: "Mock" }] });
  assert.equal(q.password, "one");
  assert.equal(q.totp, bank.totp);
  const kept = save(data, { ...common, id: bank.id, kind: "login" });
  assert.deepEqual(kept.questions, [{ question: "Pet?", answer: "Mock" }]);
  // A new password pushes the old one into history (UTC time), newest first, capped.
  let edited = kept;
  for (let i = 0; i < HISTORY_LIMIT + 2; i++) edited = save(data, { ...common, id: bank.id, kind: "login", password: `p${i}` });
  assert.equal(edited.history.length, HISTORY_LIMIT);
  assert.deepEqual(edited.history[0], { password: `p${HISTORY_LIMIT}`, changedAt: new Date(NOW).toISOString() });
  // Sign in through another login; an unknown newer value is kept only while the edit leaves it.
  const google = save(data, { ...common, title: "Mock Google", kind: "login", password: "g" });
  const via = save(data, { ...common, title: "Mock App", kind: "login", signIn: "google", viaEntryId: google.id });
  assert.equal(via.viaEntryId, google.id);
  assert.equal(save(data, { ...common, id: via.id, kind: "login", signIn: "password", viaEntryId: google.id }).viaEntryId, undefined);
  data.entries = data.entries.map((e) => (e.id === via.id ? { ...e, signIn: "passkey" } : e));
  assert.equal(save(data, { ...common, id: via.id, kind: "login", signIn: "passkey" }).signIn, "passkey");
  assert.equal(save(data, { ...common, title: "Mock New", kind: "login", signIn: "passkey" }).signIn, "password");
  assert.throws(() => upsertEntry(data, { ...common, kind: "login", totp: "not a key!" }), /not a valid 2FA setup key/);
});

test("patchEntry changes only the username and edit date, keeping the password, 2FA and question answer", () => {
  const data = vault();
  const login = save(data, { ...common, kind: "login", username: "me", password: "one", totp: "JBSWY3DPEHPK3PXP", questions: [{ question: "Pet?", answer: "Mock" }] });
  const before = { ...login, updatedAt: "2026-09-28" };
  data.entries = [before];
  assert.equal(patchEntry(data, login.id, { username: "new-me" }), login.id);
  assert.deepEqual(data.entries[0], { ...before, username: "new-me", updatedAt: TODAY });
});

test("patchEntry never redirects to another item through changes.id", () => {
  const data = vault();
  const first = save(data, { ...common, kind: "note", title: "First", body: "one" });
  const second = save(data, { ...common, kind: "note", title: "Second", body: "two" });
  assert.equal(patchEntry(data, first.id, { id: second.id, title: "Patched" }), first.id);
  assert.equal(data.entries.find((e) => e.id === first.id).title, "Patched");
  assert.deepEqual(data.entries.find((e) => e.id === second.id), second);
});

test("note and key: a secret left undefined keeps the stored one; an expiry is a real day", () => {
  const data = vault();
  const note = save(data, { ...common, kind: "note", body: "secret" });
  assert.deepEqual(note, { ...base(note.id), kind: "note", body: "secret" });
  assert.equal(save(data, { ...common, id: note.id, kind: "note" }).body, "secret");
  const key = save(data, { ...common, kind: "key", keyId: " k1 ", secret: " s1 ", url: " u ", expires: "2027-01-31" });
  assert.deepEqual(key, { ...base(key.id), kind: "key", keyId: "k1", secret: "s1", url: "u", expires: "2027-01-31" });
  assert.deepEqual(save(data, { ...common, id: key.id, kind: "key" }), { ...base(key.id), kind: "key", keyId: "", secret: "s1", url: "", expires: undefined });
});

test("key and thing: a stored impossible expiry survives an edit that leaves it; a new one is refused", () => {
  const data = vault();
  const key = save(data, { ...common, kind: "key", secret: "s1" });
  const thing = save(data, { ...common, kind: "thing", spot: "drawer" });
  // An older import let these in.
  data.entries = data.entries.map((e) => ({ ...e, expires: "2026-02-31" }));
  assert.equal(save(data, { ...common, id: key.id, kind: "key", keyId: "k2", expires: "2026-02-31" }).expires, "2026-02-31");
  assert.equal(save(data, { ...common, id: thing.id, kind: "thing", spot: "shelf", expires: "2026-02-31" }).expires, "2026-02-31");
  assert.throws(() => upsertEntry(data, { ...common, id: key.id, kind: "key", expires: "2026-02-30" }), /Expiry must be a date/);
  assert.throws(() => upsertEntry(data, { ...common, kind: "key", expires: "2026-02-31" }), /Expiry must be a date/);
  assert.throws(() => upsertEntry(data, { ...common, kind: "thing", spot: "drawer", expires: "2026-02-31" }), /Expiry must be a date/);
});

test("every kind in KINDS saves a minimal item (a kind without its fields builder fails here)", () => {
  const data = vault();
  const needs = { thing: { spot: "drawer" }, id: { idType: "Passport" } };
  for (const kind of KINDS) {
    let saved;
    assert.doesNotThrow(() => (saved = save(data, { ...common, kind, ...needs[kind] })), `kind "${kind}" could not be saved`);
    assert.equal(saved.kind, kind);
  }
});

test("payee was removed: it can no longer be saved", () => {
  assert.equal(KINDS.includes("payee"), false);
  assert.throws(() => upsertEntry(vault(), { ...common, kind: "payee", who: "Mama", provider: "GCash", number: "09171234567" }), /Unknown item type/);
});

test("thing: needs its spot, grab defaults to 2, an unknown grab is kept only while the edit leaves it", () => {
  const data = vault();
  assert.throws(() => upsertEntry(data, { ...common, kind: "thing" }), /Say where it is kept/);
  const thing = save(data, { ...common, kind: "thing", spot: " drawer ", room: " " });
  assert.deepEqual(thing, { ...base(thing.id), brand: undefined, kind: "thing", room: undefined, spot: "drawer", grab: 2, expires: undefined });
  assert.throws(() => upsertEntry(data, { ...common, id: thing.id, kind: "thing", spot: "drawer", grab: 4 }), /Grab must be 1, 2 or 3/);
  data.entries = data.entries.map((e) => ({ ...e, grab: 4 }));
  assert.equal(save(data, { ...common, id: thing.id, kind: "thing", spot: "drawer", grab: 4 }).grab, 4);
});

test("device: type defaults to other, the two passwords and the photo stay when left undefined", () => {
  const data = vault();
  assert.throws(() => upsertEntry(data, { ...common, kind: "device", type: "toaster" }), /Unknown device type/);
  const device = save(data, { ...common, kind: "device", model: " AX10 ", imei: "490154203237518", mac: "aa-bb-cc-dd-ee-ff", adminPassword: "ap", wifiPassword: "wp", photo: JPEG });
  assert.deepEqual(device, {
    ...base(device.id), kind: "device", type: "other", model: "AX10", serial: undefined, imei: "490154203237518", mac: "AA:BB:CC:DD:EE:FF",
    adminUrl: undefined, adminUser: undefined, adminPassword: "ap", ssid: undefined, wifiPassword: "wp", photo: JPEG,
  });
  const edited = save(data, { ...common, id: device.id, kind: "device", type: "router" });
  assert.deepEqual([edited.type, edited.adminPassword, edited.wifiPassword, edited.photo], ["router", "ap", "wp", JPEG]);
  assert.equal(save(data, { ...common, id: device.id, kind: "device", adminPassword: "", photo: "" }).adminPassword, undefined);
});

test("id: the number and photo stay when left undefined; no brand", () => {
  const data = vault();
  const id = save(data, { ...common, kind: "id", idType: " Passport ", idNumber: " P1 ", photo: JPEG });
  assert.deepEqual(id, { ...base(id.id), brand: undefined, kind: "id", idType: "Passport", idNumber: "P1", photo: JPEG });
  const edited = save(data, { ...common, id: id.id, kind: "id", idType: "UMID" });
  assert.deepEqual([edited.idType, edited.idNumber, edited.photo], ["UMID", "P1", JPEG]);
});

test("link: the type defaults to web; an unknown newer one is kept only while the edit leaves it", () => {
  const data = vault();
  const link = save(data, { ...common, kind: "link", location: " C:/Mock " });
  assert.deepEqual(link, { ...base(link.id), kind: "link", linkType: "web", location: "C:/Mock" });
  data.entries = data.entries.map((e) => ({ ...e, linkType: "sharepoint" }));
  assert.equal(save(data, { ...common, id: link.id, kind: "link", linkType: "sharepoint" }).linkType, "sharepoint");
  assert.equal(save(data, { ...common, kind: "link", title: "Mock other", linkType: "sharepoint" }).linkType, "web");
});

test("a kind change starts the new kind fresh, keeping the id and last use", () => {
  const data = vault();
  const note = save(data, { ...common, kind: "note", body: "secret" });
  data.entries = data.entries.map((e) => ({ ...e, lastUsedAt: 5 }));
  const key = save(data, { ...common, id: note.id, kind: "key" });
  assert.deepEqual(key, { ...base(note.id, { lastUsedAt: 5 }), kind: "key", keyId: "", secret: "", url: "", expires: undefined });
});

test("a key secret keeps one trailing newline (OpenSSH can refuse a private key without it); the rest is still trimmed", () => {
  const data = vault();
  const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nbW9jaw==\n-----END OPENSSH PRIVATE KEY-----";
  const saved = (secret) => save(data, { ...common, kind: "key", secret }).secret;
  assert.equal(saved(`${pem}\n`), `${pem}\n`);
  assert.equal(saved(`  ${pem}\r\n\n  `), `${pem}\n`, "leading space and extra blank lines go, one newline stays");
  assert.equal(saved(`  ${pem}  `), pem);
  assert.equal(saved(" s1 "), "s1");
});
