// Run with `npm test` (Node strips the types). Health issue wording: an expiring ID is not a key.
import test from "node:test";
import assert from "node:assert/strict";
import { issueAdvice, issueLabel } from "./issues.ts";
import type { Issue } from "../types";

const expiring: Issue = { type: "expiring", days: 10 };
const expired: Issue = { type: "expired", days: 3 };

test("an expiring or expired thing is renewed where it was issued, not made on a website", () => {
  for (const issue of [expiring, expired]) {
    assert.equal(issueAdvice(issue, "thing"), "Renew it where it was issued, then update the date here.");
    assert.doesNotMatch(issueAdvice(issue, "thing"), /key|website|password/i);
  }
});

test("an API key keeps its own advice", () => {
  assert.equal(issueAdvice(expired, "key"), "Create a new key where this one was issued and save it here.");
  assert.equal(issueAdvice(expiring, "key"), "Create a replacement before it stops working, then update this item.");
});

test("the label is the same whatever the kind", () => {
  assert.equal(issueLabel(expiring), "Expires in 10 days");
  assert.equal(issueLabel(expired), "Expired 3 days ago");
  assert.equal(issueLabel({ type: "expired", days: 0 }), "Expired today");
});

test("password issues do not depend on the kind", () => {
  assert.equal(issueAdvice({ type: "weak" }, "login"), "This password is easy to guess. Change it on the site, then save the new one here.");
});
