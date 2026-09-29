// The phone's vault file code against the PC's (electron/vault-crypto.cjs): a vault written on either
// side opens on the other, byte-compatible, and both refuse the same planted files.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { sha256Hex } from "./sha256.ts";
import { scrypt } from "./scrypt.ts";
import { checkVaultFile, createKey, encryptWithKey, openFile, openFileWithKey, parseVaultFile } from "./vault-file.ts";

const pc = createRequire(import.meta.url)("../../../../electron/vault-crypto.cjs");
const MASTER = "Lantern-Mango-Quiet-47 ñ"; // NFC matters: "ñ" typed as n + combining tilde must open it too
const DATA = { spaces: [{ id: "s1", name: "Personal", kind: "personal" }], entries: [{ id: "e1", kind: "login", title: "Mail", password: "p@ss wörd" }], sync: { v: 1 } };

test("sha256Hex matches Node's crypto for empty, ASCII, multi-block and non-ASCII text", () => {
  const long = "x".repeat(1000) + "é".repeat(77);
  for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), long, "密码 🔐"]) {
    assert.equal(sha256Hex(text), crypto.createHash("sha256").update(text, "utf8").digest("hex"), JSON.stringify(text.slice(0, 20)));
  }
});

test("scrypt matches Node's crypto.scrypt (RFC 7914 settings and the vault's N = 2^17)", async () => {
  const cases = [
    { pw: "password", salt: "NaCl", N: 1024, r: 8, p: 16, len: 64 },
    { pw: MASTER, salt: "0123456789abcdef", N: 2 ** 17, r: 8, p: 1, len: 32 },
  ];
  for (const c of cases) {
    const ours = await scrypt(new TextEncoder().encode(c.pw), new TextEncoder().encode(c.salt), c, c.len);
    const node = crypto.scryptSync(c.pw, c.salt, c.len, { N: c.N, r: c.r, p: c.p, maxmem: 512 * 1024 * 1024 });
    assert.equal(Buffer.from(ours).toString("hex"), node.toString("hex"), `N=${c.N} p=${c.p}`);
  }
});

test("a vault the phone writes opens with the PC's vault-crypto, and the wrong password fails there", async () => {
  const { key, kdf, salt, raw } = await createKey(MASTER);
  const file = JSON.parse(JSON.stringify(await encryptWithKey(key, kdf, salt, DATA)));
  pc.checkVaultFile(file);
  const opened = await pc.openFile(MASTER.normalize("NFD"), file);
  assert.deepEqual(opened.data, DATA);
  assert.equal(Buffer.from(opened.key).toString("hex"), Buffer.from(raw).toString("hex"), "same key from the same password + salt");
  assert.equal(await pc.openFile("wrong password", file), null);
});

test("a vault the PC writes opens on the phone, by password and by key, and the wrong one fails", async () => {
  const { key, kdf, salt } = await pc.createKey(MASTER);
  const file = JSON.parse(JSON.stringify(pc.encryptWithKey(key, kdf, salt, DATA)));
  const opened = await openFile(MASTER.normalize("NFD"), file);
  assert.deepEqual(opened.data, DATA);
  assert.deepEqual(opened.kdf, { name: "scrypt", N: 2 ** 17, r: 8, p: 1 });
  assert.equal(Buffer.from(opened.salt).toString("base64"), file.kdf.salt);
  assert.deepEqual((await openFileWithKey(new Uint8Array(key), file)).data, DATA);
  assert.equal(await openFile("wrong password", file), null);
  assert.equal(await openFileWithKey(new Uint8Array(32), file), null);
});

test("an altered ciphertext or tag fails the GCM check instead of decoding garbage", async () => {
  const { key, kdf, salt, raw } = await createKey(MASTER);
  const file = await encryptWithKey(key, kdf, salt, DATA);
  const flip = (b64) => {
    const bytes = Buffer.from(b64, "base64");
    bytes[0] ^= 1;
    return bytes.toString("base64");
  };
  assert.equal(await openFileWithKey(raw, { ...file, data: flip(file.data) }), null);
  assert.equal(await openFileWithKey(raw, { ...file, tag: flip(file.tag) }), null);
});

test("the header check refuses what the PC's refuses, before any key derivation", async () => {
  const { key, kdf, salt } = await pc.createKey(MASTER);
  const good = pc.encryptWithKey(key, kdf, salt, DATA);
  const planted = [
    { ...good, kdf: { ...good.kdf, p: 2 ** 20 } },
    { ...good, kdf: { ...good.kdf, r: 1000 } },
    { ...good, kdf: { ...good.kdf, N: 2 ** 18 } },
    { ...good, kdf: { ...good.kdf, N: 3 * 2 ** 14 } },
    { ...good, kdf: { ...good.kdf, name: "pbkdf2" } },
    { ...good, version: 2 },
    { ...good, format: "other" },
    { ...good, iv: Buffer.alloc(8).toString("base64") },
    { ...good, tag: Buffer.alloc(8).toString("base64") },
    { ...good, data: 5 },
    null,
  ];
  for (const file of planted) {
    assert.throws(() => pc.checkVaultFile(file));
    assert.throws(() => checkVaultFile(file), /Not a KAPEVault file/);
    await assert.rejects(openFile(MASTER, file), /Not a KAPEVault file/);
  }
  assert.doesNotThrow(() => checkVaultFile({ ...good, format: "bovault" }), "pre-rename files still open");
  assert.equal(parseVaultFile("not json"), null);
  assert.equal(parseVaultFile(null), null);
  assert.ok(parseVaultFile(JSON.stringify(good)));
});
