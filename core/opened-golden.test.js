// The frozen vaults (core/fixtures/README.md) through openedVault: repair, due-to-note and the sync object
// on data that real older writers produced. The decrypted JSON is the expected file beside each vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openedVault } from "./opened-vault.js";
import { cleanVault } from "./clean-vault.js";
import { findEntry } from "./entries.js";

const DIR = path.join(import.meta.dirname, "fixtures");
const read = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
const header = (name) => read(name).kdf.salt;
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const context = { installId: "11111111-1111-4111-8111-111111111111", now: Date.UTC(2026, 9, 9), sha256 };

test("a vault from before sync gets its sync object, its salt marked and minReader", () => {
  const data = cleanVault(read("bovault-pre-rename.expected.json"));
  assert.equal(data.sync, undefined);
  const opened = openedVault(data, header("bovault-pre-rename.bovault"), context);
  assert.equal(opened.sync.v, 1);
  assert.equal(opened.sync.vaultId, data.spaces[0].id);
  assert.equal(opened.sync.keys[0].salt, header("bovault-pre-rename.bovault"));
  assert.equal(opened.keySalt, header("bovault-pre-rename.bovault"));
  assert.equal(opened.minReader, 1);
  assert.deepEqual(opened.entries.map((e) => e.title), data.entries.map((e) => e.title));
});

test("a vault with a due item opens it as a note, receipts kept in the text", () => {
  const data = cleanVault(read("vault-pre-sync-due.expected.json"));
  const due = data.entries.find((e) => e.kind === "due");
  assert.ok(due, "the file really holds a due item");
  const opened = openedVault(data, header("vault-pre-sync-due.kapevault"), context);
  assert.equal(opened.entries.some((e) => e.kind === "due"), false);
  const note = findEntry(opened, due.id);
  assert.equal(note.kind, "note");
  assert.match(note.body, /MOCK-REF-1/);
  assert.equal(opened.sync.vaultId, data.spaces[0].id);
});

test("the current vault opens with its payee as a note: every other item and stamp survives, and the Trash item stays in the Trash", () => {
  const data = cleanVault(read("vault-v1.expected.json"));
  const payee = data.entries.find((e) => e.kind === "payee");
  assert.ok(payee, "the file really holds a payee");
  const opened = openedVault(data, header("vault-v1.kapevault"), context);
  assert.deepEqual(findEntry(opened, payee.id), {
    id: payee.id,
    spaceId: payee.spaceId,
    title: "Mock Payee",
    tags: [],
    favorite: false,
    notes: "",
    updatedAt: "2026-10-09",
    kind: "note",
    body: "Name: Mock Person\nWallet or bank: GCash\nNumber: 09171234567",
  });
  assert.equal(opened.entries.some((e) => e.kind === "payee"), false);
  assert.deepEqual(opened.entries.filter((e) => e.id !== payee.id), data.entries.filter((e) => e.id !== payee.id), "no other item changes");
  const { [payee.id]: was, ...otherStamps } = data.sync.meta;
  const { [payee.id]: now, ...otherStampsNow } = opened.sync.meta;
  assert.deepEqual(otherStampsNow, otherStamps, "no other stamp changes");
  assert.equal(now.vv[context.installId], 1, "the conversion is this device's edit, so it reaches the other devices");
  assert.ok(now.g.body, "the body is a stamped group");
  assert.equal(opened.entries.filter((e) => e.trashedAt).length, 1);
});
