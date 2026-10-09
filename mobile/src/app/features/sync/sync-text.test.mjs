// The sync line and the Sync now toast for a phone without Pro: it only backs up, and says so.
import test from "node:test";
import assert from "node:assert/strict";
import { afterSyncToast, lastTime, reviewSentences, syncLineText, syncsNow } from "./sync-text.ts";

const ago = () => "2 min ago";
const free = (more = {}) => ({
  state: "idle",
  backupOnly: true,
  problems: [],
  conflicts: [],
  lastAt: 5, // another device's sync time never shows on a phone without Pro
  devices: [
    { id: "pc", name: "DESKTOP-4F2A", lastSyncAt: 9 },
    { id: "me", name: "Pixel 8", thisDevice: true, lastSyncAt: 7 },
  ],
  ...more,
});

test("without Pro, idle: this phone's own backup time", () => {
  let seen;
  const text = syncLineText(free(), (ms) => {
    seen = ms;
    return "2 min ago";
  });
  assert.deepEqual(text, { text: "Backed up · 2 min ago", tone: "ok" });
  assert.equal(seen, 7);
  assert.deepEqual(syncLineText(free({ devices: [] }), ago), { text: "Backs up to your bucket", tone: "quiet" });
});

test("a phone that only backs up shows its own backup time, even with Pro", () => {
  assert.equal(lastTime(free({ backupOnly: false, removed: true })), 7);
  assert.equal(lastTime(free({ backupOnly: false })), 5);
});

test("without Pro, manual: only on Back up now", () => {
  assert.equal(syncLineText(free({ manual: true }), ago).text, "Backed up · 2 min ago · only on Back up now");
  assert.equal(syncLineText(free({ manual: true, devices: [] }), ago).text, "Backs up to your bucket · only on Back up now");
  assert.equal(syncLineText(free({ backupOnly: false, manual: true }), ago).text, "Synced with your devices · 2 min ago · only on Sync now");
});

test("without Pro, an error: the backup did not finish", () => {
  assert.deepEqual(syncLineText(free({ state: "error" }), ago), { text: "Backup did not finish · tap to see why", tone: "warn" });
  assert.equal(syncLineText(free({ state: "error", backupOnly: false }), ago).text, "Sync did not finish · tap to see why");
});

test("the button backs up and says Backed up whenever this phone does not sync", () => {
  for (const off of [{ backupOnly: true }, { apart: true }, { removed: true }]) {
    const after = free({ backupOnly: false, peer: "DESKTOP-4F2A", ...off });
    assert.equal(syncsNow(after), false);
    assert.equal(afterSyncToast(after), "Backed up");
  }
  const synced = free({ backupOnly: false, peer: "DESKTOP-4F2A" });
  assert.equal(syncsNow(synced), true);
  assert.equal(afterSyncToast(synced), "Synced with DESKTOP-4F2A");
  assert.equal(afterSyncToast({ ...synced, review: { from: ["DESKTOP-4F2A"] } }), null);
});

test("a removal is a review with its own sentence, and a new master password keeps its own", () => {
  const review = { from: ["DESKTOP-4F2A"], reasons: ["removed"], added: [], changed: [], deleted: [], copies: [], secretItems: 0 };
  assert.deepEqual(reviewSentences(review), ["This phone was removed from sync on another device. After Apply it syncs no more."]);
  assert.deepEqual(reviewSentences({ ...review, reasons: ["key"] }), ["DESKTOP-4F2A set a new master password. After Apply it unlocks this vault too."]);
});
