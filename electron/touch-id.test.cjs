const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createTouchId } = require("./touch-id.cjs");
const { HelloError } = require("./biometric-record.cjs");

const DAY = 24 * 3600 * 1000;

function setup(fake = "approve") {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-touchid-"));
  const clock = { t: Date.UTC(2026, 8, 25) };
  const make = (mode) => createTouchId({ dataDir, fake: mode, now: () => clock.t });
  return { dataDir, file: path.join(dataDir, "touchid.json"), clock, touch: make(fake), make };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => err instanceof HelloError && err.code === code && err.message.length > 0);
}

// Stand-ins for Electron's safeStorage/systemPreferences, for the non-fake code path.
function stubs({ canPrompt = true, approve = true } = {}) {
  const pad = crypto.randomBytes(64);
  const xor = (buf) => Buffer.from(buf.map((b, i) => b ^ pad[i % pad.length]));
  return {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (text) => xor(Buffer.from(text, "utf8")),
      decryptString: (buf) => xor(buf).toString("utf8"),
    },
    systemPreferences: {
      canPromptTouchID: () => canPrompt,
      promptTouchID: async () => {
        if (!approve) throw new Error("canceled");
      },
    },
  };
}

test("enable then unlock returns the same key in a new Buffer", async () => {
  const { touch } = setup();
  const key = crypto.randomBytes(32);
  await touch.enable(key);
  const out = await touch.unlock();
  assert.ok(Buffer.isBuffer(out));
  assert.notEqual(out, key);
  assert.deepEqual(out, key);
});

test("status moves from off to on to off", async () => {
  const { touch, file } = setup();
  assert.deepEqual(touch.status(), { enabled: false, needsMaster: false });
  await touch.enable(crypto.randomBytes(32));
  assert.deepEqual(touch.status(), { enabled: true, needsMaster: false });
  await touch.disable();
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(touch.status(), { enabled: false, needsMaster: false });
});

test("unlock when not enabled -> not-enabled", async () => {
  await rejectsWith(setup().touch.unlock(), "not-enabled");
});

test("cancel -> canceled, and a cancelled enable writes nothing", async () => {
  const { make, file } = setup();
  await rejectsWith(make("cancel").enable(crypto.randomBytes(32)), "canceled");
  assert.equal(fs.existsSync(file), false);
  await make("approve").enable(crypto.randomBytes(32));
  await rejectsWith(make("cancel").unlock(), "canceled");
  assert.equal(fs.existsSync(file), true, "a cancel must not turn Touch ID off");
});

test("messages name Touch ID", async () => {
  await assert.rejects(setup("cancel").touch.enable(crypto.randomBytes(32)), { message: "Touch ID was cancelled." });
});

test("after 14 days the master password is required, touchMaster resets it", async () => {
  const { dataDir, clock, touch } = setup();
  const key = crypto.randomBytes(32);
  await touch.enable(key);
  clock.t += 14 * DAY + 1;
  assert.deepEqual(touch.status(), { enabled: true, needsMaster: true });
  // "cancel" would reject with canceled if it prompted - master-required proves no prompt happened.
  const cancelling = createTouchId({ dataDir, fake: "cancel", now: () => clock.t });
  await assert.rejects(cancelling.unlock(), {
    code: "master-required",
    message: "Enter your master password - KAPEVault asks for it every 14 days.",
  });
  touch.touchMaster(key);
  assert.deepEqual(touch.status(), { enabled: true, needsMaster: false });
  assert.deepEqual(await touch.unlock(), key);
});

test("tampered touchid.json -> changed and the file is removed", async () => {
  const { touch, file } = setup();
  await touch.enable(crypto.randomBytes(32));
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const wrapped = Buffer.from(record.wrapped, "base64");
  wrapped[wrapped.length - 1] ^= 1;
  record.wrapped = wrapped.toString("base64");
  fs.writeFileSync(file, JSON.stringify(record));
  await rejectsWith(touch.unlock(), "changed");
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(touch.status(), { enabled: false, needsMaster: false });
});

test("unreadable touchid.json -> changed and the file is removed", async () => {
  const { touch, file } = setup();
  fs.writeFileSync(file, "{not json");
  await rejectsWith(touch.unlock(), "changed");
  assert.equal(fs.existsSync(file), false);
});

test("a decrypt that is not a 32-byte key -> changed", async () => {
  const { dataDir, file } = setup();
  // Same fixed-key AES-GCM the fake safeStorage uses, so the decrypt succeeds and yields 5 bytes.
  const fakeKey = crypto.createHash("sha256").update("kapevault-fake-touchid").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", fakeKey, iv);
  const body = Buffer.concat([cipher.update("c2hvcnQ=", "utf8"), cipher.final()]);
  const wrapped = Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  const t = Date.UTC(2026, 8, 25);
  const record = { version: 2, wrapped, masterAt: t, highWater: t, seal: Buffer.alloc(32).toString("base64") };
  fs.writeFileSync(file, JSON.stringify(record));
  const touch = createTouchId({ dataDir, fake: "approve", now: () => record.masterAt });
  await rejectsWith(touch.unlock(), "changed");
  assert.equal(fs.existsSync(file), false);
});

test("touchid.json never holds the vault key in any encoding", async () => {
  const { touch, file } = setup();
  const key = crypto.randomBytes(32);
  await touch.enable(key);
  const raw = fs.readFileSync(file);
  const text = raw.toString("utf8");
  for (const enc of ["hex", "base64", "base64url", "latin1"]) {
    assert.equal(text.includes(key.toString(enc)), false, `key leaked as ${enc}`);
  }
  assert.equal(raw.includes(key), false, "key leaked as raw bytes");
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["highWater", "masterAt", "seal", "version", "wrapped"]);
});

test("enable rejects a key that is not 32 bytes", async () => {
  await rejectsWith(setup().touch.enable(Buffer.alloc(16)), "failed");
});

test("no Touch ID sensor -> unsupported, nothing written", async () => {
  const { dataDir, file } = setup();
  const touch = createTouchId({ dataDir, ...stubs({ canPrompt: false }) });
  assert.equal(await touch.isSupported(), false);
  await rejectsWith(touch.enable(crypto.randomBytes(32)), "unsupported");
  assert.equal(fs.existsSync(file), false);
});

test("off macOS the real path is unsupported", { skip: process.platform === "darwin" }, async () => {
  const touch = createTouchId({ dataDir: setup().dataDir, ...stubs() });
  assert.equal(await touch.isSupported(), false);
  await rejectsWith(touch.enable(crypto.randomBytes(32)), "unsupported");
});

test("on macOS the real path wraps through safeStorage", { skip: process.platform !== "darwin" }, async () => {
  const { dataDir } = setup();
  const approving = createTouchId({ dataDir, ...stubs() });
  assert.equal(await approving.isSupported(), true);
  const key = crypto.randomBytes(32);
  await approving.enable(key);
  assert.deepEqual(await approving.unlock(), key);
});

// touchid.json is plain JSON: the dates that decide "master password needed" are sealed to the vault key.
const editRecord = (file, change) => fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), ...change }));

test("an edited masterAt breaks the seal: the master password is asked for, then Touch ID is off until turned on again", async () => {
  const { touch, file, clock } = setup();
  const key = crypto.randomBytes(32);
  await touch.enable(key);
  clock.t += 15 * DAY;
  editRecord(file, { masterAt: clock.t });
  await rejectsWith(touch.unlock(), "master-required");
  assert.equal(fs.existsSync(file), true);
  touch.touchMaster(key);
  assert.equal(fs.existsSync(file), false, "a broken seal is never sealed again");
  await touch.enable(key);
  assert.deepEqual(await touch.unlock(), key);
});

test("touchMaster seals only a record that holds this vault's key; one left from an old key is removed", async () => {
  const { touch, file } = setup();
  const oldKey = crypto.randomBytes(32);
  const newKey = crypto.randomBytes(32);
  await touch.enable(oldKey);
  assert.equal(touch.isStale(oldKey), false);
  assert.equal(touch.isStale(newKey), true);
  touch.touchMaster(newKey);
  assert.equal(fs.existsSync(file), false, "never sealed under the new key");
  assert.equal(touch.isStale(newKey), false);
  await rejectsWith(touch.unlock(), "not-enabled");
});

test("touchMaster never throws: a write or a remove the disk refuses leaves the record as it was", async (t) => {
  const { touch, file, clock } = setup();
  const key = crypto.randomBytes(32);
  await touch.enable(key);
  clock.t += 15 * DAY;
  const before = fs.readFileSync(file, "utf8");
  const refuse = () => {
    throw Object.assign(new Error("EPERM: mock file locked"), { code: "EPERM" });
  };
  t.mock.method(fs, "renameSync", refuse);
  t.mock.method(fs, "rmSync", refuse);
  touch.touchMaster(key);
  touch.touchMaster(crypto.randomBytes(32));
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.deepEqual(touch.status(), { enabled: true, needsMaster: true });
});

test("a clock set back more than a day before the latest time seen needs the master password", async () => {
  const { touch, clock } = setup();
  const start = clock.t;
  const key = crypto.randomBytes(32);
  await touch.enable(key);
  clock.t = start + 10 * DAY;
  assert.deepEqual(await touch.unlock(), key);
  clock.t = start + 2 * DAY;
  assert.deepEqual(touch.status(), { enabled: true, needsMaster: true });
  await rejectsWith(touch.unlock(), "master-required");
});

test("an old v1 record asks for the master password, then is removed: nothing proves it holds this vault's key", async () => {
  const { touch, file } = setup();
  const key = crypto.randomBytes(32);
  await touch.enable(key);
  const { wrapped, masterAt } = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ version: 1, wrapped, masterAt }));
  assert.deepEqual(touch.status(), { enabled: true, needsMaster: true });
  await rejectsWith(touch.unlock(), "master-required");
  touch.touchMaster(key);
  assert.equal(fs.existsSync(file), false);
});

test("a leftover touchid.json.tmp never blocks a write, and no temp file is left behind", async () => {
  const { dataDir, touch, file } = setup();
  fs.mkdirSync(`${file}.tmp`); // a fixed temp name that is taken (another copy, an old crash)
  const key = crypto.randomBytes(32);
  await touch.enable(key);
  touch.touchMaster(key);
  assert.deepEqual(await touch.unlock(), key);
  assert.deepEqual(fs.readdirSync(dataDir).sort(), ["touchid.json", "touchid.json.tmp"]);
});

// See windows-hello.test.cjs: a record that cannot be read right now is neither missing nor damaged.
function busyReads(t, file, times = Infinity) {
  const read = fs.readFileSync;
  let left = times;
  return t.mock.method(fs, "readFileSync", (p, ...rest) => {
    if (p === file && left-- > 0) throw Object.assign(new Error("EBUSY: mock file in use"), { code: "EBUSY" });
    return read(p, ...rest);
  });
}

test("a touchid.json that cannot be read right now is left alone: not removed, not stale", async (t) => {
  const { touch, file } = setup();
  const key = crypto.randomBytes(32);
  await touch.enable(key);
  const before = fs.readFileSync(file, "utf8");
  const busy = busyReads(t, file);
  touch.touchMaster(key);
  touch.touchMaster(crypto.randomBytes(32));
  assert.equal(touch.isStale(key), false, "Settings never says to turn it on again");
  assert.deepEqual(touch.status(), { enabled: true, needsMaster: false });
  assert.equal(touch.masterAt(), null);
  await rejectsWith(touch.unlock(), "failed");
  busy.mock.restore();
  assert.equal(fs.readFileSync(file, "utf8"), before, "the record is as it was");
  assert.deepEqual(await touch.unlock(), key, "and it still opens the vault");
});

test("a touchid.json read that fails for a moment is tried again", async (t) => {
  const { touch, file, clock } = setup();
  const key = crypto.randomBytes(32);
  await touch.enable(key);
  clock.t += 15 * DAY;
  busyReads(t, file, 1);
  touch.touchMaster(key);
  assert.equal(touch.masterAt(), clock.t, "sealed again: the 14 days start over");
});
