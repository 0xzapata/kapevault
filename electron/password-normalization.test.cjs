// The master password is NFC-normalised before scrypt (FORMAT.md), so the same typed password opens the
// vault whichever way a keyboard or a paste composed it. The golden vaults' password is plain ASCII, where
// every normalisation form is the identity, so only a non-ASCII password pins the rule. The file here is
// made with node:crypto alone (no KAPEVault code) from the NFC form; the PC and the Forever Opener must
// open it with the password typed decomposed, and must refuse the NFKC form, which is another password.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { openFile } = require("./vault-crypto.cjs");
const { openVault } = require("./opener/opener-crypto.cjs");

// "e" + combining acute (NFC joins them into one letter) and a ligature (NFKC would split it into "fi").
const TYPED = "mock café ﬁ kettle harbor orbit";

function independentFile(password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ spaces: [], entries: [] }), "utf8"), cipher.final()]);
  return {
    format: "kapevault",
    version: 1,
    kdf: { name: "scrypt", N: 2 ** 17, r: 8, p: 1, salt: salt.toString("base64") },
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: body.toString("base64"),
  };
}

test("a non-ASCII master password opens a file made from its NFC form, typed decomposed (PC and Opener)", async () => {
  const file = independentFile(TYPED.normalize("NFC"));
  assert.notEqual(TYPED, TYPED.normalize("NFC"), "the test password really is decomposed");
  assert.deepEqual((await openFile(TYPED, file)).data, { spaces: [], entries: [] });
  assert.deepEqual(await openVault(file, TYPED), { spaces: [], entries: [] });
});

test("the NFKC form of that password is another password (PC and Opener)", async () => {
  const file = independentFile(TYPED.normalize("NFC"));
  assert.notEqual(TYPED.normalize("NFKC"), TYPED.normalize("NFC"));
  assert.equal(await openFile(TYPED.normalize("NFKC"), file), null);
  assert.equal(await openVault(file, TYPED.normalize("NFKC")), null);
});
