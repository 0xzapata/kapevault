// The phone's half of electron/password-normalization.test.cjs: the master password is NFC-normalised
// before scrypt, so a non-ASCII password typed decomposed opens a file made from its NFC form (built here
// with node:crypto alone), and its NFKC form is another password. The golden vaults' password is ASCII,
// where every normalisation form is the identity.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openFile, parseVaultFile } from "./vault-file.ts";

// "e" + combining acute (NFC joins them into one letter) and a ligature (NFKC would split it into "fi").
const TYPED = "mock café ﬁ kettle harbor orbit";

function independentFile(password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ spaces: [], entries: [] }), "utf8"), cipher.final()]);
  return parseVaultFile(
    JSON.stringify({
      format: "kapevault",
      version: 1,
      kdf: { name: "scrypt", N: 2 ** 17, r: 8, p: 1, salt: salt.toString("base64") },
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: body.toString("base64"),
    }),
  );
}

test("a non-ASCII master password opens a file made from its NFC form, typed decomposed", async () => {
  const file = independentFile(TYPED.normalize("NFC"));
  assert.notEqual(file, null);
  assert.notEqual(TYPED, TYPED.normalize("NFC"), "the test password really is decomposed");
  assert.deepEqual((await openFile(TYPED, file)).data, { spaces: [], entries: [] });
});

test("the NFKC form of that password is another password", async () => {
  const file = independentFile(TYPED.normalize("NFC"));
  assert.notEqual(TYPED.normalize("NFKC"), TYPED.normalize("NFC"));
  assert.equal(await openFile(TYPED.normalize("NFKC"), file), null);
});
