const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createUnlockThrottle } = require("./unlock-throttle.cjs");
const { MAX_UNLOCK_PAUSE_MS } = require("../core/index.js");
const { seeded } = require("./fixtures/vault-session-helpers.cjs");

// A throttle on a fresh file with a clock the test moves: the pause is always over before the next
// guess, so nothing here waits on a real timer.
function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-throttle-")), "unlock-throttle.json");
  const clock = { t: 1_000_000 };
  const now = () => clock.t;
  const make = (onWait) => createUnlockThrottle({ file, now, onWait });
  const saved = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
  // One guess, then the clock moves past any pause it set.
  const guess = async (throttled, result, options) => {
    const answer = await throttled(async () => result, options);
    clock.t += MAX_UNLOCK_PAUSE_MS + 1;
    return answer;
  };
  return { file, clock, make, saved, guess };
}

const MISS = { ok: false, error: "Wrong master password" };
const HIT = { ok: true };

test("vaultFile supplies the current salt and an unreadable file falls back to the unnamed target", async () => {
  const { file: vaultFile } = await seeded();
  const salt = JSON.parse(fs.readFileSync(vaultFile, "utf8")).kdf.salt;
  const { file, saved } = setup();
  const throttled = createUnlockThrottle({ file, vaultFile });
  await throttled(async () => MISS);
  assert.deepEqual(saved().targets, { [salt]: { failed: 1, nextAt: 0 } });
  fs.writeFileSync(vaultFile, "not a vault");
  await throttled(async () => MISS);
  assert.deepEqual(saved().targets, { [salt]: { failed: 1, nextAt: 0 }, "?": { failed: 1, nextAt: 0 } });
});

test("the miss count persists across a restart", async () => {
  const { make, saved, guess } = setup();
  const first = make();
  for (let i = 0; i < 3; i++) await guess(first, MISS);
  assert.deepEqual(saved(), { failed: 3, nextAt: 0 });
  const again = make(); // quit and relaunch
  await guess(again, MISS);
  assert.equal(saved().failed, 4);
});

test("six refused saves keep their misses in memory for the seventh save", async (t) => {
  const { make, saved, guess } = setup();
  const throttled = make();
  const refused = t.mock.method(fs, "renameSync", () => { throw new Error("mock disk refused"); });
  for (let i = 0; i < 6; i++) await guess(throttled, MISS);
  assert.equal(saved(), null);
  refused.mock.restore();
  await guess(throttled, MISS);
  assert.equal(saved().failed, 7);
});

test("two instances on one file share alternating misses", async () => {
  const { make, saved, guess } = setup();
  const first = make();
  const second = make();
  await guess(first, MISS);
  assert.equal(saved().failed, 1);
  await guess(second, MISS);
  assert.equal(saved().failed, 2);
  await guess(first, MISS);
  assert.equal(saved().failed, 3);
});

test("after 5 misses the pause doubles from 1s and is capped at 30s", async () => {
  const { clock, make, saved } = setup();
  const throttled = make();
  const pauses = [];
  for (let failed = 1; failed <= 11; failed++) {
    await throttled(async () => MISS);
    const { nextAt } = saved();
    pauses.push(nextAt === 0 ? 0 : nextAt - clock.t);
    clock.t += MAX_UNLOCK_PAUSE_MS + 1;
  }
  assert.deepEqual(pauses, [0, 0, 0, 0, 1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});

test("the next guess waits out the pause", async () => {
  const { make } = setup();
  const waits = [];
  const throttled = make((ms) => waits.push(ms));
  for (let i = 0; i < 5; i++) await throttled(async () => MISS); // the 5th sets a 1s pause
  assert.deepEqual(waits, []);
  const started = Date.now(); // the test clock stands still, so the 1s pause is real time
  await throttled(async () => MISS);
  assert.ok(Date.now() - started >= 900, "the sixth guess waited about a second");
  assert.deepEqual(waits, [1000]);
});

test("a success on the local vault deletes the file", async () => {
  const { file, make, guess } = setup();
  const throttled = make();
  for (let i = 0; i < 6; i++) await guess(throttled, MISS);
  assert.ok(fs.existsSync(file));
  assert.equal((await guess(throttled, HIT)).ok, true);
  assert.equal(fs.existsSync(file), false);
  await guess(throttled, MISS);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).failed, 1, "the count starts again");
});

test("a success with local: false (a backup, a kept copy) never resets the count", async () => {
  const { make, saved, guess } = setup();
  const throttled = make();
  for (let i = 0; i < 5; i++) await guess(throttled, MISS);
  const before = saved();
  await guess(throttled, HIT, { local: false });
  assert.deepEqual(saved(), before);
  await guess(throttled, MISS, { local: false });
  // A miss on another file that names none has its own count, which no own-vault success clears.
  assert.equal(saved().targets["?other"].failed, 1, "a miss on another file still counts");
  assert.equal(saved().targets["?"].failed, 5, "and the count here stays");
});

test("a new master password refused by the rule is not counted", async () => {
  const { file, make, saved, guess } = setup();
  const throttled = make();
  const refused = await guess(throttled, { ok: false, rule: true, error: "Too weak" });
  assert.equal(refused.rule, true);
  assert.equal(fs.existsSync(file), false);
  await guess(throttled, MISS);
  await guess(throttled, { ok: false, rule: true });
  assert.equal(saved().failed, 1);
});

test("a corrupt file counts as no misses", async () => {
  for (const junk of ["{not json", JSON.stringify({ failed: "7", nextAt: 0 }), JSON.stringify({ failed: -2, nextAt: 0 }), JSON.stringify({ failed: 3, nextAt: "soon" })]) {
    const { file, make, saved, guess } = setup();
    fs.writeFileSync(file, junk);
    const throttled = make();
    await guess(throttled, MISS);
    assert.deepEqual(saved(), { failed: 1, nextAt: 0 }, junk);
  }
});

test("guesses run one at a time, in order", async () => {
  const { make } = setup();
  const throttled = make();
  const order = [];
  let release;
  const first = throttled(() => new Promise((r) => (release = () => r(MISS))).then((x) => (order.push(1), x)));
  const second = throttled(async () => (order.push(2), MISS));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, [], "the second waits for the first");
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, [1, 2]);
});

test("an attempt that throws rejects, and the queue still runs and counts the next guess", async () => {
  const { make, saved } = setup();
  const throttled = make();
  await assert.rejects(throttled(async () => {
    throw new Error("mock decrypt failure");
  }), /mock decrypt failure/);
  assert.deepEqual(await throttled(async () => MISS), MISS);
  assert.equal(saved().failed, 1);
});
