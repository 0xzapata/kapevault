import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { openedVault } from "./opened-vault.js";
import { splitGroups } from "./sync/groups.js";
import { merge } from "./sync/merge.js";
import { contentHash, stamp } from "./sync/stamp.js";

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const SALT = "AAAAAAAAAAAAAAAAAAAAAA==";
const context = { installId: "11111111-1111-4111-8111-111111111111", now: Date.UTC(2026, 8, 29), sha256 };
const contentHashOf = (entry) => contentHash(splitGroups(entry), sha256);
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

test("a payee opens as a note, and the conversion is not stamped as an edit when the payee was already synced", () => {
  const payee = { id: "p1", spaceId: space.id, kind: "payee", title: "Mock Tita", who: "Mock Tita", provider: "GCash", number: "09171234567" };
  const first = openedVault({ spaces: [space], entries: [] }, SALT, context);
  const synced = { ...first, entries: [payee], sync: { ...first.sync, meta: { p1: { vv: { [context.installId]: 1 }, g: {}, h: contentHashOf(payee) } } } };
  const opened = openedVault(synced, SALT, { ...context, now: context.now + 1000 });
  assert.deepEqual([opened.entries[0].kind, opened.entries[0].body], ["note", "Name: Mock Tita\nWallet or bank: GCash\nNumber: 09171234567"]);
  assert.deepEqual(opened.sync.meta.p1.vv, { [context.installId]: 1 }, "no new version: a purge made elsewhere must stay purged");
  assert.deepEqual(opened.sync.meta.p1.g, {});
  assert.equal(opened.sync.meta.p1.h, contentHashOf(opened.entries[0]), "the hash follows the converted note, so repair() finds nothing");
  assert.equal(synced.entries[0].kind, "payee", "the decrypted data is not changed in place");
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

test("every opened vault carries minReader, the reader version a future file will name", () => {
  assert.equal(openedVault({ spaces: [space], entries: [] }, SALT, context).minReader, 1);
  assert.equal(openedVault({ spaces: [space], entries: [], minReader: 1 }, SALT, context).minReader, 1);
});

test("a vault from a newer version is refused, never opened with a reset sync object", () => {
  const first = openedVault({ spaces: [space], entries: [] }, SALT, context);
  const tombstone = { "gone-1": { vv: { [context.installId]: 1 }, at: [5, 0, context.installId] } };
  for (const newer of [{ ...first, sync: { ...first.sync, v: 2, gone: tombstone } }, { ...first, minReader: 2 }]) {
    const before = JSON.stringify(newer);
    assert.throws(() => openedVault(newer, SALT, context), (e) => e.name === "NewerVaultError" && /newer KAPEVault/.test(e.message));
    assert.equal(JSON.stringify(newer), before, "nothing in the decrypted data is changed");
  }
});

const deviceB = { ...context, installId: "33333333-3333-4333-8333-333333333333" };

// Two devices hold the same synced legacy payee (built before payees became notes).
function syncedPayee() {
  const payee = { id: "p1", spaceId: space.id, kind: "payee", title: "Mock Tita", who: "Mock Tita", provider: "GCash", number: "09171234567" };
  const first = openedVault({ spaces: [space], entries: [] }, SALT, context);
  return { ...first, entries: [payee], sync: { ...first.sync, meta: { p1: { vv: { [context.installId]: 1 }, g: {}, h: contentHashOf(payee) } } } };
}

test("a purge made on another device before this one opened a legacy payee stays purged after the merge", () => {
  const synced = syncedPayee();
  // Device A (current build) opens, trashes and purges the converted note.
  const onA = openedVault(synced, SALT, { ...context, now: context.now + 1000 });
  const trashed = { ...onA, entries: onA.entries.map((e) => ({ ...e, trashedAt: "2026-09-29T00:00:00.000Z" })) };
  const afterTrash = { ...trashed, sync: stamp(onA, trashed, { ...context, now: context.now + 2000 }) };
  const purged = { ...afterTrash, entries: [] };
  const afterPurge = { ...purged, sync: stamp(afterTrash, purged, { ...context, now: context.now + 3000 }) };
  assert.ok(afterPurge.sync.gone.p1, "the purge is a tombstone");
  // Device B opens the old vault under the current build, then the two merge.
  const onB = openedVault(synced, SALT, { ...deviceB, now: context.now + 4000 });
  for (const [x, y] of [[onB, afterPurge], [afterPurge, onB]]) {
    assert.deepEqual(merge(x, y, { sha256 }).data.entries, [], "the purged note must not come back");
  }
});

test("on-open migrations never stamp a fresh edit: payee and due conversions keep their versions, tombstones and floors", () => {
  const first = openedVault({ spaces: [space], entries: [] }, SALT, context);
  const payee = { id: "p1", spaceId: space.id, kind: "payee", title: "Mock Tita", who: "Mock Tita", provider: "GCash", number: "09171234567" };
  const due = { id: "d1", spaceId: space.id, kind: "due", title: "Mock bill", agency: "other", schedule: { every: "once" } };
  const vv = { [context.installId]: 3 };
  const meta = Object.fromEntries([payee, due].map((e) => [e.id, { vv, g: {}, h: contentHashOf(e) }]));
  const opened = openedVault({ ...first, entries: [payee, due], sync: { ...first.sync, meta } }, SALT, { ...context, now: context.now + 1000 });
  assert.deepEqual(opened.entries.map((e) => e.kind), ["note", "note"]);
  for (const id of ["p1", "d1"]) {
    assert.deepEqual(opened.sync.meta[id].vv, vv, `${id} keeps its version`);
    assert.deepEqual(opened.sync.meta[id].g, {}, `${id} gains no stamped group`);
    assert.equal(opened.sync.meta[id].h, contentHashOf(opened.entries.find((e) => e.id === id)));
  }
  assert.deepEqual(opened.sync.gone, {});
  assert.deepEqual(opened.sync.histFloor, {});
  assert.deepEqual(opened.sync.clock, first.sync.clock, "the clock did not tick");
});
