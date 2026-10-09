// Frozen vault files written by earlier PC code (core/fixtures/README.md): the phone's reader must give
// back the one expected JSON beside each. Do not regenerate the files.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openFile, openFileWithKey, parseVaultFile } from "./vault-file.ts";

const DIR = path.join(import.meta.dirname, "..", "..", "..", "..", "core", "fixtures");
const MASTER = "mock kettle harbor pass orbit gazelle";
const FIXTURES = [
  ["vault-v1.kapevault", "vault-v1.expected.json"],
  ["bovault-pre-rename.bovault", "bovault-pre-rename.expected.json"],
  ["vault-pre-sync-due.kapevault", "vault-pre-sync-due.expected.json"],
];
const load = (name) => fs.readFileSync(path.join(DIR, name), "utf8");

for (const [vaultName, expectedName] of FIXTURES) {
  test(`${vaultName}: the phone opens it to the expected JSON, by password and by key`, async () => {
    const expected = JSON.parse(load(expectedName));
    const file = parseVaultFile(load(vaultName));
    assert.notEqual(file, null);
    const opened = await openFile(MASTER, file);
    assert.deepEqual(opened.data, expected);
    assert.deepEqual((await openFileWithKey(new Uint8Array(opened.raw), file)).data, expected);
    assert.equal(await openFile("mock wrong password orbit gazelle", file), null);
  });
}
