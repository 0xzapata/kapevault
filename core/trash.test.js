import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cleanVault } from "./clean-vault.js";
import { findIssues } from "./password-health.js";
import { publicView } from "./public-view.js";
import { confirmGone, followUpsDue, setLifecycle } from "./lifecycle.js";
import { isTrashed, moveEntry, toggleFavorite, touchEntry, upsertEntry } from "./entries.js";
import { TRASH_DAYS, deleteForever, emptyTrash, hasExpiredTrash, liveEntries, purgeTrash, restoreEntry, trashDaysLeft, trashEntry } from "./trash.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 4, 4);
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function vault() {
  const data = { spaces: [{ id: "s", name: "Personal", kind: "personal" }], entries: [] };
  const add = (input) => upsertEntry(data, { spaceId: "s", ...input });
  return { data, add };
}

test("trashing stamps the time and keeps the item whole; restoring takes the stamp away", () => {
  const { data, add } = vault();
  const id = add({ kind: "login", title: "Mock Bank", password: "mock-pass" });
  assert.equal(trashEntry(data, id, NOW), true);
  const trashed = data.entries[0];
  assert.equal(trashed.trashedAt, new Date(NOW).toISOString());
  assert.equal(trashed.password, "mock-pass", "nothing is wiped on the way to the Trash");
  assert.equal(isTrashed(trashed), true);
  assert.equal(trashEntry(data, id, NOW + DAY), true);
  assert.equal(data.entries[0].trashedAt, trashed.trashedAt, "trashing twice keeps the first time");

  restoreEntry(data, id);
  assert.equal(isTrashed(data.entries[0]), false);
  assert.equal("trashedAt" in data.entries[0] && data.entries[0].trashedAt !== undefined, false);
  assert.throws(() => restoreEntry(data, id), /not in the Trash/);
  assert.throws(() => trashEntry(data, "nope"), /Item not found/);
});

test("an item in the Trash is hidden from the list, and shown in the Trash list", () => {
  const { data, add } = vault();
  const keep = add({ kind: "note", title: "Mock keep", body: "x" });
  const drop = add({ kind: "note", title: "Mock drop", body: "x" });
  trashEntry(data, drop, NOW);
  assert.deepEqual(liveEntries(data.entries).map((e) => e.id), [keep]);
  const view = publicView(data, new Map());
  assert.deepEqual(view.entries.map((e) => e.id), [keep]);
  assert.deepEqual(view.trash.map((e) => [e.id, e.trashedAt]), [[drop, new Date(NOW).toISOString()]]);
  assert.equal(JSON.stringify(view).includes("\"body\""), false);
});

test("an item in the Trash is no health issue and no reuse; a login that signed in through it reads as unlinked", () => {
  const { data, add } = vault();
  const a = add({ kind: "login", title: "Mock A", password: "same-mock-pass-1" });
  const b = add({ kind: "login", title: "Mock B", password: "same-mock-pass-1" });
  assert.equal(findIssues(data.entries, "2026-10-04", sha256).get(a)?.[0].type, "reused");
  trashEntry(data, b, NOW);
  assert.equal(findIssues(data.entries, "2026-10-04", sha256).get(a)?.some((i) => i.type === "reused") ?? false, false);
  assert.equal(findIssues(data.entries, "2026-10-04", sha256).has(b), false);

  const google = add({ kind: "login", title: "Mock Google", password: "g-mock-pass-9" });
  const app = add({ kind: "login", title: "Mock App", signIn: "google", viaEntryId: google });
  trashEntry(data, google, NOW);
  assert.equal(publicView(data, new Map()).entries.find((e) => e.id === app).viaEntryId, undefined);
  restoreEntry(data, google);
  assert.equal(publicView(data, new Map()).entries.find((e) => e.id === app).viaEntryId, google, "the link was never lost");
});

test("an item in the Trash is read only until it is restored, and is not counted as used or due", () => {
  const { data, add } = vault();
  const id = add({ kind: "login", title: "Mock Bank", password: "mock-pass-3" });
  setLifecycle(data, id, "deletion-requested");
  data.entries = data.entries.map((e) => ({ ...e, lifecycle: { ...e.lifecycle, followUpAt: "2026-01-01" } }));
  assert.equal(followUpsDue(data), 1);
  trashEntry(data, id, NOW);
  assert.equal(followUpsDue(data), 0, "the tray count leaves the Trash out");
  assert.equal(touchEntry(data, id), false);
  assert.throws(() => toggleFavorite(data, id), /in the Trash/);
  assert.throws(() => moveEntry(data, id, "s"), /in the Trash/);
  assert.throws(() => upsertEntry(data, { id, kind: "login", spaceId: "s", title: "Mock Bank" }), /in the Trash/);
  assert.throws(() => setLifecycle(data, id, null), /in the Trash/);
});

test("a closed account's tombstone is deleted outright, never trashed", () => {
  const { data, add } = vault();
  const id = add({ kind: "login", title: "Mock Old", password: "mock-pass-4" });
  confirmGone(data, id, false);
  assert.equal(trashEntry(data, id, NOW), false);
  assert.equal(data.entries.length, 0);
});

test("delete now and empty Trash only touch what is in the Trash", () => {
  const { data, add } = vault();
  const live = add({ kind: "note", title: "Mock live", body: "x" });
  const one = add({ kind: "note", title: "Mock one", body: "x" });
  const two = add({ kind: "note", title: "Mock two", body: "x" });
  const via = add({ kind: "login", title: "Mock via", signIn: "google", viaEntryId: one });
  assert.throws(() => deleteForever(data, live), /not in the Trash/);
  trashEntry(data, one, NOW);
  trashEntry(data, two, NOW);
  deleteForever(data, one);
  assert.deepEqual(data.entries.map((e) => e.id).sort(), [live, two, via].sort());
  assert.equal(data.entries.find((e) => e.id === via).viaEntryId, undefined, "a sign-in link to a deleted item is dropped");
  assert.equal(emptyTrash(data), 1);
  assert.deepEqual(data.entries.map((e) => e.id).sort(), [live, via].sort());
  assert.equal(emptyTrash(data), 0);
});

test("the Trash lets go after 30 days: days left count down, purge deletes exactly the expired", () => {
  const { data, add } = vault();
  const fresh = add({ kind: "note", title: "Mock fresh", body: "x" });
  const old = add({ kind: "note", title: "Mock old", body: "x" });
  const edge = add({ kind: "note", title: "Mock edge", body: "x" });
  trashEntry(data, fresh, NOW - 29 * DAY);
  trashEntry(data, old, NOW - 31 * DAY);
  trashEntry(data, edge, NOW - TRASH_DAYS * DAY);
  const by = (id) => data.entries.find((e) => e.id === id);
  assert.equal(trashDaysLeft(by(fresh), NOW), 1);
  assert.equal(trashDaysLeft(by(old), NOW), 0);
  assert.equal(trashDaysLeft({ trashedAt: new Date(NOW).toISOString() }, NOW), 30);
  assert.equal(trashDaysLeft({ trashedAt: new Date(NOW + 9 * DAY).toISOString() }, NOW), 30, "a clock set ahead never shows more than 30");
  assert.equal(hasExpiredTrash(data, NOW), true);
  assert.equal(purgeTrash(data, NOW), 2);
  assert.deepEqual(data.entries.map((e) => e.id), [fresh]);
  assert.equal(hasExpiredTrash(data, NOW), false);
  assert.equal(purgeTrash(data, NOW), 0);
});

test("a trashedAt that does not parse is kept, never purged", () => {
  const { data } = vault();
  data.entries = [{ id: "x", spaceId: "s", kind: "note", title: "Mock odd", trashedAt: "last tuesday" }];
  assert.equal(purgeTrash(data, NOW + 400 * DAY), 0);
  assert.equal(trashDaysLeft(data.entries[0], NOW), 30);
});

test("a vault read back keeps trashedAt; a wrong type is dropped and an unknown field rides along", () => {
  const read = cleanVault({
    spaces: [{ id: "s", name: "Personal", kind: "personal" }],
    entries: [
      { id: "a", spaceId: "s", kind: "note", title: "Mock a", body: "x", trashedAt: "2026-10-01T00:00:00.000Z", newerField: 1 },
      { id: "b", spaceId: "s", kind: "note", title: "Mock b", body: "x", trashedAt: 12 },
    ],
  });
  assert.equal(read.entries[0].trashedAt, "2026-10-01T00:00:00.000Z");
  assert.equal(read.entries[0].newerField, 1);
  assert.equal("trashedAt" in read.entries[1], false);
});

test("the view carries each trashed item's days left, read against its sync stamp: a device whose clock was months behind still shows the full stay", () => {
  const { data, add } = vault();
  const id = add({ kind: "note", title: "Mock behind", body: "x" });
  const plain = add({ kind: "note", title: "Mock plain", body: "x" });
  trashEntry(data, id, NOW - 90 * DAY); // that device's clock said three months ago
  trashEntry(data, plain, NOW - 29 * DAY);
  data.sync = { meta: { [id]: { g: { trash: { at: [NOW - DAY, 0, "device"] } } } } }; // the stamp never trails what the device had synced
  const days = Object.fromEntries(publicView(data, new Map(), NOW).trash.map((e) => [e.id, e.daysLeft]));
  assert.deepEqual(days, { [id]: 29, [plain]: 1 });
  assert.equal(trashDaysLeft(data.entries[0], NOW), 0, "without the vault it reads as already gone");
});
