// A synced or restored entry can lack a title (core cleanVault does not require one) or an updatedAt:
// the list's sort and the search score treat a missing or non-string one as "" instead of throwing (audit run-1 4.3).
import test from "node:test";
import assert from "node:assert/strict";
import { byTitle, sortEntries, titleScore } from "./search.ts";

const entry = (id, extra) => ({ id, kind: "login", spaceId: "mock-space", notes: "", tags: [], ...extra });
const list = [entry("a", { title: "Zed", updatedAt: "2026-01-01" }), entry("b", { title: 5 }), entry("c", { updatedAt: 7 }), entry("d", { title: "Alpha", updatedAt: "2026-02-01" })];

test("every sort and both list orders survive an entry with no title or a non-string one", () => {
  for (const sort of ["title", "recent", "edited"]) {
    for (const order of [list, [...list].reverse()]) {
      assert.doesNotThrow(() => sortEntries(order, sort), sort);
      assert.equal(sortEntries(order, sort).length, 4);
    }
  }
});

test("a title-less entry sorts as the empty title, first", () => {
  assert.equal(byTitle(entry("x", {}), entry("y", { title: "Alpha" })) < 0, true);
  assert.deepEqual(sortEntries(list, "title").map((e) => e.id), ["b", "c", "d", "a"]);
});

test("titleScore reads a missing or non-string title as empty", () => {
  assert.equal(titleScore(undefined, ["x"], "x"), 0);
  assert.equal(titleScore(5, ["x"], "x"), 0);
  assert.equal(titleScore("Xylo", ["x"], "x"), 3);
});
