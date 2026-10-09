const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createVaultSession } = require("./vault-session.cjs");
const { readImportFile, importPicked, shredFile, summarizeSkipped, IMPORT_MAX_BYTES, NOT_AN_IMPORT } = require("./import-file.cjs");

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
  assert.deepEqual(readImportFile(plain), { file: fs.realpathSync(plain), entries: ENTRIES, source: "kapevault", label: "KAPEVault", skipped: [], notes: [] });
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
    write(dir, "columns.csv", "just,some,columns\n1,2,3\n"),
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

test("another manager's CSV and JSON export read as items, with a BOM and CRLF", () => {
  const dir = tempDir();
  const csv = write(dir, "chrome.csv", String.fromCharCode(0xfeff) + "name,url,username,password,note\r\nMock Site,https://mock.example.com,mock.user,mock-pass,\r\n,,,,\r\n");
  const read = readImportFile(csv);
  assert.equal(read.source, "browser");
  assert.equal(read.label, "Chrome / Edge / Brave (CSV)");
  assert.deepEqual(read.entries.map((e) => [e.title, e.password]), [["Mock Site", "mock-pass"]]);
  assert.deepEqual(summarizeSkipped(read.skipped), [{ reason: "No title, site or username", count: 1 }]);
  const json = write(dir, "bitwarden.json", JSON.stringify({ encrypted: false, folders: [], items: [{ type: 2, name: "Mock note", notes: "text" }] }));
  assert.equal(readImportFile(json).source, "bitwarden-json");
});

test("an encrypted Bitwarden export says so, and is not the generic refusal", () => {
  const dir = tempDir();
  const file = write(dir, "enc.json", JSON.stringify({ encrypted: true, encKeyValidation_DO_NOT_EDIT: "2.mock", data: "2.mock" }));
  assert.throws(() => readImportFile(file), (e) => /encrypted/.test(e.message) && e.message !== NOT_AN_IMPORT);
});

// The whole path of Settings > Import after the file dialog, with a real session on a temp vault.
async function session() {
  const vault = createVaultSession(path.join(tempDir(), "vault.kapevault"));
  await vault.create("mock kettle harbor pass orbit gazelle");
  return vault;
}
const kapevaultFile = (dir, entries) => write(dir, "import.json", JSON.stringify({ format: "kapevault-import", version: 1, entries }));
const LOGIN = { space: "Mock client", kind: "login", title: "Mock site", username: "mock.user", password: "mock-pass-1" };

test("every row added: the file is deleted", async () => {
  const dir = tempDir();
  const file = kapevaultFile(dir, [LOGIN]);
  const out = importPicked(file, await session());
  assert.deepEqual([out.ok, out.added, out.skipped, out.kept, out.deleted], [true, 1, 0, 0, true]);
  assert.equal(fs.existsSync(file), false);
});

test("every row an exact copy of what is there: the file is deleted", async () => {
  const dir = tempDir();
  const vault = await session();
  importPicked(kapevaultFile(dir, [LOGIN]), vault);
  const again = kapevaultFile(dir, [LOGIN]);
  const out = importPicked(again, vault);
  assert.deepEqual([out.added, out.skipped, out.kept, out.deleted], [0, 1, 0, true]);
  assert.equal(fs.existsSync(again), false);
});

test("the same title with another username is added, not skipped, and the file goes", async () => {
  const dir = tempDir();
  const vault = await session();
  importPicked(kapevaultFile(dir, [LOGIN]), vault);
  const out = importPicked(kapevaultFile(dir, [{ ...LOGIN, username: "second.user" }]), vault);
  assert.deepEqual([out.added, out.skipped, out.deleted], [1, 0, true]);
});

test("a re-import over a trashed import adds the items back", async () => {
  const dir = tempDir();
  const vault = await session();
  const first = importPicked(kapevaultFile(dir, [LOGIN]), vault);
  vault.deleteEntry(first.vault.entries[0].id);
  const out = importPicked(kapevaultFile(dir, [LOGIN]), vault);
  assert.deepEqual([out.added, out.skipped], [1, 0]);
  assert.equal(out.vault.entries.length, 1);
});

test("a row that could not be imported keeps the file and says how many", async () => {
  const dir = tempDir();
  const file = write(dir, "bitwarden.json", JSON.stringify({ encrypted: false, folders: [], items: [{ type: 2, name: "Mock note", notes: "text" }, { type: 99, name: "Mock future type" }] }));
  const out = importPicked(file, await session());
  assert.deepEqual([out.ok, out.added, out.kept, out.deleted], [true, 1, 1, false]);
  assert.equal(fs.readFileSync(file, "utf8").includes("Mock future type"), true, "the file is untouched");
});

test("a Bitwarden SSH key is imported and the file is deleted", async () => {
  const dir = tempDir();
  const file = write(dir, "bitwarden.json", JSON.stringify({ encrypted: false, folders: [], items: [{ type: 5, name: "Mock key", sshKey: { privateKey: "mock-private", publicKey: "ssh-ed25519 AAAA", keyFingerprint: "SHA256:mock" } }] }));
  const out = importPicked(file, await session());
  assert.deepEqual([out.added, out.kept, out.deleted], [1, 0, true]);
  assert.equal(out.vault.entries[0].kind, "key");
});

test("nothing importable is an error and the file stays", async () => {
  const dir = tempDir();
  const file = write(dir, "chrome.csv", "name,url,username,password,note\n,,,mock-pass-only,\n");
  const out = importPicked(file, await session());
  assert.equal(out.ok, false);
  assert.equal(fs.existsSync(file), true);
});
