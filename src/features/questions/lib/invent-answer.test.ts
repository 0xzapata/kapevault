// Run with `npm test` (Node strips the types). Invented answers: shape, word lists, randomness.
import test from "node:test";
import assert from "node:assert/strict";
import { ADJECTIVES, NOUNS, inventAnswer } from "./invent-answer.ts";

const SHAPE = /^([a-z]+) ([a-z]+) ([1-9][0-9])$/;

test("an answer is an adjective, a noun and a two-digit number", () => {
  for (let i = 0; i < 500; i++) {
    const m = SHAPE.exec(inventAnswer());
    assert.ok(m, "shape");
    assert.ok(ADJECTIVES.includes(m[1]) && NOUNS.includes(m[2]));
    assert.notEqual(m[1], m[2], "no word repeated inside one answer");
  }
});

test("the word lists are plain, short, lowercase and never overlap", () => {
  for (const list of [ADJECTIVES, NOUNS]) {
    assert.ok(list.length >= 100, "enough words: with the number, about a million answers");
    assert.equal(new Set(list).size, list.length, "no duplicates");
    for (const w of list) assert.match(w, /^[a-z]{3,8}$/, w);
  }
  assert.equal(ADJECTIVES.filter((w) => NOUNS.includes(w)).length, 0);
  // Words that sound like other words, or that people spell two ways, never make it in.
  for (const w of ["chilly", "sunny", "merry", "calm", "harbor", "castle", "island", "guitar", "timber", "carrot", "cedar", "bold", "rosy", "spicy", "sandal"]) {
    assert.ok(!ADJECTIVES.includes(w) && !NOUNS.includes(w), w);
  }
});

test("answers spread over the lists and the numbers; two in a row never repeat", () => {
  const adjectives = new Set<string>();
  const numbers = new Set<string>();
  let previous = "";
  for (let i = 0; i < 3000; i++) {
    const answer = inventAnswer(previous);
    assert.notEqual(answer, previous);
    const [adj, , num] = answer.split(" ");
    adjectives.add(adj);
    numbers.add(num);
    previous = answer;
  }
  assert.ok(adjectives.size > ADJECTIVES.length * 0.9, `adjectives used: ${adjectives.size}`);
  assert.ok(numbers.size > 85, `numbers used: ${numbers.size}`);
});
