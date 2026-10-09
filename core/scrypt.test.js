// core/scrypt.js against RFC 7914 section 12 and against Node's own crypto.scrypt. This is the key derivation
// for every phone unlock and every Forever Opener page, so it is checked with published answers, not only with another implementation.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { scrypt } from "./scrypt.js";

const bytes = (text) => new TextEncoder().encode(text);
const hex = (u8) => Buffer.from(u8).toString("hex");

// RFC 7914 section 12, test vectors 1 to 4, dkLen = 64. Vector 4 holds a 1 GiB working buffer for about
// 4 seconds; it is the only one that proves the derivation at a size near the app's N = 2^17.
const RFC = [
  {
    password: "", salt: "", N: 16, r: 1, p: 1,
    dk: "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906",
  },
  {
    password: "password", salt: "NaCl", N: 1024, r: 8, p: 16,
    dk: "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640",
  },
  {
    password: "pleaseletmein", salt: "SodiumChloride", N: 16384, r: 8, p: 1,
    dk: "7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2d5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887",
  },
  {
    password: "pleaseletmein", salt: "SodiumChloride", N: 1048576, r: 8, p: 1,
    dk: "2101cb9b6a511aaeaddbbe09cf70f881ec568d574a2ffd4dabe5ee9820adaa478e56fd8f4ba5d09ffa1c6d927c40f4c337304049e8a952fbcbf45c6fa77a41a4",
  },
];

for (const v of RFC) {
  test(`RFC 7914 vector: scrypt("${v.password}", "${v.salt}", N=${v.N}, r=${v.r}, p=${v.p})`, async () => {
    assert.equal(hex(await scrypt(bytes(v.password), bytes(v.salt), v, 64)), v.dk);
  });
}

test("matches Node's crypto.scrypt on random passwords, salts and parameters", async () => {
  let seed = 7914; // a fixed seed: a failure repeats
  const rand = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let i = 0; i < 12; i++) {
    const password = crypto.randomBytes(rand(40));
    const salt = crypto.randomBytes(rand(40));
    const params = { N: 2 ** (4 + rand(7)), r: 1 + rand(4), p: 1 + rand(3) };
    const keyBytes = 1 + rand(100);
    const want = crypto.scryptSync(password, salt, keyBytes, { ...params, maxmem: 256 * 1024 * 1024 });
    const got = await scrypt(password, salt, params, keyBytes);
    assert.equal(hex(got), want.toString("hex"), `N=${params.N} r=${params.r} p=${params.p} keyBytes=${keyBytes} password=${password.toString("hex")}`);
  }
});

test("the step callback is awaited between chunks, with progress up to the total", async () => {
  const seen = [];
  const N = 2 ** 14; // 2N = 32768 rounds, a pause every 16384
  await scrypt(bytes("pw"), bytes("salt"), { N, r: 1, p: 1 }, 32, async (done, total) => {
    await new Promise((r) => setTimeout(r, 1));
    seen.push([done, total]);
  });
  assert.deepEqual(seen, [[16384, 32768], [32768, 32768]]);
});

test("stepRounds sets how often the hook runs (the Opener asks for every 1024 rounds)", async () => {
  const seen = [];
  await scrypt(bytes("pw"), bytes("salt"), { N: 2 ** 11, r: 1, p: 1 }, 32, (done) => void seen.push(done), 1024);
  assert.deepEqual(seen, [1024, 2048, 3072, 4096]);
});
