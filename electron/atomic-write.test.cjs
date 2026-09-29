const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeFileAtomic } = require("./atomic-write.cjs");

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
