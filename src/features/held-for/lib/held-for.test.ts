// Run with `npm test` (Node strips the types). Held-For: the people list in the sidebar.
import test from "node:test";
import assert from "node:assert/strict";
import { peopleHeldFor, personKey } from "./held-for.ts";
import type { Entry } from "@/features/vault/types";

const entry = (id: string, heldFor?: string) => ({ id, kind: "note", heldFor, hasBody: false, spaceId: "s", title: id, tags: [], favorite: false, notes: "", updatedAt: "2026-09-26", issues: [] }) as Entry;

test("people are grouped by name, any case or spacing, and counted", () => {
  const people = peopleHeldFor([entry("a", "Mock Lola"), entry("b", " mock lola"), entry("c", "Mock Papa"), entry("d")]);
  assert.deepEqual(people, [{ name: "Mock Lola", count: 2 }, { name: "Mock Papa", count: 1 }]);
});

test("sorted A-Z; blank names are nobody", () => {
  assert.deepEqual(peopleHeldFor([entry("a", "Mock Papa"), entry("b", "Mock Lola"), entry("c", "  ")]).map((p) => p.name), ["Mock Lola", "Mock Papa"]);
  assert.deepEqual(peopleHeldFor([entry("a")]), []);
});

test("personKey matches the way main groups hand-back items", () => {
  assert.equal(personKey(" Mock LOLA "), "mock lola");
  assert.equal(personKey(undefined), "");
});
