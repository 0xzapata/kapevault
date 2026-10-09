import test from "node:test";
import assert from "node:assert/strict";
import { payeeToNotes } from "./payee-to-note.js";

const login = { id: "mock-login", spaceId: "mock-space", kind: "login", title: "Mock GCash login", username: "mock@example.com", password: "Mock-pw-1" };

test("a full payee becomes a note that keeps every field in its body, then its notes", () => {
  const payee = {
    id: "mock-payee",
    spaceId: "mock-space",
    kind: "payee",
    title: "Mock Tita Rosa GCash",
    tags: ["family"],
    favorite: true,
    notes: "Sends rent on the 5th",
    updatedAt: "2026-09-20",
    lastUsedAt: 1790000000000,
    heldFor: "Mama",
    who: "Mock Tita Rosa",
    relation: "Aunt",
    provider: "GCash",
    number: "09171234567",
    accountName: "MO** T*** R.",
    confirmedAt: "2026-09-12",
  };
  const [note, untouched] = payeeToNotes([payee, login]);
  assert.deepEqual(note, {
    id: "mock-payee",
    spaceId: "mock-space",
    kind: "note",
    title: "Mock Tita Rosa GCash",
    tags: ["family"],
    favorite: true,
    notes: "",
    updatedAt: "2026-09-20",
    lastUsedAt: 1790000000000,
    heldFor: "Mama",
    body: ["Name: Mock Tita Rosa", "Relation: Aunt", "Wallet or bank: GCash", "Number: 09171234567", "Account name: MO** T*** R.", "Confirmed: 2026-09-12", "", "Sends rent on the 5th"].join("\n"),
  });
  assert.equal(untouched, login, "the login is untouched");
});

test("a payee with empty fields becomes a note with only what it had", () => {
  const [note] = payeeToNotes([{ id: "mock-min", spaceId: "mock-space", kind: "payee", title: "Mock", who: "Mock Lola", relation: "", provider: "BDO", number: "001234567890", accountName: "   " }]);
  assert.equal(note.body, "Name: Mock Lola\nWallet or bank: BDO\nNumber: 001234567890");
  assert.equal(note.notes, "");
  const [bare] = payeeToNotes([{ kind: "payee", title: "Mock bare" }]);
  assert.deepEqual(bare, { kind: "note", title: "Mock bare", notes: "", body: "" });
});

test("a trashed payee stays in the Trash as a note", () => {
  const [note] = payeeToNotes([{ id: "mock-gone", kind: "payee", title: "Mock", trashedAt: "2026-10-01", who: "Mock Tito", provider: "Maya", number: "09281112222" }]);
  assert.equal(note.kind, "note");
  assert.equal(note.trashedAt, "2026-10-01");
  assert.equal(note.body, "Name: Mock Tito\nWallet or bank: Maya\nNumber: 09281112222");
});

test("a field of the wrong type is left out of the body, never guessed at", () => {
  const [note] = payeeToNotes([{ kind: "payee", title: "Mock", who: "Mock Tito", provider: { name: "GCash" }, number: 9171234567, accountName: ["x"], confirmedAt: 5, notes: 7 }]);
  assert.equal(note.body, "Name: Mock Tito");
});

test("anything that is not a payee passes through, and converting twice is converting once", () => {
  const others = [login, { id: "mock-note", kind: "note", title: "Mock", body: "Number: 1" }, null, "odd", { kind: "fromTheFuture", who: "x" }];
  const converted = payeeToNotes(others);
  assert.deepEqual(converted, others);
  for (const [i, e] of converted.entries()) assert.equal(e, others[i], "the same object");
  const once = payeeToNotes([{ kind: "payee", title: "Mock", who: "Mock Tito", provider: "GCash", number: "09171234567" }]);
  assert.deepEqual(payeeToNotes(once), once);
});
