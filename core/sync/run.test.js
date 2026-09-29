import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readCopyTitle } from "./review.js";
import { logEntry, mergeRemotes, nameOf, reviewView, withEntry } from "./run.js";
import { newEpoch, newSync, registerDevice } from "./shape.js";

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const SALT = "AAAAAAAAAAAAAAAAAAAAAA==";
const NOW = Date.UTC(2026, 8, 29);
const ME = { installId: "11111111-1111-4111-8111-111111111111", device: { name: "Mock PC", platform: "win32" }, now: NOW, sha256 };
const PHONE = "22222222-2222-4222-8222-222222222222";

function vault(spaceId = "33333333-3333-4333-8333-333333333333") {
  const data = { spaces: [{ id: spaceId, name: "Personal", kind: "personal" }], entries: [] };
  const sync = registerDevice(newSync(data, SALT), { installId: PHONE, name: "Mock Phone", platform: "android", now: NOW - 1000 });
  return { ...data, sync };
}
const remote = (data) => ({ device: PHONE, key: "k", data, salt: SALT });

test("a conflict copy's title reads back as the title, the device and the day", () => {
  assert.deepEqual(readCopyTitle("Mock Portal (conflict copy, Mock Phone (work), 2026-09-27)"), { title: "Mock Portal", device: "Mock Phone (work)", day: "2026-09-27" });
  assert.deepEqual(readCopyTitle("Mama (changed after closing, Mock PC, 2026-09-27) (check this number)"), { title: "Mama", device: "Mock PC", day: "2026-09-27" });
  assert.equal(readCopyTitle("Mock Portal"), null);
});

test("a remote merges in, and this install joins the device list on the first run", () => {
  const local = vault();
  const theirs = { ...local, entries: [{ id: "e1", spaceId: local.spaces[0].id, kind: "note", title: "Mock note", body: "b" }] };
  const result = mergeRemotes(local, [remote(theirs)], ME);
  assert.deepEqual(result.problems, []);
  assert.equal(result.epoch, false);
  assert.deepEqual(result.merged.map((r) => r.name), ["Mock Phone"]);
  assert.deepEqual(result.data.entries.map((e) => e.id), ["e1"]);
  assert.equal(result.data.sync.devices[ME.installId].name, "Mock PC");
  const again = mergeRemotes(result.data, [], ME);
  assert.equal(again.data, result.data, "an install already listed writes nothing");
});

test("a remote that cannot be merged is left out and named: clock ahead, another vault, an older restore", () => {
  const local = vault();
  const ahead = { ...local, sync: { ...local.sync, clock: [NOW + 3 * 86_400_000, 0, PHONE] } };
  const other = vault("44444444-4444-4444-8444-444444444444");
  const older = { ...local, sync: { ...local.sync, epoch: { id: "00000000-0000-4000-8000-000000000000", at: [0, 0, ""] } } };
  const result = mergeRemotes(local, [remote(ahead), remote(other), remote(older)], ME);
  assert.deepEqual(result.problems, [
    "Mock Phone's clock is 3 days ahead. Fix its date, then Sync now.",
    "This bucket holds a different vault from Mock Phone.",
    "Mock Phone has not taken the restored vault yet.",
  ]);
  assert.deepEqual(result.merged, []);
});

test("a newer restore from another device is adopted", () => {
  const local = vault();
  const restored = { ...local, sync: newEpoch(local.sync, { id: "66666666-6666-4666-8666-666666666666", installId: PHONE, now: NOW }) };
  const result = mergeRemotes(local, [remote(restored)], ME);
  assert.equal(result.epoch, true);
  assert.equal(result.data.sync.epoch.id, "66666666-6666-4666-8666-666666666666");
});

test("the sync log: newest first, a quiet run replaces the quiet run before it, at most 50", () => {
  const quiet = logEntry(1, { remotes: [{ device: "a" }], upToDate: ["b"] }, {});
  assert.deepEqual(quiet, { at: 1, with: ["a", "b"] });
  const busy = logEntry(2, { remotes: [], upToDate: ["a", "b"] }, { added: 1 });
  assert.deepEqual(withEntry([quiet], { ...quiet, at: 3 }), [{ ...quiet, at: 3 }]);
  assert.deepEqual(withEntry([busy], { ...quiet, at: 3 }), [{ ...quiet, at: 3 }, busy]);
  assert.equal(withEntry([{ at: 0, renewedId: true, with: [] }], { at: 1, with: [] }).length, 2, "a renewed install id stays in the log");
  const full = Array.from({ length: 50 }, (_, i) => ({ at: i, with: [String(i)], added: 1 }));
  assert.equal(withEntry(full, quiet).length, 50);
  assert.equal(withEntry(undefined, quiet).length, 1);
});

test("a review names the devices and the items by title; a deleted item by its title before", () => {
  const before = { entries: [{ id: "gone", title: "Mock gone" }, { id: "kept", title: "Mock old" }] };
  const result = { data: { entries: [{ id: "kept", title: "Mock kept" }, { id: "new", title: "Mock new" }] }, merged: [{ name: "Mock Phone" }] };
  const changes = { added: ["new"], changed: ["kept"], deleted: ["gone"], copies: [], secretItems: 1 };
  assert.deepEqual(reviewView(before, result, changes, ["deletes"]), { from: ["Mock Phone"], reasons: ["deletes"], added: ["Mock new"], changed: ["Mock kept"], deleted: ["Mock gone"], copies: [], secretItems: 1 });
  assert.equal(nameOf({}, "x"), "Another device");
});
