import { test } from "node:test";
import assert from "node:assert/strict";
import { readSnapshotKey, pickSnapshots, snapshotKey, snapshotsToPrune, DEAD_AFTER_MS } from "./snapshots.js";
import { MAX_VAULT_BYTES } from "../vault-format.js";

const ME = "0b8c8e52-1b7e-4d8e-9a53-6f0c1d2e3f40";
const PHONE = "7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const TABLET = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const NOW = Date.parse("2026-09-27T08:00:00Z");
const key = (owner, time, note = "") => `kapevault/snapshots/${owner ? `${owner}/` : ""}${time.replace(/[:.]/g, "-")}${note}.kapevault`;

test("a snapshot key reads back its maker, its name time and what kind it is", () => {
  assert.deepEqual(readSnapshotKey(key(PHONE, "2026-09-25T07:15:02.123Z")), { owner: PHONE, time: Date.parse("2026-09-25T07:15:02.123Z"), beforeRestore: false, legacy: false });
  assert.equal(readSnapshotKey(key(PHONE, "2026-09-25T07:15:02.123Z", "-before-restore")).beforeRestore, true);
  assert.equal(readSnapshotKey(key("", "2026-09-25T07:15:02.123Z")).owner, null);
  assert.equal(readSnapshotKey("bovault/snapshots/2026-09-25T07-15-02-123Z.bovault").legacy, true);
  for (const other of ["kapevault/snapshots/notes.txt", "kapevault/opener/kapevault-opener-1.0.0.html", "bovault/snapshots/2026-09-25T07-15-02-123Z.kapevault"]) assert.equal(readSnapshotKey(other), null, other);
});

test("the newest snapshot is the one R2 stored last, whatever its name says", () => {
  const objects = [
    { key: key(PHONE, "2030-01-01T00:00:00.000Z"), lastModified: NOW - 3 * 3600_000 }, // a phone clock set to 2030
    { key: key(PHONE, "2026-09-27T07:00:00.000Z"), lastModified: NOW - 3600_000 },
    { key: key(PHONE, "2026-09-26T07:00:00.000Z"), lastModified: NOW - 86_400_000 },
  ];
  const [phone] = pickSnapshots(objects, { installId: ME, devices: {}, now: NOW });
  assert.equal(phone.device, PHONE);
  assert.deepEqual(phone.keys, [objects[1].key, objects[0].key, objects[2].key], "newest first, three to try");
  assert.equal(phone.lastSeen, NOW - 3600_000);
  assert.equal(phone.dead, false);
});

test("own, restore-undo, un-named, pre-rename and revoked snapshots are never read", () => {
  const objects = [
    { key: key(ME, "2026-09-27T07:00:00.000Z"), lastModified: NOW },
    { key: key(PHONE, "2026-09-27T07:00:00.000Z", "-before-restore"), lastModified: NOW },
    { key: key("", "2026-09-27T07:00:00.000Z"), lastModified: NOW },
    { key: `bovault/snapshots/${TABLET}/2026-09-27T07-00-00-000Z.bovault`, lastModified: NOW },
    { key: key(TABLET, "2026-09-27T07:00:00.000Z"), lastModified: NOW },
    { key: "kapevault/snapshots/readme.txt", lastModified: NOW },
  ];
  assert.deepEqual(pickSnapshots(objects, { installId: ME, devices: {}, now: NOW }).map((p) => p.device), [TABLET]);
  const revoked = { [TABLET]: { name: "Mock Tablet", platform: "android", addedAt: [1, 0, TABLET], revokedAt: [2, 0, ME] } };
  assert.deepEqual(pickSnapshots(objects, { installId: ME, devices: revoked, now: NOW }), []);
});

test("a device silent for 180 days is marked dead; a missing LastModified sorts oldest", () => {
  const objects = [
    { key: key(PHONE, "2026-01-01T00:00:00.000Z"), lastModified: NOW - DEAD_AFTER_MS - 1 },
    { key: key(TABLET, "2026-09-27T07:00:00.000Z"), lastModified: null },
    { key: key(TABLET, "2026-09-20T07:00:00.000Z"), lastModified: NOW - 7 * 86_400_000 },
  ];
  const picks = pickSnapshots(objects, { installId: ME, devices: {}, now: NOW });
  assert.deepEqual(picks.map((p) => [p.device, p.dead]), [[PHONE, true], [TABLET, false]].sort());
  assert.deepEqual(picks.find((p) => p.device === TABLET).keys, [objects[2].key, objects[1].key]);
});

// SECURITY-AUDIT-2026-09-28.md L9: the phone reads a reply whole, so a planted 2 GB object under a fake device
// crashed every sync. Sync never downloads anything listed bigger than a vault can be.
test("an object listed bigger than any vault is never picked", () => {
  const objects = [
    { key: key(PHONE, "2026-09-27T07:00:00.000Z"), lastModified: NOW - 1000, size: MAX_VAULT_BYTES + 1 },
    { key: key(PHONE, "2026-09-26T07:00:00.000Z"), lastModified: NOW - 2000, size: 4096 },
  ];
  const [phone] = pickSnapshots(objects, { installId: ME, devices: {}, now: NOW });
  assert.deepEqual(phone.keys, [objects[1].key]);
});

test("a new snapshot's key reads back; thinning keeps the newest 20 and never touches a key named far ahead", () => {
  const at = new Date(NOW);
  assert.equal(snapshotKey(at, PHONE), `kapevault/snapshots/${PHONE}/2026-09-27T08-00-00-000Z.kapevault`);
  assert.deepEqual(readSnapshotKey(snapshotKey(at, PHONE, "before-restore")), { owner: PHONE, time: NOW, beforeRestore: true, legacy: false });
  assert.equal(readSnapshotKey(snapshotKey(at)).owner, null);
  const recent = Array.from({ length: 25 }, (_, i) => snapshotKey(new Date(NOW - i * 60_000), ME));
  const future = snapshotKey(new Date(NOW + 2 * 86_400_000), ME);
  const pruned = snapshotsToPrune([...recent, future, "kapevault/snapshots/readme.txt"], NOW);
  assert.deepEqual(pruned, recent.slice(20), "past the newest 20, this day already has its newest");
});

const DAY = 86_400_000;
const timeOf = (k) => readSnapshotKey(k)?.time ?? null;

test("pruning keeps the newest 20, then one per local day for 60 days, and never touches other objects", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  // 30 snapshots a minute apart today, then 3 a day for the previous 90 days
  const keys = [];
  for (let m = 0; m < 30; m++) keys.push(snapshotKey(new Date(now - m * 60_000), ME));
  for (let d = 1; d <= 90; d++) for (let h = 0; h < 3; h++) keys.push(snapshotKey(new Date(now - d * DAY - h * 3_600_000), ME));
  keys.push("kapevault/snapshots/readme.txt", "someone-else/file.bin");

  const doomed = new Set(snapshotsToPrune(keys, now));
  const kept = keys.filter((k) => !doomed.has(k) && timeOf(k) !== null);
  assert.ok(!doomed.has("kapevault/snapshots/readme.txt") && !doomed.has("someone-else/file.bin"));
  for (let m = 0; m < 20; m++) assert.ok(!doomed.has(keys[m]), `recent ${m} kept`);
  const days = kept.map((k) => new Date(timeOf(k)).toLocaleDateString("en-CA"));
  const olderDays = days.slice(20);
  assert.equal(new Set(olderDays).size, olderDays.length, "at most one per local day past the newest 20");
  assert.ok(kept.every((k) => now - timeOf(k) < 60 * DAY), "nothing older than 60 days");
  assert.ok(kept.length >= 58 && kept.length <= 80, String(kept.length));
});

test("pruning never takes the way back from a restore: -before-restore snapshots stay 30 days, the newest for good", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  const at = (ms, note = "") => snapshotKey(new Date(now - ms), ME, note);
  const undoToday = at(30 * 60_000, "before-restore");
  const regularToday = Array.from({ length: 25 }, (_, m) => at(m * 60_000)); // 25 newer backups the same day
  const regularYesterday = at(DAY + 2 * 3_600_000);
  const undoYesterday = at(DAY + 3_600_000, "before-restore"); // newer than that day's regular one
  const undo20 = at(20 * DAY, "before-restore");
  const undo40 = at(40 * DAY, "before-restore");
  const doomed = new Set(snapshotsToPrune([undoToday, ...regularToday, regularYesterday, undoYesterday, undo20, undo40], now));

  for (const kept of [undoToday, undoYesterday, undo20]) assert.ok(!doomed.has(kept), `${kept} kept for 30 days`);
  assert.ok(!doomed.has(regularYesterday), "a before-restore snapshot never takes its day's place from the regular one");
  assert.ok(doomed.has(undo40), "past 30 days, an older one goes");
  assert.deepEqual(regularToday.filter((k) => doomed.has(k)), regularToday.slice(20), "the regular rules are unchanged");

  const lastUndo = at(100 * DAY, "before-restore");
  assert.ok(!snapshotsToPrune([lastUndo, ...regularToday], now).includes(lastUndo), "the newest is kept however old");
});
