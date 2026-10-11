import { test } from "node:test";
import assert from "node:assert/strict";
import { isConflictCopy, reviewReasons, syncChanges, REVIEW_LIMITS } from "./review.js";

const login = (id, over = {}) => ({ id, kind: "login", spaceId: "s", title: `Mock ${id}`, password: "pw", ...over });

test("a conflict copy is known by the title merge gives it", () => {
  assert.equal(isConflictCopy("Mock Portal (conflict copy, Mock Phone, 2026-09-27)"), true);
  assert.equal(isConflictCopy("Mock Portal (changed after closing, MOCK-DESKTOP, 2026-09-27)"), true);
  assert.equal(isConflictCopy("Mama (conflict copy, Mock Phone (work), 2026-09-27)"), true);
  for (const plain of ["Mock Portal", "Mock Portal (conflict copy)", "Notes (conflict copy, 2026-09-27)", "Mock (conflict copy, Phone, 2026-09-27) edited"]) assert.equal(isConflictCopy(plain), false, plain);
});

test("what a sync would change: added, changed, deleted, conflict copies and secret changes, by id", () => {
  const kept = login("kept");
  const touched = login("touched");
  const before = { entries: [kept, touched, login("renamed"), login("repassworded"), login("deleted")] };
  const after = {
    entries: [
      kept,
      { ...touched, lastUsedAt: 5 }, // a use is not a change
      login("renamed", { title: "Mock title changed" }),
      login("repassworded", { password: "new" }),
      login("new"),
      login("copy", { title: "Mock kept (conflict copy, Mock Phone, 2026-09-27)" }),
    ],
  };
  assert.deepEqual(syncChanges(before, after), { added: ["new"], changed: ["renamed", "repassworded"], deleted: ["deleted"], trashed: [], copies: ["copy"], secretItems: 1 });
  assert.deepEqual(syncChanges(before, before), { added: [], changed: [], deleted: [], trashed: [], copies: [], secretItems: 0 });
});

test("the gate: more than 5 deletes, or more than 10% of items when that is 3 or more, more than 20 secret changes, a new epoch or key", () => {
  const changes = (deleted, secretItems = 0) => ({ added: [], changed: [], copies: [], trashed: [], deleted: Array.from({ length: deleted }, (_, i) => `d${i}`), secretItems });
  assert.deepEqual(REVIEW_LIMITS, { deletes: 5, deleteShare: 0.1, deleteShareMin: 3, secretItems: 20 });
  assert.deepEqual(reviewReasons(changes(5), 500), []);
  assert.deepEqual(reviewReasons(changes(6), 500), ["deletes"]);
  assert.deepEqual(reviewReasons(changes(1), 2), [], "one delete never waits, whatever share of the vault it is");
  assert.deepEqual(reviewReasons(changes(2), 5), [], "two deletes are under the 3 a share needs");
  assert.deepEqual(reviewReasons(changes(3), 30), [], "exactly 10% is not more than 10%");
  assert.deepEqual(reviewReasons(changes(3), 29), ["deletes"]);
  assert.deepEqual(reviewReasons(changes(0, 20), 500), []);
  assert.deepEqual(reviewReasons(changes(0, 21), 500), ["secrets"]);
  assert.deepEqual(reviewReasons(changes(0), 500, { epoch: true, key: true }), ["epoch", "key"]);
  assert.deepEqual(reviewReasons(changes(0), 500, { removed: true }), ["removed"], "this device removed from sync by another");
});
