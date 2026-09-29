const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readImportFile, shredFile, IMPORT_MAX_BYTES, NOT_AN_IMPORT } = require("./import-file.cjs");

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-import-file-"));
const ENTRIES = [{ space: "Mock client", kind: "login", title: "Mock site", password: "mock-pass-1" }];
const write = (dir, name, text) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
};

test("a KAPEVault import file reads back its entries; a Notepad BOM and the old name are fine", () => {
  const dir = tempDir();
  const plain = write(dir, "plain.json", JSON.stringify({ format: "kapevault-import", version: 1, entries: ENTRIES }));
  assert.deepEqual(readImportFile(plain), { file: fs.realpathSync(plain), entries: ENTRIES });
  const bom = write(dir, "bom.json", String.fromCharCode(0xfeff) + JSON.stringify({ format: "kapevault-import", version: 1, entries: ENTRIES }));
  assert.deepEqual(readImportFile(bom).entries, ENTRIES);
  const old = write(dir, "old.json", JSON.stringify({ format: "bovault-import", version: 1, entries: ENTRIES }));
  assert.deepEqual(readImportFile(old).entries, ENTRIES);
});

test("anything else is refused with one message, whatever went wrong", () => {
  const dir = tempDir();
  const refused = [
    write(dir, "junk.json", "{not json"),
    write(dir, "other.json", JSON.stringify({ format: "someone-else", version: 1, entries: [] })),
    write(dir, "v2.json", JSON.stringify({ format: "kapevault-import", version: 2, entries: [] })),
    write(dir, "null.json", "null"),
    write(dir, "big.json", JSON.stringify({ format: "kapevault-import", version: 1, pad: "x".repeat(IMPORT_MAX_BYTES) })),
    path.join(dir, "missing.json"),
    dir, // a folder
  ];
  for (const file of refused) assert.throws(() => readImportFile(file), { message: NOT_AN_IMPORT }, path.basename(file));
});

test("a symlink reads as its target, so the file deleted afterwards is the real one", (t) => {
  const dir = tempDir();
  const target = write(dir, "real.json", JSON.stringify({ format: "kapevault-import", version: 1, entries: ENTRIES }));
  const link = path.join(dir, "link.json");
  try {
    fs.symlinkSync(target, link, "file");
  } catch (e) {
    if (e.code === "EPERM") return t.skip("creating a symlink needs Developer Mode or admin on Windows");
    throw e;
  }
  assert.equal(readImportFile(link).file, fs.realpathSync(target));
});

test("shredFile writes zeros over the file, then deletes it", (t) => {
  const dir = tempDir();
  const file = write(dir, "import.json", "mock-plain-text-password");
  const written = [];
  const realWrite = fs.writeSync;
  t.mock.method(fs, "writeSync", (fd, buffer, ...rest) => {
    written.push(Buffer.from(buffer));
    return realWrite(fd, buffer, ...rest);
  });
  assert.equal(shredFile(file), true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(written.length, 1);
  assert.ok(written[0].length === "mock-plain-text-password".length && written[0].every((b) => b === 0));
});

test("a file that cannot be deleted is reported, never thrown, and is already zeroed", (t) => {
  const dir = tempDir();
  const file = write(dir, "import.json", "mock-plain-text-password");
  t.mock.method(fs, "rmSync", () => {
    throw Object.assign(new Error("EBUSY: mock file in use"), { code: "EBUSY" });
  });
  assert.equal(shredFile(file), false);
  assert.ok(fs.readFileSync(file).every((b) => b === 0));
  assert.equal(shredFile(path.join(dir, "missing.json")), false);
});
