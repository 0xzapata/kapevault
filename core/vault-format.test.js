import { test } from "node:test";
import assert from "node:assert/strict";
import { checkVaultFile, isNewerVaultFile, parseVaultFile, MAX_VAULT_BYTES, NewerVaultError, READER_VERSION, VAULT_KDF } from "./vault-format.js";

const b64 = (n) => btoa(String.fromCharCode(...new Uint8Array(n).fill(7)));
const shape = (over = {}, kdf = {}) => ({ format: "kapevault", version: 1, kdf: { name: "scrypt", N: 2 ** 17, r: 8, p: 1, salt: b64(16), ...kdf }, iv: b64(12), tag: b64(16), data: b64(31), ...over });

test("the header a KAPEVault file must have before any key derivation", () => {
  assert.deepEqual({ ...VAULT_KDF }, { name: "scrypt", N: 2 ** 17, r: 8, p: 1 });
  assert.equal(MAX_VAULT_BYTES, 64 * 1024 * 1024);
  const good = shape();
  assert.equal(checkVaultFile(good), good);
  assert.doesNotThrow(() => checkVaultFile(shape({ format: "bovault" })), "saved before the rename");
  const bad = [
    shape({ format: "other" }),
    shape({}, { name: "pbkdf2" }),
    shape({}, { N: 2 ** 14 }),
    shape({}, { r: 1000 }),
    shape({}, { p: 2 ** 20 }),
    shape({}, { salt: b64(8) }),
    shape({ iv: b64(16) }),
    shape({ tag: b64(8) }),
    shape({ data: 42 }),
    shape({ data: `${b64(31)}\n` }), // whitespace the PC Buffer decoder used to skip
    shape({ data: b64(31).replace(/=+$/, "") }), // unpadded
    shape({ data: "-_-_" }), // URL-safe alphabet
    shape({}, { salt: b64(16).replace(/=+$/, "") }), // unpadded
    shape({}, { salt: ` ${b64(16)}` }),
    shape({ iv: "not base64!" }),
    null,
    "text",
  ];
  for (const file of bad) assert.throws(() => checkVaultFile(file), /Not a KAPEVault file/, JSON.stringify(file)?.slice(0, 80));
});

test("parseVaultFile reads text or bytes, and says null for anything that is not a vault file", () => {
  const text = JSON.stringify(shape());
  assert.deepEqual(parseVaultFile(text), shape());
  assert.deepEqual(parseVaultFile(new TextEncoder().encode(text)), shape());
  for (const other of ["not json", "{}", JSON.stringify(shape({ version: 2 })), "", null, undefined]) assert.equal(parseVaultFile(other), null, String(other));
});

test("parseVaultFile refuses bytes that start with a UTF-8 BOM, as it refuses the same text", () => {
  const bytes = new TextEncoder().encode(JSON.stringify(shape()));
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
  assert.equal(parseVaultFile(withBom), null);
  assert.equal(parseVaultFile(`\uFEFF${JSON.stringify(shape())}`), null);
});

test("a file header from a newer KAPEVault is refused as newer, not as damaged", () => {
  assert.equal(READER_VERSION, 1);
  const message = "This vault was saved by a newer KAPEVault. Update this app to open it.";
  // A later header version brings its own KDF settings: the version decides first, so the stronger
  // parameters are never read as a damaged file.
  for (const file of [shape({ version: 2 }), shape({ version: 99 }), shape({ version: 2, format: "bovault" }), shape({ version: 2 }, { N: 2 ** 20, r: 16 })]) {
    assert.throws(() => checkVaultFile(file), (e) => e instanceof NewerVaultError && e.name === "NewerVaultError" && e.message === message);
    assert.equal(parseVaultFile(JSON.stringify(file)), null, "parseVaultFile never hands out a file this app cannot read");
    assert.equal(isNewerVaultFile(JSON.stringify(file)), true);
    assert.equal(isNewerVaultFile(new TextEncoder().encode(JSON.stringify(file))), true);
  }
  // Anything else keeps today's verdict: damaged.
  for (const file of [shape({ version: "2" }), shape({ version: 0 }), shape({ version: null }), shape({ version: undefined }), shape({ version: 2, format: "other" }), "text", null]) {
    assert.throws(() => checkVaultFile(file), (e) => !(e instanceof NewerVaultError) && /Not a KAPEVault file/.test(e.message), JSON.stringify(file)?.slice(0, 60));
    assert.equal(isNewerVaultFile(JSON.stringify(file)), false);
  }
  assert.equal(isNewerVaultFile(JSON.stringify(shape())), false);
  assert.equal(isNewerVaultFile("not json"), false);
  assert.equal(isNewerVaultFile(null), false);
});
