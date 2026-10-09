import test from "node:test";
import assert from "node:assert/strict";
import { importEntries } from "./import.js";
import { trashEntry } from "./trash.js";

function vault() {
  return { spaces: [{ id: "p", name: "Personal", kind: "personal" }], entries: [] };
}

const login = (over = {}) => ({ kind: "login", title: "Mock Mail", username: "mock.user@example.com", password: "mock-pass-1", url: "https://mail.example.com", ...over });

test("the same item twice is a duplicate and adds nothing", () => {
  const data = vault();
  assert.deepEqual(importEntries(data, [login()]), { added: 1, skipped: 0 });
  assert.deepEqual(importEntries(data, [login({ title: "mock mail" })]), { added: 0, skipped: 1 });
  assert.equal(data.entries.length, 1);
});

test("the same title with another username, password, url or 2FA key is another item", () => {
  const data = vault();
  importEntries(data, [login()]);
  const others = [{ username: "second.user@example.com" }, { password: "mock-pass-2" }, { url: "https://other.example.com" }, { totp: "JBSWY3DPEHPK3PXP" }, { notes: "work account" }];
  for (const over of others) assert.equal(importEntries(data, [login(over)]).added, 1, JSON.stringify(Object.keys(over)));
  assert.equal(data.entries.length, 1 + others.length);
});

test("an item in the Trash is not in the vault: importing it again adds a live copy", () => {
  const data = vault();
  importEntries(data, [login()]);
  trashEntry(data, data.entries[0].id);
  assert.deepEqual(importEntries(data, [login()]), { added: 1, skipped: 0 });
  assert.equal(data.entries.filter((e) => !e.trashedAt).length, 1);
});

test("a closed account's tombstone never blocks the same item", () => {
  const data = vault();
  importEntries(data, [login()]);
  data.entries = data.entries.map((e) => ({ ...e, lifecycle: { state: "gone" } }));
  assert.equal(importEntries(data, [login()]).added, 1);
});

// One item per kind whose secret or identifying field is changed in turn: each change is a new item.
const KIND_CASES = [
  [{ kind: "note", title: "Mock Note", body: "mock text" }, { body: "other text" }],
  [{ kind: "key", title: "Mock Key", keyId: "key-1", secret: "mock-secret-1", url: "https://api.example.com" }, { secret: "mock-secret-2" }],
  [{ kind: "key", title: "Mock Key", keyId: "key-1", secret: "mock-secret-1" }, { keyId: "key-2" }],
  [{ kind: "link", title: "Mock Link", linkType: "web", location: "https://a.example.com" }, { location: "https://b.example.com" }],
  [{ kind: "thing", title: "Mock Passport", spot: "top drawer", room: "bedroom" }, { spot: "safe" }],
  [{ kind: "device", title: "Mock Router", type: "router", adminPassword: "admin-1", wifiPassword: "wifi-1", serial: "SN1" }, { wifiPassword: "wifi-2" }],
  [{ kind: "device", title: "Mock Router", type: "router", adminPassword: "admin-1", wifiPassword: "wifi-1" }, { adminPassword: "admin-2" }],
  [{ kind: "id", title: "Mock ID", idType: "Passport", idNumber: "P1234567" }, { idNumber: "P7654321" }],
];

test("every kind compares its own secret and identifying fields", () => {
  for (const [first, change] of KIND_CASES) {
    const data = vault();
    importEntries(data, [first]);
    assert.equal(importEntries(data, [{ ...first }]).added, 0, `${first.kind}: the same item`);
    assert.equal(importEntries(data, [{ ...first, ...change }]).added, 1, `${first.kind}: ${Object.keys(change)}`);
  }
});

test("a value that is cleaned on save still matches itself on the next import", () => {
  const data = vault();
  const device = { kind: "device", title: "Mock Phone", type: "phone", imei: "35-209900-176148-1" };
  importEntries(data, [device]);
  assert.equal(importEntries(data, [device]).added, 0);
});

test("a payee in an import file comes in as a note, every field in its body, and a second import is a duplicate", () => {
  const data = vault();
  const payee = { kind: "payee", title: "Mock Payee", who: "Mock Person", relation: "Aunt", provider: "Mock Bank", number: "09171234567", accountName: "M. Mock", notes: "rent" };
  assert.deepEqual(importEntries(data, [payee]), { added: 1, skipped: 0 });
  const [note] = data.entries;
  assert.equal(note.kind, "note");
  assert.equal(note.body, "Name: Mock Person\nRelation: Aunt\nWallet or bank: Mock Bank\nNumber: 09171234567\nAccount name: M. Mock\n\nrent");
  assert.deepEqual(importEntries(data, [payee]), { added: 0, skipped: 1 });
});

test("a duplicate inside one file is skipped, a different item with the same title is not", () => {
  const data = vault();
  const result = importEntries(data, [login(), login(), login({ password: "mock-pass-2" })]);
  assert.deepEqual(result, { added: 2, skipped: 1 });
});

test("the same item in another client is not a duplicate", () => {
  const data = vault();
  importEntries(data, [login({ space: "Mock Client A" })]);
  assert.equal(importEntries(data, [login({ space: "Mock Client B" })]).added, 1);
});
