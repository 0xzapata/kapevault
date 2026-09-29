import test from "node:test";
import assert from "node:assert/strict";
import { parseTotp } from "./totp.js";

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

test("raw spaced lowercase secret with padding gets defaults", () => {
  const secret = base32(SEEDS.SHA1);
  const spaced = `  ${secret.toLowerCase().match(/.{1,4}/g).join(" ")}==  `;
  const out = parseTotp(spaced);
  assert.equal(out.secret, secret);
  assert.equal(out.algorithm, "SHA1");
  assert.equal(out.digits, 6);
  assert.equal(out.period, 30);
  assert.equal(out.issuer, "");
  assert.equal(out.account, "");
  assert.equal(out.uri, `otpauth://totp/KAPEVault?secret=${secret}&algorithm=SHA1&digits=6&period=30`);
  assert.equal(parseTotp(secret.replace(/(.{4})/g, "$1-")).secret, secret);
});

test("URI with issuer in label and param, lowercase algorithm", () => {
  const secret = base32(SEEDS.SHA256);
  const out = parseTotp(`otpauth://totp/GitHub%3Ame%40example.com?secret=${secret.toLowerCase()}&issuer=GitHub&algorithm=sha256`);
  assert.equal(out.issuer, "GitHub");
  assert.equal(out.account, "me@example.com");
  assert.equal(out.algorithm, "SHA256");
  assert.equal(out.digits, 6);
  assert.equal(out.period, 30);
  assert.equal(out.uri, `otpauth://totp/GitHub%3Ame%40example.com?secret=${secret}&issuer=GitHub&algorithm=SHA256&digits=6&period=30`);

  // Unencoded colon in the label, issuer only from the label.
  const bare = parseTotp(`otpauth://totp/Acme:bob?secret=${secret}`);
  assert.equal(bare.issuer, "Acme");
  assert.equal(bare.account, "bob");

  // The issuer param wins over the label prefix.
  assert.equal(parseTotp(`otpauth://totp/Old:bob?secret=${secret}&issuer=New`).issuer, "New");
});

test("normalized uri round-trips to the same result", () => {
  const secret = base32(SEEDS.SHA512);
  for (const input of [
    `otpauth://totp/Acme%20Co:jane%20doe?secret=${secret}&issuer=Acme%20Co&algorithm=SHA512&digits=8&period=60`,
    `otpauth://totp/Acme?secret=${secret}&issuer=Acme`,
    secret,
  ]) {
    const first = parseTotp(input);
    assert.deepEqual(parseTotp(first.uri).uri, first.uri);
    if (input !== secret) assert.deepEqual(parseTotp(first.uri), first);
  }
});

test("bad input is rejected with the UI messages", () => {
  const secret = base32(SEEDS.SHA1);
  assert.throws(() => parseTotp(`otpauth://hotp/Acme?secret=${secret}&counter=1`), { message: "Counter-based (HOTP) codes are not supported." });
  assert.throws(() => parseTotp("otpauth-migration://offline?data=abc"), { message: /Google Authenticator export codes/ });
  assert.throws(() => parseTotp("not a key 1890!"), { message: "That is not a valid 2FA setup key." });
  assert.throws(() => parseTotp("   "), { message: "That is not a valid 2FA setup key." });
  assert.throws(() => parseTotp("otpauth://totp/Acme?issuer=Acme"), { message: "That is not a valid 2FA setup key." });
  assert.throws(() => parseTotp("JBSWY3DPEHPK3PX"), { message: "That setup key is too short." });
  assert.throws(() => parseTotp(`otpauth://totp/A?secret=${secret}&digits=9`), { message: "Unsupported 2FA settings." });
  assert.throws(() => parseTotp(`otpauth://totp/A?secret=${secret}&algorithm=MD5`), { message: "Unsupported 2FA settings." });
  assert.throws(() => parseTotp(`otpauth://totp/A?secret=${secret}&period=10`), { message: "Unsupported 2FA settings." });
  assert.throws(() => parseTotp(`otpauth://totp/A?secret=${secret}&period=121`), { message: "Unsupported 2FA settings." });
});
