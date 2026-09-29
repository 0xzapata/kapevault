const test = require("node:test");
const assert = require("node:assert/strict");
const { totpCode } = require("./totp.cjs");

// Tiny RFC 4648 encoder so the RFC seeds can be fed in as otpauth URIs.
function base32(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of Buffer.from(text, "ascii")) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}

const SEEDS = {
  SHA1: "12345678901234567890",
  SHA256: "12345678901234567890123456789012",
  SHA512: "1234567890123456789012345678901234567890123456789012345678901234",
};

// RFC 6238 Appendix B: [unix seconds, SHA1, SHA256, SHA512]
const VECTORS = [
  [59, "94287082", "46119246", "90693936"],
  [1111111109, "07081804", "68084774", "25091201"],
  [1111111111, "14050471", "67062674", "99943326"],
  [1234567890, "89005924", "91819424", "93441116"],
  [2000000000, "69279037", "90698825", "38618901"],
  [20000000000, "65353130", "77737706", "47863826"],
];

const rfcUri = (algo) => `otpauth://totp/RFC?secret=${base32(SEEDS[algo])}&algorithm=${algo}&digits=8&period=30`;

test("RFC 6238 Appendix B vectors", () => {
  for (const [seconds, ...codes] of VECTORS) {
    ["SHA1", "SHA256", "SHA512"].forEach((algo, i) => {
      assert.equal(totpCode(rfcUri(algo), seconds * 1000).code, codes[i], `${algo} at ${seconds}`);
    });
  }
});

test("code keeps its leading zero and expiresAt is the step boundary", () => {
  const out = totpCode(rfcUri("SHA1"), 1111111109 * 1000);
  assert.equal(out.code, "07081804");
  assert.equal(out.period, 30);
  assert.equal(out.expiresAt, 1111111110 * 1000);
  // Mid-step and last-ms-of-step both expire at the same boundary.
  assert.equal(totpCode(rfcUri("SHA1"), 45_000).expiresAt, 60_000);
  assert.equal(totpCode(rfcUri("SHA1"), 59_999).expiresAt, 60_000);
  assert.equal(totpCode(rfcUri("SHA1"), 60_000).expiresAt, 90_000);
});
