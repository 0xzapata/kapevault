// The decrypted vault is the most sensitive buffer the app ever holds (KeePass CVE-2023-32784 was a
// secret left behind in memory). decryptWithKey must not leave plaintext in any Buffer it made: the
// decipher's own chunks and the joined copy. These tests spy on every Buffer the decipher hands out.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createKey, openFile, openFileWithKey, encryptWithKey } = require("./vault-crypto.cjs");
const { newVaultData } = require("../core/index.js");

const MASTER = "mock kettle harbor pass orbit gazelle";
const CANARY = "mock-canary-entry-secret-7731";

// Runs fn while recording every Buffer that createDecipheriv's update()/final() return, and every
// Buffer.concat result built from them. Returns what each one held at the time, and the live buffers.
async function spyOnDecryption(fn) {
  const live = [];
  const realCreate = crypto.createDecipheriv;
  const realConcat = Buffer.concat;
  crypto.createDecipheriv = (...args) => {
    const decipher = realCreate.apply(crypto, args);
    for (const method of ["update", "final"]) {
      const real = decipher[method].bind(decipher);
      decipher[method] = (...a) => {
        const out = real(...a);
        live.push({ buffer: out, held: Buffer.from(out) });
        return out;
      };
    }
    return decipher;
  };
  Buffer.concat = (list, total) => {
    const out = realConcat(list, total);
    if (list.some((b) => live.some((l) => l.buffer === b))) live.push({ buffer: out, held: Buffer.from(out) });
    return out;
  };
  try {
    return { result: await fn(), live };
  } finally {
    crypto.createDecipheriv = realCreate;
    Buffer.concat = realConcat;
  }
}

async function savedVault() {
  const vault = newVaultData();
  vault.entries.push({ id: "e1", kind: "login", spaceId: vault.spaces[0].id, title: "Mock Bank", username: "mock", password: CANARY, url: "", tags: [] });
  const { key, kdf, salt } = await createKey(MASTER);
  return { key, file: encryptWithKey(key, kdf, salt, vault) };
}

test("opening the vault leaves no plaintext in any buffer the decipher made", async () => {
  const { key, file } = await savedVault();
  const { result, live } = await spyOnDecryption(() => openFileWithKey(Buffer.from(key), file));
  assert.ok(result, "the vault opened");
  const sawPlain = live.filter((l) => l.held.includes(CANARY));
  assert.ok(sawPlain.length >= 2, `the spy saw the plaintext in ${sawPlain.length} buffers (decipher chunk + joined copy)`);
  for (const { buffer } of live) assert.ok(buffer.every((b) => b === 0), "a buffer that held the vault was zeroed");
});

test("a wrong key leaves nothing behind either", async () => {
  const { file } = await savedVault();
  const { result, live } = await spyOnDecryption(() => openFileWithKey(crypto.randomBytes(32), file));
  assert.equal(result, null);
  for (const { buffer } of live) assert.ok(buffer.every((b) => b === 0), "the unauthenticated chunk was zeroed");
});

test("openFile (master password) wipes the same way", async () => {
  const { file } = await savedVault();
  const { result, live } = await spyOnDecryption(() => openFile(MASTER, file));
  assert.ok(result && result.data.entries[0].password === CANARY);
  assert.ok(live.length >= 2);
  for (const { buffer } of live) assert.ok(buffer.every((b) => b === 0));
});
