// Run with `npm test` (Node strips the types). The tile pickers' arrow keys.
import test from "node:test";
import assert from "node:assert/strict";
import { nextTile } from "./use-roving-tiles.ts";

test("arrows step one tile, right and down forward, left and up back", () => {
  assert.equal(nextTile("ArrowRight", 2, 8), 3);
  assert.equal(nextTile("ArrowDown", 2, 8), 3);
  assert.equal(nextTile("ArrowLeft", 2, 8), 1);
  assert.equal(nextTile("ArrowUp", 2, 8), 1);
});

test("arrows wrap round at both ends", () => {
  assert.equal(nextTile("ArrowRight", 7, 8), 0);
  assert.equal(nextTile("ArrowLeft", 0, 8), 7);
  assert.equal(nextTile("ArrowRight", 0, 1), 0);
});

test("Home and End jump to the first and last tile", () => {
  assert.equal(nextTile("Home", 5, 8), 0);
  assert.equal(nextTile("End", 1, 8), 7);
});

test("any other key is not a move", () => {
  for (const key of ["Tab", "Enter", " ", "a", "Escape"]) assert.equal(nextTile(key, 3, 8), null);
});
