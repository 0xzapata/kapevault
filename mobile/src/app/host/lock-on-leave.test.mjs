// The stolen-phone claim (THREAT-MODEL.md, lock after the grace period away) rests on hooks/use-lock-on-leave.ts:
// the vault locks when the app was off the screen for the grace period, and the vault UI is covered the
// moment the app leaves, so the frame Android shows on return never holds the list or a revealed password.
// It sits here because the mobile test glob covers host/. Fake timers move Date.now too.
import test from "node:test";
import assert from "node:assert/strict";
import { createLockOnLeave } from "../hooks/use-lock-on-leave.ts";

const START = 1_000_000;
function leaver(t, grace) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: START });
  const seen = { locks: 0, covers: [] };
  const away = createLockOnLeave(grace, () => seen.locks++, (covered) => seen.covers.push(covered));
  return { away, seen };
}

test("back before the grace period keeps the vault unlocked and takes the cover off", (t) => {
  const { away, seen } = leaver(t, 30);
  away.left();
  assert.deepEqual(seen.covers, [true], "covered the moment the app left");
  t.mock.timers.tick(29_000);
  away.back();
  t.mock.timers.tick(60_000); // the cancelled timer must not fire later
  assert.equal(seen.locks, 0);
  assert.deepEqual(seen.covers, [true, false]);
});

test("away for the whole grace period locks", (t) => {
  const { away, seen } = leaver(t, 30);
  away.left();
  t.mock.timers.tick(29_999);
  assert.equal(seen.locks, 0);
  t.mock.timers.tick(1);
  assert.equal(seen.locks, 1);
});

test("grace 0 locks the moment the app leaves, and coming back never leaves it open", (t) => {
  const { away, seen } = leaver(t, 0);
  away.left();
  assert.equal(seen.locks, 1, "no timer, no waiting");
  away.back();
  assert.equal(seen.locks, 2);
});

test("timers frozen while the app was cached: the check on return still locks", (t) => {
  const { away, seen } = leaver(t, 30);
  away.left();
  t.mock.timers.setTime(START + 120_000); // two minutes passed on the clock; the frozen timer never ran
  assert.equal(seen.locks, 0, "the timer did not fire");
  away.back();
  assert.equal(seen.locks, 1);
});

test("timers frozen but back inside the grace period: stays unlocked and uncovered", (t) => {
  const { away, seen } = leaver(t, 30);
  away.left();
  t.mock.timers.setTime(START + 10_000);
  away.back();
  assert.equal(seen.locks, 0);
  assert.deepEqual(seen.covers, [true, false]);
});

test("a second leave event (background, then visibilitychange) does not restart the clock", (t) => {
  const { away, seen } = leaver(t, 30);
  away.left();
  t.mock.timers.tick(20_000);
  away.left();
  t.mock.timers.tick(10_000);
  assert.equal(seen.locks, 1, "30 s from the first leave");
  t.mock.timers.tick(60_000);
  assert.equal(seen.locks, 1, "the second leave armed no second timer");
  assert.deepEqual(seen.covers, [true]);
});

test("back without a leave does nothing, and stop() cancels a pending lock", (t) => {
  const { away, seen } = leaver(t, 30);
  away.back();
  assert.deepEqual(seen.covers, []);
  away.left();
  away.stop();
  t.mock.timers.tick(60_000);
  assert.equal(seen.locks, 0);
});
