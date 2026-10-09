// Run with `npm test` (Node strips the types). The Trash's days-left wording.
import test from "node:test";
import assert from "node:assert/strict";
import { daysLeftLabel, trashLine } from "./trash-text.ts";
import { login } from "./test-entries.ts";

test("days read as a count, one day is singular, none left says today", () => {
  assert.equal(daysLeftLabel(30), "30 days left");
  assert.equal(daysLeftLabel(2), "2 days left");
  assert.equal(daysLeftLabel(1), "1 day left");
  assert.equal(daysLeftLabel(0), "Going today");
});

test("the row says the days main counted, whatever the item's own trashedAt reads", () => {
  const trashedAt = "2026-03-01T00:00:00.000Z"; // a phone whose clock was months behind wrote this
  assert.equal(trashLine(login({ trashedAt, daysLeft: 30 })), "30 days left");
  assert.equal(trashLine(login({ trashedAt, daysLeft: 1 })), "1 day left");
  assert.equal(trashLine(login({ trashedAt, daysLeft: 0 })), "Going today");
});

test("an item that came without its days says nothing rather than guess", () => {
  assert.equal(trashLine(login({ trashedAt: "2026-03-01T00:00:00.000Z" })), "");
});
