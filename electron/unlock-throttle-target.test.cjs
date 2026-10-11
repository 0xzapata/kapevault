// Audit run-1 4.5: the miss count is kept per target vault file (its KDF salt), so unlocking a restored
// backup of your own never clears the misses at the vault it replaced.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createUnlockThrottle } = require("./unlock-throttle.cjs");
const { MAX_UNLOCK_PAUSE_MS } = require("../core/index.js");

const MISS = { ok: false, error: "Wrong master password" };
const HIT = { ok: true };
const SLOT = "c2xvdC1zYWx0LXNsb3Qtc2FsdA==";
const OWN = "b3duLXNhbHQtb3duLXNhbHQtb3c=";

function setup(ownSalt = () => OWN) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-throttle-t-")), "unlock-throttle.json");
  const clock = { t: 1_000_000 };
  const make = () => createUnlockThrottle({ file, now: () => clock.t, ownSalt });
  const saved = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
  // A guess that reports how long it waited; the clock never moves, so a real pause is real time.
  const timed = async (throttled, result, options) => {
    const started = Date.now();
    await throttled(async () => result, options);
    return Date.now() - started;
  };
  return { file, clock, make, saved, timed };
}

test("a slot guess after an own-vault unlock still waits", async () => {
  const { make, timed } = setup();
  const throttled = make();
  for (let i = 0; i < 5; i++) await throttled(async () => MISS, { local: false, salt: SLOT }); // the 5th sets a 1s pause
  await throttled(async () => HIT); // unlock the restored backup with its own password
  assert.ok((await timed(throttled, MISS, { local: false, salt: SLOT })) >= 900, "the slot's count survived the own unlock");
});

test("control: a success on the same salt does clear that count", async () => {
  const { make, timed, saved } = setup();
  const throttled = make();
  for (let i = 0; i < 5; i++) await throttled(async () => MISS, { local: false, salt: OWN });
  await throttled(async () => HIT); // local, aimed at OWN
  assert.equal(saved(), null);
  assert.ok((await timed(throttled, MISS)) < 500);
});

test("own-vault misses and slot misses are separate counts, and survive a restart", async () => {
  const { make, saved } = setup();
  const first = make();
  for (let i = 0; i < 2; i++) await first(async () => MISS, { local: false, salt: SLOT });
  for (let i = 0; i < 3; i++) await first(async () => MISS);
  assert.deepEqual(Object.fromEntries(Object.entries(saved().targets).map(([k, v]) => [k, v.failed])), { [SLOT]: 2, [OWN]: 3 });
  const again = make(); // quit and relaunch
  await again(async () => MISS, { local: false, salt: SLOT });
  assert.equal(saved().targets[SLOT].failed, 3);
});

test("an old throttle file ({ failed, nextAt }) still counts, and is cleared by an own-vault success", async () => {
  const { file, make, saved, clock } = setup();
  fs.writeFileSync(file, JSON.stringify({ failed: 7, nextAt: clock.t + MAX_UNLOCK_PAUSE_MS }));
  const throttled = make();
  await throttled(async () => HIT);
  assert.equal(saved(), null, "the old count was cleared, so the vault is never held shut by it for good");
  fs.writeFileSync(file, JSON.stringify({ failed: 2, nextAt: 0 }));
  await createUnlockThrottle({ file, now: () => clock.t })(async () => MISS);
  assert.deepEqual(saved(), { failed: 3, nextAt: 0 }, "unnamed misses here keep the old file shape");
});

test("a guess at another file that names no salt is never cleared by an own-vault success", async () => {
  const { make, saved, timed } = setup();
  const throttled = make();
  for (let i = 0; i < 5; i++) await throttled(async () => MISS, { local: false }); // e.g. a kept copy's delete proof
  await throttled(async () => HIT); // the attacker's own restored vault unlocks
  assert.equal(saved().targets["?other"].failed, 5);
  assert.ok((await timed(throttled, MISS, { local: false })) >= 900, "the next guess still waits");
});

test("without an own salt a local guess uses the unnamed count, like before", async () => {
  const { make, saved } = setup(() => null);
  await make()(async () => MISS);
  assert.deepEqual(saved(), { failed: 1, nextAt: 0 });
});

test("misses at many other files never push out the slot's count and hand back free guesses", async () => {
  const { make, timed } = setup();
  const throttled = make();
  for (let i = 0; i < 5; i++) await throttled(async () => MISS, { local: false, salt: SLOT }); // the 5th sets a 1s pause
  for (let i = 0; i < 20; i++) await throttled(async () => MISS, { local: false, salt: `junk-salt-${i}` }); // each waits the 1s too
  assert.ok((await timed(throttled, MISS, { local: false, salt: SLOT })) >= 900, "the slot still waits");
});
