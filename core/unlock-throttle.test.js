import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_UNLOCK_PAUSE_MS, nextThrottle, readThrottle, throttleWait } from "./unlock-throttle.js";

const miss = { ok: false };
const hit = { ok: true };

test("five misses are free, then 1 s, 2 s, 4 s ... capped at 30 s; a success clears the count", () => {
  let state = readThrottle(null);
  const pauses = [];
  for (let i = 0; i < 12; i++) {
    state = nextThrottle(state, miss, { now: 1000 });
    pauses.push(state.nextAt && state.nextAt - 1000);
  }
  assert.deepEqual(pauses, [0, 0, 0, 0, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  assert.equal(state.failed, 12);
  assert.deepEqual(nextThrottle(state, hit, { now: 1000 }), { failed: 0, nextAt: 0 });
});

test("a rule refusal is not a guess, and a success on another file never clears the count", () => {
  const state = { failed: 6, nextAt: 5000 };
  assert.equal(nextThrottle(state, { ok: false, rule: true }, { now: 0 }), state);
  assert.equal(nextThrottle(state, hit, { local: false, now: 0 }), state);
  assert.equal(nextThrottle(state, miss, { local: false, now: 0 }).failed, 7, "a miss on another file counts");
});

test("a vault from a newer KAPEVault is not a guess either", () => {
  const state = { failed: 6, nextAt: 5000 };
  assert.equal(nextThrottle(state, { ok: false, newer: true }, { now: 0 }), state);
  assert.equal(nextThrottle(state, { ok: false, newer: true }, { local: false, now: 0 }), state);
});

test("the saved file: malformed means no misses, and the wait is capped however far ahead it says", () => {
  assert.deepEqual(readThrottle(JSON.stringify({ failed: 6, nextAt: 99 })), { failed: 6, nextAt: 99 });
  for (const text of [null, "", "not json", "{}", JSON.stringify({ failed: 0, nextAt: 5 }), JSON.stringify({ failed: 1.5, nextAt: 5 }), JSON.stringify({ failed: 2, nextAt: "soon" })]) {
    assert.deepEqual(readThrottle(text), { failed: 0, nextAt: 0 }, String(text));
  }
  assert.equal(throttleWait({ failed: 9, nextAt: Number.MAX_SAFE_INTEGER }, 0), MAX_UNLOCK_PAUSE_MS);
  assert.ok(throttleWait({ failed: 0, nextAt: 0 }, 1000) <= 0);
});
