// Regression tests for audit run-1 lead 4: a removed device forging sync.keys. Real stamp/merge code, mock names only.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { carryLockOut } from "./merge.js";
import { mergeRemotes } from "./run.js";
import { reviewReasons, syncChanges } from "./review.js";
import { addKey, newEpoch, revokeDevice } from "./shape.js";
import { compare } from "./hlc.js";
import { DEVICES, firstSync } from "./test-helpers.js";
import { upsertEntry } from "../entries.js";

const T0 = Date.UTC(2026, 8, 1, 2);
let uuids = 0;
mock.timers.enable({ apis: ["Date"], now: T0 });
mock.method(globalThis.crypto, "randomUUID", () => `id-${++uuids}`);

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const PERSONAL = "space-personal";
function devices(count, fill) {
  const vault = { spaces: [{ id: PERSONAL, name: "Personal", kind: "personal" }], entries: [] };
  fill(vault);
  const base = { ...vault, sync: firstSync(vault) };
  return DEVICES.slice(0, count).map((spec) => ({ ...spec, data: { ...base } }));
}
const bank = (data) => {
  upsertEntry(data, { kind: "login", title: "Mock Bank", spaceId: PERSONAL, username: "mock.user", password: "old-pass" });
};

// --- lead 4: a removed device forges sync.keys ---------------------------------------------------------

const OLD = "AAAAAAAAAAAAAAAAAAAAAA==";
const NEW = "BBBBBBBBBBBBBBBBBBBBBB==";
const FAKE = "ZZZZZZZZZZZZZZZZZZZZZZ==";
const ME = { installId: "dev-a", device: { name: "Test PC", platform: "test" }, now: T0 + 10000, sha256 };
// The lockOut filter of electron/sync.cjs status().
const lockOut = (data) => Object.entries(data.sync.devices).filter(([id, d]) => id !== "dev-a" && d.revokedAt && !data.sync.keys.some((k) => compare(k.at, d.revokedAt) > 0)).map(([id]) => id);

function forgery() {
  const [pc] = devices(2, bank);
  const removed = { ...pc.data, sync: revokeDevice(pc.data.sync, { id: "dev-b", installId: "dev-a", now: T0 + 1000 }) };
  const at = [T0 + 5000, 0, "inst-r2"];
  const remoteWith = (keys) => ({ ...pc.data, sync: { ...pc.data.sync, keys, clock: at } });
  const records = pc.data.sync.keys;
  return { removed, remoteWith, records, at };
}
const mergedFrom = (removed, remote, salt = OLD) => mergeRemotes(removed, [{ device: "inst-r2", key: "k", data: remote, salt }], ME);

test("lead 4: a forged new-salt key record does not end the lock-out", () => {
  const { removed, remoteWith, records, at } = forgery();
  assert.deepEqual(lockOut(removed), ["dev-b"]);
  const result = mergedFrom(removed, remoteWith([...records, { salt: FAKE, n: 2, at, by: "inst-r2" }]));
  assert.deepEqual(lockOut(result.data), ["dev-b"], "the card stays");
  assert.deepEqual(result.data.sync.keys.map((k) => k.salt), [OLD]);
  assert.deepEqual(reviewReasons(syncChanges(removed, result.data), removed.entries.length, { epoch: result.epoch, key: false, removed: result.removed }), []);
});

test("lead 4: the current salt re-stamped later does not end the lock-out or flip keepKey", () => {
  const { removed, remoteWith, records, at } = forgery();
  const result = mergedFrom(removed, remoteWith(records.map((k) => ({ ...k, at, by: "inst-r2" }))));
  assert.deepEqual(lockOut(result.data), ["dev-b"]);
  assert.deepEqual(result.data.sync.keys, records);
  const changed = addKey(result.data.sync, { salt: NEW, installId: "dev-a", now: T0 + 20000 });
  assert.equal(carryLockOut(changed, NEW, { ...removed.sync, keys: records }, OLD).keepKey, true, "a restore under the retired key still stays under this vault's key");
  const control = addKey(removed.sync, { salt: NEW, installId: "dev-a", now: T0 + 20000 });
  assert.equal(carryLockOut(control, NEW, { ...removed.sync, keys: records }, OLD).keepKey, true);
});

test("lead 4: a forged record is dropped on an adopted epoch too", () => {
  const { removed, remoteWith, records, at } = forgery();
  const remote = remoteWith([...records, { salt: FAKE, n: 2, at, by: "inst-r2" }]);
  const epoch = { ...remote, sync: newEpoch(remote.sync, { id: "epoch-2", installId: "inst-r2", now: T0 + 6000 }) };
  const result = mergedFrom(removed, epoch);
  assert.equal(result.epoch, true);
  assert.deepEqual(lockOut(result.data), ["dev-b"]);
});

test("lead 4: a real master change on another device still lands, with the older records it holds", () => {
  const { removed, remoteWith, records } = forgery();
  const at = [T0 + 7000, 0, "dev-c"];
  const SIDE = "CCCCCCCCCCCCCCCCCCCCCC==";
  const older = { salt: SIDE, n: 2, at: [T0 + 6000, 0, "dev-c"], by: "dev-c" };
  const result = mergedFrom(removed, remoteWith([...records, older, { salt: NEW, n: 3, at, by: "dev-c" }]), NEW);
  assert.deepEqual(result.data.sync.keys.map((k) => k.salt), [OLD, SIDE, NEW], "the new key is adopted, newest last");
  assert.deepEqual(lockOut(result.data), [], "the master changed after the removal: the lock-out is done");
});

test("lead 4: a re-dated header record with a forged salt slotted under it does not end the lock-out", () => {
  // Round-2 verifier variant: the header (current) salt re-stamped late, a forged salt dated between the
  // removal and it. A snapshot under a salt this vault holds keeps only salts this vault holds.
  const { removed, remoteWith, records } = forgery();
  const late = [T0 + 9000, 0, "inst-r2"];
  const forged = { salt: FAKE, n: 2, at: [T0 + 5000, 0, "inst-r2"], by: "inst-r2" };
  const result = mergedFrom(removed, remoteWith([...records.map((k) => ({ ...k, at: late })), forged]));
  assert.deepEqual(lockOut(result.data), ["dev-b"], "the card stays");
  assert.deepEqual(result.data.sync.keys, records, "the earlier record stands and the forged salt is dropped");
});
