// Run with `npm test` (Node strips the types). Guards length, class coverage, and randomness quality.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GENERATOR, generatePassword, type GeneratorOptions } from "./generate-password.ts";

const LOWER = /[a-z]/;
const UPPER = /[A-Z]/;
const DIGIT = /[0-9]/;
const SYMBOL = /[!@#$%^&*\-_=+?]/;
const AMBIGUOUS = /[0Oo1lI|`'"]/;

const opts = (over: Partial<GeneratorOptions>): GeneratorOptions => ({ ...DEFAULT_GENERATOR, ...over });
const runs = (o: GeneratorOptions, n = 200) => Array.from({ length: n }, () => generatePassword(o));

test("length is clamped to 8-64", () => {
  assert.equal(generatePassword(opts({ length: 4 })).length, 8);
  assert.equal(generatePassword(opts({ length: 100 })).length, 64);
  assert.equal(generatePassword(opts({ length: 20 })).length, 20);
});

test("every enabled class appears in every password", () => {
  for (const pw of runs(opts({ length: 8 }))) {
    for (const re of [LOWER, UPPER, DIGIT, SYMBOL]) assert.match(pw, re, pw);
  }
});

test("disabled classes never appear", () => {
  for (const pw of runs(opts({ upper: false, symbols: false }))) {
    assert.match(pw, /^[a-z0-9]+$/, pw);
    assert.match(pw, LOWER);
    assert.match(pw, DIGIT);
  }
});

test("avoidAmbiguous drops look-alikes", () => {
  for (const pw of runs(opts({ length: 64, avoidAmbiguous: true }))) {
    assert.doesNotMatch(pw, AMBIGUOUS, pw);
  }
});

test("all classes off falls back to lowercase", () => {
  const off = opts({ lower: false, upper: false, digits: false, symbols: false });
  for (const pw of runs(off)) assert.match(pw, /^[a-z]{20}$/, pw);
});

test("digits are roughly uniform", () => {
  const digitsOnly = opts({ length: 64, lower: false, upper: false, symbols: false });
  const counts = new Array(10).fill(0);
  let total = 0;
  for (const pw of runs(digitsOnly, 320)) {
    for (const c of pw) counts[Number(c)]++;
    total += pw.length;
  }
  const expected = total / 10;
  for (const [d, n] of counts.entries()) {
    assert.ok(Math.abs(n - expected) / expected < 0.15, `digit ${d}: ${n} vs ${expected}`);
  }
});

test("two calls differ", () => {
  assert.notEqual(generatePassword(DEFAULT_GENERATOR), generatePassword(DEFAULT_GENERATOR));
});
