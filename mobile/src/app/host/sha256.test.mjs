// sha256.ts against the FIPS 180 / NIST example messages and against Node's own crypto on random text.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sha256Hex } from "./sha256.ts";

const VECTORS = [
  ["the empty string", "", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "the 448-bit message (the padding spills into a second block)",
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  ],
  [
    "the 896-bit message",
    "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
    "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
  ],
  ["one million 'a'", "a".repeat(1_000_000), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"],
];

for (const [name, text, digest] of VECTORS) {
  test(`FIPS 180 vector: ${name}`, () => assert.equal(sha256Hex(text), digest));
}

test("the lengths around a block boundary (55, 56, 63, 64, 65 bytes) match Node", () => {
  for (const n of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129]) {
    const text = "x".repeat(n);
    assert.equal(sha256Hex(text), crypto.createHash("sha256").update(text, "utf8").digest("hex"), `${n} bytes`);
  }
});

test("matches Node's crypto on random text, multi-byte characters included", () => {
  let seed = 180; // a fixed seed: a failure repeats
  const rand = (n) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n);
  // ASCII, accented letters, CJK and an emoji (a surrogate pair): 1 to 4 bytes per character.
  const alphabet = [..."abcXYZ 0189!@#", "é", "ñ", "日", "本", "语", "\u{1F600}"];
  for (let i = 0; i < 200; i++) {
    const text = Array.from({ length: rand(400) }, () => alphabet[rand(alphabet.length)]).join("");
    assert.equal(sha256Hex(text), crypto.createHash("sha256").update(text, "utf8").digest("hex"), JSON.stringify(text));
  }
});
