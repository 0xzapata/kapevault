import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, max, tick, tooFarAhead, isHlc, MAX_AHEAD_MS } from "./hlc.js";
import { groupOf, splitGroups } from "./groups.js";

test("a clock orders by time, then counter, then device", () => {
  assert.ok(compare([2, 0, "a"], [1, 9, "z"]) > 0);
  assert.ok(compare([1, 2, "a"], [1, 1, "z"]) > 0);
  assert.ok(compare([1, 1, "b"], [1, 1, "a"]) > 0);
  assert.equal(compare([1, 1, "a"], [1, 1, "a"]), 0);
  assert.deepEqual(max([1, 1, "a"], [1, 2, "a"]), [1, 2, "a"]);
});

test("a local stamp never runs backwards, even when the wall clock does", () => {
  assert.deepEqual(tick([100, 3, "pc"], 200, "pc"), [200, 0, "pc"]);
  assert.deepEqual(tick([300, 3, "pc"], 200, "phone"), [300, 4, "phone"]);
  assert.deepEqual(tick([300, 3, "pc"], 300, "pc"), [300, 4, "pc"]);
});

test("a clock more than a day ahead is refused; a well-formed clock is checked", () => {
  assert.equal(tooFarAhead([1000 + MAX_AHEAD_MS, 0, "x"], 1000), false);
  assert.equal(tooFarAhead([1001 + MAX_AHEAD_MS, 0, "x"], 1000), true);
  assert.equal(isHlc([1, 0, "pc"]), true);
  for (const bad of [null, [1, 0], [-1, 0, "a"], [1.5, 0, "a"], [1, 0, 3], "x"]) assert.equal(isHlc(bad), false);
});

test("fields fall into their groups; id and lastUsedAt are in none; unknown fields are core", () => {
  assert.equal(groupOf("login", "password"), "pw");
  assert.equal(groupOf("login", "passwordChangedAt"), "pw");
  assert.equal(groupOf("device", "wifiPassword"), "wifi");
  assert.equal(groupOf("note", "favorite"), "fav");
  assert.equal(groupOf("thing", "spaceId"), "space");
  assert.equal(groupOf("login", "lastUsedAt"), null);
  assert.equal(groupOf("login", "id"), null);
  assert.equal(groupOf("link", "fieldFromTheFuture"), "core");
});

test("an entry splits into its groups, leaving undefined fields out", () => {
  const groups = splitGroups({ id: "1", kind: "login", title: "Mock", spaceId: "s", favorite: false, password: "pw", totp: undefined, lastUsedAt: 5 });
  assert.deepEqual(groups, { core: { kind: "login", title: "Mock" }, space: { spaceId: "s" }, fav: { favorite: false }, pw: { password: "pw" } });
});
