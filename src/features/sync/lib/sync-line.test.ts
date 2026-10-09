// Run with `npm test` (Node strips the types). The sync line under the item count, and the review's words.
import test from "node:test";
import assert from "node:assert/strict";
import { deviceNames, reviewSentences, syncLine } from "./sync-line.ts";
import type { SyncReview, SyncStatus } from "@/lib/vault-api";

const idle: SyncStatus = { state: "idle", off: null, manual: false, error: "", problems: [], newMaster: null, thisDevice: "Mock PC", lastSync: null, devices: [], lockOut: [], needsLook: [], review: null, fingerprint: "0123abcd" };
const ago = () => "2 min ago";
const review: SyncReview = { from: ["Mock Phone"], reasons: ["deletes"], added: [], changed: [], deleted: ["a", "b", "c", "d", "e", "f"], copies: [], secretItems: 0 };

test("the line says when and with whom it last synced, or that it has not yet", () => {
  assert.deepEqual(syncLine({ ...idle, lastSync: { at: 1, with: ["MOCK-DESKTOP"] } }, ago), { text: "Synced with MOCK-DESKTOP · 2 min ago", tone: "quiet" });
  assert.deepEqual(syncLine(idle, ago), { text: "Not synced yet", tone: "quiet" });
  assert.equal(deviceNames(["A", "B", "C"]), "A, B and C");
});

test("with automatic backup off the line says sync happens only on Sync now", () => {
  assert.deepEqual(syncLine({ ...idle, manual: true }, ago), { text: "Not synced yet · only on Sync now", tone: "quiet" });
  assert.equal(syncLine({ ...idle, manual: true, lastSync: { at: 1, with: ["MOCK-DESKTOP"] } }, ago)?.text, "Synced with MOCK-DESKTOP · 2 min ago · only on Sync now");
});

test("a removed device that is not locked out yet stays on the line until the master password changes", () => {
  const lockOut = [{ ref: "r1", name: "Mock Phone" }, { ref: "r2", name: "Mock Tablet" }];
  assert.deepEqual(syncLine({ ...idle, lockOut }, ago), { text: "Finish locking out Mock Phone and Mock Tablet", tone: "warn" });
  assert.equal(syncLine({ ...idle, lockOut, error: "Could not reach R2." }, ago)?.text, "Finish locking out Mock Phone and Mock Tablet", "ahead of a plain failure");
  assert.equal(syncLine({ ...idle, lockOut, review }, ago)?.text, "Changes from Mock Phone wait for you", "a held review is still more urgent");
});

test("the most urgent news wins: running, a review, a new master password, a failure, a device problem", () => {
  const all = { ...idle, lastSync: { at: 1, with: ["MOCK-DESKTOP"] }, problems: ["Mock Phone's clock is 2 days ahead."], error: "Could not reach R2.", review, newMaster: "Mock Phone" };
  assert.equal(syncLine({ ...all, state: "running" }, ago)?.text, "Syncing...");
  assert.deepEqual(syncLine({ ...all, state: "review" }, ago), { text: "Changes from Mock Phone wait for you", tone: "warn" });
  assert.deepEqual(syncLine({ ...all, review: null }, ago), { text: "Mock Phone has a new master password", tone: "warn" });
  assert.equal(syncLine({ ...all, review: null, newMaster: null }, ago)?.text, "Not synced: Could not reach R2.");
  assert.equal(syncLine({ ...all, review: null, newMaster: null, error: "" }, ago)?.text, "Mock Phone's clock is 2 days ahead.");
});

test("off: nothing without cloud backup; said plainly otherwise", () => {
  assert.equal(syncLine({ ...idle, state: "off", off: "no-cloud" }, ago), null);
  assert.equal(syncLine({ ...idle, state: "off", off: "locked" }, ago), null);
  assert.deepEqual(syncLine({ ...idle, state: "off", off: "restored" }, ago), { text: "Sync is paused after the restore", tone: "warn" });
  assert.deepEqual(syncLine({ ...idle, state: "off", off: "removed" }, ago), { text: "This device was removed from sync", tone: "warn" });
});

test("the review says who wants what", () => {
  assert.deepEqual(reviewSentences(review), ["Mock Phone wants to delete 6 items."]);
  assert.deepEqual(reviewSentences({ ...review, from: ["Mock Phone", "Mock Tablet"], reasons: ["secrets"], secretItems: 21 }), ["Mock Phone and Mock Tablet changed passwords or other secrets on 21 items."]);
  assert.deepEqual(reviewSentences({ ...review, reasons: ["epoch"] }), ["Mock Phone restored a backup and made it the vault on all devices."]);
  assert.deepEqual(reviewSentences({ ...review, reasons: ["key"] }), ["Mock Phone set a new master password. After Apply it unlocks this vault too."]);
});
