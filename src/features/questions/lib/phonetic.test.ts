// Run with `npm test` (Node strips the types). The hotline spelling, character by character.
import test from "node:test";
import assert from "node:assert/strict";
import { spell, spellingLine } from "./phonetic.ts";

test("letters are NATO words, capitals are called out", () => {
  assert.deepEqual(spell("Ve"), [
    { char: "V", say: "capital V as in Victor", hint: "capital, as in Victor" },
    { char: "e", say: "E as in Echo", hint: "as in Echo" },
  ]);
  assert.equal(spellingLine("ajx"), "A as in Alpha, J as in Juliet, X as in X-ray");
});

test("digits are words and spaces are said", () => {
  assert.equal(spellingLine("velvet 38"), "V as in Victor, E as in Echo, L as in Lima, V as in Victor, E as in Echo, T as in Tango, space, three, eight");
  assert.equal(spellingLine("0 9"), "zero, space, nine");
});

test("punctuation is named", () => {
  assert.equal(spellingLine("a-b.c'd"), "A as in Alpha, hyphen, B as in Bravo, period, C as in Charlie, apostrophe, D as in Delta");
  assert.equal(spellingLine("@&/"), "at sign, ampersand, slash");
});

test("a letter with a mark is said as its plain letter with a warning; anything else as itself", () => {
  assert.equal(spellingLine("ñ"), "N with a mark, as in November");
  assert.deepEqual(spell("É")[0], { char: "É", say: "capital E with a mark, as in Echo", hint: "capital with a mark, as in Echo" });
  assert.deepEqual(spell("€"), [{ char: "€", say: "€", hint: "" }]);
  assert.deepEqual(spell("3 "), [{ char: "3", say: "three", hint: "three" }, { char: " ", say: "space", hint: "space" }]);
  assert.equal(spell("a😀b").length, 3, "an emoji stays one character");
});

test("an empty answer spells nothing", () => {
  assert.deepEqual(spell(""), []);
  assert.equal(spellingLine(""), "");
});
