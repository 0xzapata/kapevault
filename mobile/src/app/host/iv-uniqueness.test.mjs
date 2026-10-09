// The phone's half of electron/iv-uniqueness.test.cjs: every encryptWithKey draws a fresh IV, so one key
// never seals two files with the same nonce.
import test from "node:test";
import assert from "node:assert/strict";
import { createKey, encryptWithKey } from "./vault-file.ts";

const SAVES = 1000;

test(`${SAVES} saves of the same data under one key each carry their own IV and ciphertext`, async () => {
  const { key, kdf, salt } = await createKey("mock kettle harbor pass orbit gazelle");
  const data = { spaces: [], entries: [] };
  const ivs = new Set();
  const bodies = new Set();
  const tags = new Set();
  for (let i = 0; i < SAVES; i++) {
    const file = await encryptWithKey(key, kdf, salt, data);
    assert.equal(atob(file.iv).length, 12);
    ivs.add(file.iv);
    bodies.add(file.data);
    tags.add(file.tag);
  }
  assert.equal(ivs.size, SAVES, "no IV repeated");
  assert.equal(bodies.size, SAVES, "no two saves wrote the same ciphertext");
  assert.equal(tags.size, SAVES);
});
