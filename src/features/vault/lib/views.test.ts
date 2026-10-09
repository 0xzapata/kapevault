// Run with `npm test` (Node strips the types). The smart lists table.
import test from "node:test";
import assert from "node:assert/strict";
import { VIEWS, viewOf } from "./views.ts";
import { matchesView } from "./filter-entries.ts";
import { device, id, key, link, login, note, thing } from "./test-entries.ts";
import type { ViewFilter } from "../types";

test("one row per view, each id once", () => {
  const ids = VIEWS.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), ["all", "closed", "closing", "device", "favorites", "id", "key", "link", "login", "note", "security", "thing", "totp", "trash"]);
});

test("only the lists that are often empty hide while they hold nothing", () => {
  assert.deepEqual(VIEWS.filter((v) => v.hideWhenEmpty).map((v) => v.id), ["thing", "device", "id", "closing", "closed", "trash"]);
});

test("viewOf finds a view, and falls back to All items", () => {
  assert.equal(viewOf("note").heading, "Secure notes");
  assert.equal(viewOf("note").label, "Notes");
  assert.equal(viewOf("nope" as ViewFilter).id, "all");
});

test("a kind's own list makes that kind, and holds it", () => {
  for (const e of [note(), key(), link(), thing(), device(), id()]) {
    const view = viewOf(e.kind);
    assert.equal(view.newKind, e.kind);
    assert.equal(matchesView(e, view.id), true);
  }
  assert.equal(viewOf("login").newKind, undefined); // a new item defaults to a login anyway
  assert.equal(matchesView(login(), "login"), true);
});
