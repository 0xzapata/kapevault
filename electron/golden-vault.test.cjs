// Frozen vault files written by earlier code (core/fixtures/README.md). Every reader must give back the
// one expected JSON beside each file. Do not regenerate the files: a failure here means a reader changed
// in a way that locks out every vault already written.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { openFile, openFileWithKey, parseVaultFile } = require("./vault-crypto.cjs");
const { openVault } = require("./opener/opener-crypto.cjs");

const DIR = path.join(__dirname, "..", "core", "fixtures");
const MASTER = "mock kettle harbor pass orbit gazelle";
const FIXTURES = [
  ["vault-v1.kapevault", "vault-v1.expected.json", "kapevault"],
  ["bovault-pre-rename.bovault", "bovault-pre-rename.expected.json", "bovault"],
  ["vault-pre-sync-due.kapevault", "vault-pre-sync-due.expected.json", "kapevault"],
];
const load = (name) => fs.readFileSync(path.join(DIR, name), "utf8");

for (const [vaultName, expectedName, format] of FIXTURES) {
  const expected = JSON.parse(load(expectedName));

  test(`${vaultName}: the PC opens it to the expected JSON, by password and by key`, async () => {
    const file = JSON.parse(load(vaultName));
    assert.equal(file.format, format);
    assert.notEqual(parseVaultFile(load(vaultName)), null);
    const opened = await openFile(MASTER, file);
    assert.deepEqual(opened.data, expected);
    assert.deepEqual(openFileWithKey(opened.key, file).data, expected);
    assert.equal(await openFile("mock wrong password orbit gazelle", file), null);
  });

  test(`${vaultName}: the Forever Opener opens it to the expected JSON`, async () => {
    assert.deepEqual(await openVault(JSON.parse(load(vaultName)), MASTER), expected);
    assert.equal(await openVault(JSON.parse(load(vaultName)), "mock wrong password orbit gazelle"), null);
  });
}
