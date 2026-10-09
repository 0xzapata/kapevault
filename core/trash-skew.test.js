// The Trash purge under clocks that disagree (SYNC.md, Trash). A purge is a delete that syncs, so it must
// not run on a trashedAt another device wrote with a wrong clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { upsertEntry } from "./entries.js";
import { newSync } from "./sync/shape.js";
import { mergeRemotes } from "./sync/run.js";
import { stamp } from "./sync/stamp.js";
import { hasExpiredTrash, purgeTrash, trashEntry } from "./trash.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 9, 4);
const SALT = "AAAAAAAAAAAAAAAAAAAAAA==";
const PC = "11111111-1111-4111-8111-111111111111";
const PHONE = "22222222-2222-4222-8222-222222222222";
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

// A vault with one note in the Trash. trashedAt: the string the trashing device wrote; stampedAt: the
// time of the sync stamp of that change (the device's hybrid clock, which never trails what it had seen).
function trashed({ trashedAt, stampedAt }) {
  const data = { spaces: [{ id: "s", name: "Personal", kind: "personal" }], entries: [] };
  const id = upsertEntry(data, { spaceId: "s", kind: "note", title: "Mock note", body: "x" });
  trashEntry(data, id, trashedAt);
  const sync = newSync(data, SALT);
  data.sync = stampedAt === undefined ? sync : { ...sync, meta: { [id]: { vv: { [PHONE]: 1 }, g: { trash: { dot: [PHONE, 1], at: [stampedAt, 0, PHONE] } } } } };
  return { data, id };
}

test("the normal 30 days: a trash stamped when it was written goes on day 30 and not before", () => {
  const { data } = trashed({ trashedAt: NOW, stampedAt: NOW });
  assert.equal(purgeTrash(data, NOW + 29 * DAY), 0);
  assert.equal(hasExpiredTrash(data, NOW + 29 * DAY), false);
  assert.equal(hasExpiredTrash(data, NOW + 30 * DAY), true);
  assert.equal(purgeTrash(data, NOW + 30 * DAY), 1);
  assert.deepEqual(data.entries, []);
});

test("a device whose clock is months behind: its trashedAt says 120 days ago, its sync stamp says when it really was", () => {
  // The phone's hybrid clock never trails what it last synced, so the stamp is the PC's time at that sync (2 days ago).
  const { data } = trashed({ trashedAt: NOW - 120 * DAY, stampedAt: NOW - 2 * DAY });
  assert.equal(hasExpiredTrash(data, NOW), false);
  assert.equal(purgeTrash(data, NOW), 0, "kept: the string alone would have deleted it everywhere");
  assert.equal(data.entries.length, 1);
  assert.equal(purgeTrash(data, NOW + 27 * DAY), 0, "28 days after the stamp");
  assert.equal(purgeTrash(data, NOW + 28 * DAY), 1, "30 days after the stamp it goes");
});

test("a trash with no sync stamp (a vault from before sync) is dated by its trashedAt alone", () => {
  const old = trashed({ trashedAt: NOW - 31 * DAY });
  assert.equal(old.data.sync.meta[old.id], undefined);
  assert.equal(purgeTrash(old.data, NOW), 1);
});

test("a stamp that is earlier than trashedAt never shortens the stay", () => {
  const { data } = trashed({ trashedAt: NOW, stampedAt: NOW - 90 * DAY });
  assert.equal(purgeTrash(data, NOW + 29 * DAY), 0);
  assert.equal(purgeTrash(data, NOW + 30 * DAY), 1);
});

test("a local clock 31 days ahead can delete only on this device: the purge carries that clock, and every other device refuses it", () => {
  const { data, id } = trashed({ trashedAt: NOW, stampedAt: NOW });
  const saved = { ...data };
  const ahead = NOW + 31 * DAY;
  assert.equal(purgeTrash(data, ahead), 1, "nothing on this device can tell a clock jump from 31 quiet days");
  const sync = stamp(saved, data, { installId: PC, now: ahead, sha256 });
  assert.ok(sync.gone[id], "the purge is a tombstone");
  const mine = { ...data, sync };
  // The phone, with a correct clock and the item still in its Trash, is offered this device's snapshot.
  const phone = { ...saved, sync: saved.sync };
  const result = mergeRemotes(phone, [{ device: PC, key: "k", data: mine, salt: SALT }], { installId: PHONE, device: { name: "Mock Phone", platform: "android" }, now: NOW, sha256 });
  assert.match(result.problems[0], /clock is 31 days ahead/);
  assert.equal(result.data.entries.length, 1, "the item is still on the phone");
});
