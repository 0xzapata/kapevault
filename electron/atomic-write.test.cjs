const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeFileAtomic, sweepStale } = require("./atomic-write.cjs");

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-atomic-"));

test("writes and replaces a file, flushing it first, and leaves nothing else behind", (t) => {
  const dir = tempDir();
  const file = path.join(dir, "settings.json");
  const synced = t.mock.method(fs, "fsyncSync");
  writeFileAtomic(file, "first");
  writeFileAtomic(file, Buffer.from("second"));
  assert.equal(fs.readFileSync(file, "utf8"), "second");
  assert.ok(synced.mock.callCount() >= 2, "every write is flushed before the rename");
  assert.deepEqual(fs.readdirSync(dir), ["settings.json"]);
});

test("a fixed .tmp name is never used, so a file left there is not touched", () => {
  const dir = tempDir();
  const file = path.join(dir, "vault.kapevault");
  fs.writeFileSync(`${file}.tmp`, "someone else's");
  writeFileAtomic(file, "mock vault");
  assert.equal(fs.readFileSync(`${file}.tmp`, "utf8"), "someone else's");
});

test("a failed write throws, keeps the old file and removes its temp file", (t) => {
  const dir = tempDir();
  const file = path.join(dir, "vault.kapevault");
  fs.writeFileSync(file, "old");
  t.mock.method(fs, "renameSync", () => {
    throw Object.assign(new Error("EPERM: mock rename refused"), { code: "EPERM" });
  });
  assert.throws(() => writeFileAtomic(file, "new"), /mock rename refused/);
  assert.equal(fs.readFileSync(file, "utf8"), "old");
  assert.deepEqual(fs.readdirSync(dir), ["vault.kapevault"]);
});

test("the temp file, and so the written file, is owner-only by default", { skip: process.platform === "win32" }, () => {
  const file = path.join(tempDir(), "vault.kapevault");
  writeFileAtomic(file, "mock vault");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("sweepStale removes only our own old temp files", () => {
  const dir = tempDir();
  const mine = path.join(dir, ".vault.kapevault.0f8fad5b-d9cb-469f-a165-70867728950e.tmp");
  const fresh = path.join(dir, ".settings.json.1f8fad5b-d9cb-469f-a165-70867728950e.tmp");
  const others = ["vault.kapevault", "vault.kapevault.tmp", ".hidden.tmp", "notes.0f8fad5b-d9cb-469f-a165-70867728950e.tmp"].map((n) => path.join(dir, n));
  for (const f of [mine, fresh, ...others]) fs.writeFileSync(f, "x");
  const old = new Date(Date.now() - 2 * 3600 * 1000);
  for (const f of [mine, ...others]) fs.utimesSync(f, old, old);
  sweepStale(dir);
  assert.equal(fs.existsSync(mine), false, "old temp of ours is gone");
  assert.equal(fs.existsSync(fresh), true, "a recent one may be a write in flight");
  for (const f of others) assert.equal(fs.existsSync(f), true, path.basename(f));
  assert.doesNotThrow(() => sweepStale(path.join(dir, "missing")));
});
