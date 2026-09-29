const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createWindowsHello, HelloError, _runScript } = require("./windows-hello.cjs");

const DAY = 24 * 3600 * 1000;

function setup(fake = "approve") {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-hello-"));
  const clock = { t: Date.UTC(2026, 8, 25) };
  const make = (mode) => createWindowsHello({ dataDir, fake: mode, now: () => clock.t });
  return { dataDir, file: path.join(dataDir, "hello.json"), clock, hello: make(fake), make };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => err instanceof HelloError && err.code === code && err.message.length > 0);
}

test("enable then unlock returns the same key in a new Buffer", async () => {
  const { hello } = setup();
  const key = crypto.randomBytes(32);
  await hello.enable(key);
  const out = await hello.unlock();
  assert.ok(Buffer.isBuffer(out));
  assert.notEqual(out, key);
  assert.deepEqual(out, key);
});

test("unlock wipes every buffer the key passed through, except the one it returns", async () => {
  const { hello } = setup();
  const key = crypto.randomBytes(32);
  await hello.enable(key);
  const seen = [];
  const realDecipher = crypto.createDecipheriv;
  crypto.createDecipheriv = (...args) => {
    const decipher = realDecipher(...args);
    for (const step of ["update", "final"]) {
      const run = decipher[step].bind(decipher);
      decipher[step] = (...a) => {
        const out = run(...a);
        seen.push(out);
        return out;
      };
    }
    return decipher;
  };
  let out;
  try {
    out = await hello.unlock();
  } finally {
    crypto.createDecipheriv = realDecipher;
  }
  assert.deepEqual(out, key);
  assert.ok(seen.some((b) => b.length === 32), "the unwrap went through the decipher");
  for (const b of seen) assert.ok(b.every((byte) => byte === 0), "a copy of the key was left in memory");
});

test("status moves from off to on to off", async () => {
  const { hello, file } = setup();
  assert.deepEqual(hello.status(), { enabled: false, needsMaster: false });
  await hello.enable(crypto.randomBytes(32));
  assert.deepEqual(hello.status(), { enabled: true, needsMaster: false });
  await hello.disable();
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(hello.status(), { enabled: false, needsMaster: false });
});

test("unlock when not enabled -> not-enabled", async () => {
  await rejectsWith(setup().hello.unlock(), "not-enabled");
});

test("cancel -> canceled, and a cancelled enable writes nothing", async () => {
  const { make, file } = setup();
  await rejectsWith(make("cancel").enable(crypto.randomBytes(32)), "canceled");
  assert.equal(fs.existsSync(file), false);
  await make("approve").enable(crypto.randomBytes(32));
  await rejectsWith(make("cancel").unlock(), "canceled");
  assert.equal(fs.existsSync(file), true, "a cancel must not turn Hello off");
});

test("after 14 days the master password is required, touchMaster resets it", async () => {
  const { dataDir, clock, hello } = setup();
  const key = crypto.randomBytes(32);
  await hello.enable(key);
  clock.t += 14 * DAY + 1;
  assert.deepEqual(hello.status(), { enabled: true, needsMaster: true });
  // "cancel" would reject with canceled if it prompted - master-required proves no prompt happened.
  const cancelling = createWindowsHello({ dataDir, fake: "cancel", now: () => clock.t });
  await rejectsWith(cancelling.unlock(), "master-required");
  hello.touchMaster(key);
  assert.deepEqual(hello.status(), { enabled: true, needsMaster: false });
  assert.deepEqual(await hello.unlock(), key);
});

test("tampered hello.json -> changed and the file is removed", async () => {
  const { hello, file } = setup();
  await hello.enable(crypto.randomBytes(32));
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const wrapped = Buffer.from(record.wrapped, "base64");
  wrapped[0] ^= 1;
  record.wrapped = wrapped.toString("base64");
  fs.writeFileSync(file, JSON.stringify(record));
  await rejectsWith(hello.unlock(), "changed");
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(hello.status(), { enabled: false, needsMaster: false });
});

test("unreadable hello.json -> changed and the file is removed", async () => {
  const { hello, file } = setup();
  fs.writeFileSync(file, "{not json");
  await rejectsWith(hello.unlock(), "changed");
  assert.equal(fs.existsSync(file), false);
});

test("hello.json never holds the vault key in any encoding", async () => {
  const { hello, file } = setup();
  const key = crypto.randomBytes(32);
  await hello.enable(key);
  const raw = fs.readFileSync(file);
  const text = raw.toString("utf8");
  for (const enc of ["hex", "base64", "base64url", "latin1"]) {
    assert.equal(text.includes(key.toString(enc)), false, `key leaked as ${enc}`);
  }
  assert.equal(raw.includes(key), false, "key leaked as raw bytes");
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["challenge", "credential", "highWater", "iv", "masterAt", "seal", "tag", "version", "wrapped"]);
});

test("each enable uses a new challenge", async () => {
  const { hello, file } = setup();
  const key = crypto.randomBytes(32);
  await hello.enable(key);
  const first = JSON.parse(fs.readFileSync(file, "utf8")).challenge;
  await hello.enable(key);
  assert.notEqual(JSON.parse(fs.readFileSync(file, "utf8")).challenge, first);
  assert.deepEqual(await hello.unlock(), key);
});

test("enable rejects a key that is not 32 bytes", async () => {
  await rejectsWith(setup().hello.enable(Buffer.alloc(16)), "failed");
});

test("the real script runs its supported op and answers", { skip: process.platform !== "win32" }, async () => {
  const result = await _runScript("supported");
  assert.equal(result.status, "Success", `script said: ${JSON.stringify(result)}`);
  assert.equal(typeof result.supported, "boolean");
  assert.equal(await createWindowsHello({ dataDir: os.tmpdir() }).isSupported(), result.supported);
});

test("re-enabling keeps the old master date, and a future date counts as due", async () => {
  const { hello, file, clock } = setup();
  const key = crypto.randomBytes(32);
  const typedAt = clock.t;
  clock.t += 10 * DAY;
  await hello.enable(key, typedAt); // Hello turned off and on again 10 days after the master was typed
  clock.t += 5 * DAY;
  assert.deepEqual(hello.status(), { enabled: true, needsMaster: true }, "15 days since the master, not 5");
  await hello.disable();
  await hello.enable(key, clock.t);
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...record, masterAt: clock.t + 365 * DAY }));
  assert.deepEqual(hello.status(), { enabled: true, needsMaster: true }, "an edited future date does not skip the check");
});

// hello.json is plain JSON: the dates that decide "master password needed" are sealed to the vault key.
const editRecord = (file, change) => fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), ...change }));

test("an edited masterAt breaks the seal: the master password is asked for, then Hello is off until turned on again", async () => {
  const { hello, file, clock } = setup();
  const key = crypto.randomBytes(32);
  await hello.enable(key);
  clock.t += 15 * DAY;
  editRecord(file, { masterAt: clock.t });
  await rejectsWith(hello.unlock(), "master-required");
  assert.equal(fs.existsSync(file), true, "no lockout: the master password still unlocks");
  // A broken seal cannot be told from a record of another vault key, so it is never sealed again.
  hello.touchMaster(key);
  assert.equal(fs.existsSync(file), false);
  await hello.enable(key);
  assert.deepEqual(await hello.unlock(), key);
});

test("touchMaster seals only a record that holds this vault's key; one left from an old key is removed", async () => {
  const { hello, file } = setup();
  const oldKey = crypto.randomBytes(32);
  const newKey = crypto.randomBytes(32);
  await hello.enable(oldKey); // then a restore or a master password change whose disable failed
  assert.equal(hello.isStale(oldKey), false);
  assert.equal(hello.isStale(newKey), true, "Settings can say it needs setting up again");
  hello.touchMaster(newKey);
  assert.equal(fs.existsSync(file), false, "never sealed under the new key");
  assert.deepEqual(hello.status(), { enabled: false, needsMaster: false });
  assert.equal(hello.isStale(newKey), false, "nothing left to set up again but the switch");
  await rejectsWith(hello.unlock(), "not-enabled");
});

test("touchMaster never throws: a write or a remove the disk refuses leaves the record as it was", async (t) => {
  const { hello, file, clock } = setup();
  const key = crypto.randomBytes(32);
  await hello.enable(key);
  clock.t += 15 * DAY;
  const before = fs.readFileSync(file, "utf8");
  const refuse = () => {
    throw Object.assign(new Error("EPERM: mock file locked"), { code: "EPERM" });
  };
  t.mock.method(fs, "renameSync", refuse);
  t.mock.method(fs, "rmSync", refuse);
  hello.touchMaster(key);
  hello.touchMaster(crypto.randomBytes(32));
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.deepEqual(hello.status(), { enabled: true, needsMaster: true }, "its dates did not move: still due");
});

test("a clock set back more than a day before the latest time seen needs the master password", async () => {
  const { dataDir, hello, file, clock } = setup();
  const key = crypto.randomBytes(32);
  const start = clock.t;
  await hello.enable(key);
  clock.t = start + 10 * DAY;
  assert.deepEqual(await hello.unlock(), key); // the unlock records the time it saw
  clock.t = start + 2 * DAY; // back inside the 14 days of the old master date
  assert.deepEqual(hello.status(), { enabled: true, needsMaster: true });
  await rejectsWith(createWindowsHello({ dataDir, fake: "cancel", now: () => clock.t }).unlock(), "master-required");
  const sealed = fs.readFileSync(file, "utf8");
  editRecord(file, { highWater: clock.t }); // lowering the mark by hand breaks the seal
  await rejectsWith(hello.unlock(), "master-required");
  fs.writeFileSync(file, sealed);
  clock.t = start + 12 * DAY;
  hello.touchMaster(key);
  clock.t = start + 13 * DAY;
  assert.deepEqual(await hello.unlock(), key);
  clock.t -= 20 * 3600 * 1000; // less than a day behind is a normal clock correction
  assert.deepEqual(await hello.unlock(), key);
});

test("an old v1 record asks for the master password, then is removed: nothing proves it holds this vault's key", async () => {
  const { dataDir, hello, file, clock } = setup();
  const key = crypto.randomBytes(32);
  await hello.enable(key);
  const { seal: _seal, highWater: _highWater, ...v2 } = JSON.parse(fs.readFileSync(file, "utf8"));
  const v1 = { ...v2, version: 1 };
  fs.writeFileSync(file, JSON.stringify(v1));
  assert.deepEqual(hello.status(), { enabled: true, needsMaster: true });
  assert.equal(hello.isStale(key), true);
  await rejectsWith(createWindowsHello({ dataDir, fake: "cancel", now: () => clock.t }).unlock(), "master-required");
  hello.touchMaster(key);
  assert.equal(fs.existsSync(file), false);
});

test("a leftover hello.json.tmp never blocks a write, and no temp file is left behind", async () => {
  const { dataDir, hello, file } = setup();
  fs.mkdirSync(`${file}.tmp`); // a fixed temp name that is taken (another copy, an old crash)
  const key = crypto.randomBytes(32);
  await hello.enable(key);
  hello.touchMaster(key);
  assert.deepEqual(await hello.unlock(), key);
  assert.deepEqual(fs.readdirSync(dataDir).sort(), ["hello.json", "hello.json.tmp"]);
});

// Antivirus or a sync tool holding hello.json during a master unlock: the record is neither missing nor
// damaged. It is tried again briefly, then left alone - never removed, never called stale.
function busyReads(t, file, times = Infinity) {
  const read = fs.readFileSync;
  let left = times;
  return t.mock.method(fs, "readFileSync", (p, ...rest) => {
    if (p === file && left-- > 0) throw Object.assign(new Error("EBUSY: mock file in use"), { code: "EBUSY" });
    return read(p, ...rest);
  });
}

test("a hello.json that cannot be read right now is left alone: not removed, not stale", async (t) => {
  const { hello, file } = setup();
  const key = crypto.randomBytes(32);
  await hello.enable(key);
  const before = fs.readFileSync(file, "utf8");
  const busy = busyReads(t, file);
  hello.touchMaster(key);
  hello.touchMaster(crypto.randomBytes(32));
  assert.equal(hello.isStale(key), false, "Settings never says to turn it on again");
  assert.deepEqual(hello.status(), { enabled: true, needsMaster: false });
  assert.equal(hello.masterAt(), null);
  await rejectsWith(hello.unlock(), "failed");
  busy.mock.restore();
  assert.equal(fs.readFileSync(file, "utf8"), before, "the record is as it was");
  assert.deepEqual(await hello.unlock(), key, "and it still opens the vault");
});

test("a hello.json read that fails for a moment is tried again", async (t) => {
  const { hello, file, clock } = setup();
  const key = crypto.randomBytes(32);
  await hello.enable(key);
  clock.t += 15 * DAY;
  busyReads(t, file, 1);
  hello.touchMaster(key);
  assert.equal(hello.masterAt(), clock.t, "sealed again: the 14 days start over");
});
