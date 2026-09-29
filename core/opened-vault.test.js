import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { openedVault } from "./opened-vault.js";

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const SALT = "AAAAAAAAAAAAAAAAAAAAAA==";
const context = { installId: "11111111-1111-4111-8111-111111111111", now: Date.UTC(2026, 8, 29), sha256 };
const space = { id: "22222222-2222-4222-8222-222222222222", name: "Personal", kind: "personal" };

test("a vault from before sync opens with its due dates as notes, a new sync object and the salt marked", () => {
  const data = { spaces: [space], entries: [{ id: "d1", spaceId: space.id, kind: "due", title: "Mock bill", agency: "other" }], cloud: { auto: true } };
  const opened = openedVault(data, SALT, context);
  assert.equal(opened.entries[0].kind, "note");
  assert.equal(opened.keySalt, SALT);
  assert.equal(opened.sync.vaultId, space.id);
  assert.deepEqual(opened.sync.meta, {}, "nothing stamped");
  assert.deepEqual(opened.cloud, { auto: true }, "device-local fields ride along");
  assert.equal(data.entries[0].kind, "due", "the decrypted data is not changed in place");
});

test("an item an app version without sync changed is stamped on open", () => {
  const first = openedVault({ spaces: [space], entries: [] }, SALT, context);
  const later = { ...context, now: context.now + 1000 };
  const note = { id: "n1", spaceId: space.id, kind: "note", title: "Mock", body: "a" };
  const stamped = { ...first, entries: [note], sync: { ...first.sync, meta: { n1: { vv: { [context.installId]: 1 }, g: {}, h: "stale" } } } };
  const reopened = openedVault(stamped, SALT, later);
  assert.notEqual(reopened.sync.meta.n1.h, "stale");
  assert.equal(reopened.sync.meta.n1.vv[context.installId], 2);
});
