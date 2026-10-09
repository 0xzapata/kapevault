// AES-GCM under one key breaks if a nonce ever repeats (it leaks the XOR of two plaintexts and lets the
// tag be forged). Every save draws a fresh random IV (FORMAT.md); a change that hoisted, cached or mocked
// it would keep every other test green, so this one counts.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createVaultSession } = require("./vault-session.cjs");
const { createKey, encryptWithKey } = require("./vault-crypto.cjs");

const SAVES = 1000;
const SESSION_SAVES = 150; // each one is an fsynced atomic write: the volume is the direct calls below

test(`${SESSION_SAVES} saves through the session's real save path each carry their own IV and ciphertext`, async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-iv-")), "vault.kapevault");
  const session = createVaultSession(file);
  const personal = (await session.create("mock kettle harbor pass orbit gazelle")).vault.spaces[0].id;
  const ivs = new Set();
  const bodies = new Set();
  const remember = () => {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    ivs.add(saved.iv);
    bodies.add(saved.data);
    return saved;
  };
  remember();
  const { id } = session.saveEntry({ kind: "note", spaceId: personal, title: "Mock", body: "same" });
  for (let i = 0; i < SESSION_SAVES - 2; i++) {
    session.saveEntry({ kind: "note", id, spaceId: personal, title: "Mock", body: "same" }); // the same data every time
    const saved = remember();
    assert.equal(Buffer.from(saved.iv, "base64").length, 12);
  }
  assert.equal(ivs.size, SESSION_SAVES - 1, "no IV repeated");
  assert.equal(bodies.size, SESSION_SAVES - 1, "no two saves wrote the same ciphertext");
  assert.equal(ivs.size, bodies.size);
});

test("the same data encrypted twice under one key gives different IVs and different ciphertext", async () => {
  const { key, kdf, salt } = await createKey("mock kettle harbor pass orbit gazelle");
  const data = { spaces: [], entries: [] };
  const seen = new Set();
  for (let i = 0; i < SAVES; i++) seen.add(encryptWithKey(key, kdf, salt, data).iv);
  assert.equal(seen.size, SAVES);
  const a = encryptWithKey(key, kdf, salt, data);
  const b = encryptWithKey(key, kdf, salt, data);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
  assert.notEqual(a.tag, b.tag);
});
