import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ratePassword, findIssues, masterProblem } from "./password-health.js";

const TODAY = "2026-09-25";
const STRONG = "p7$Kq!xW2#nV9z&mR4tB";
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

// Calendar date n days from TODAY (negative = before), built in UTC to match the module.
function day(n) {
  return new Date(Date.UTC(2026, 8, 25 + n)).toISOString().slice(0, 10);
}
const login = (id, password, extra = {}) => ({ id, kind: "login", password, updatedAt: TODAY, ...extra });
const key = (id, expires) => ({ id, kind: "key", expires });

test("sanity targets land on the expected scores", () => {
  assert.equal(ratePassword("password1").score, 0);
  assert.equal(ratePassword("Summer2024!").score, 1);
  assert.ok(Math.abs(ratePassword("correcthorse").score - 2) <= 1, "correcthorse around 2");
  assert.equal(ratePassword("k9#Qv2!mZr7x").score, 3);
  assert.equal(ratePassword("Hx4%nq8Lw!zT").score, 3);
  assert.equal(ratePassword(STRONG).score, 4);
  assert.equal(ratePassword("Tr0ub4dor&3").score, 2);
});

test("labels follow the score; empty is None", () => {
  assert.deepEqual(ratePassword(""), { score: 0, label: "None", bits: 0 });
  assert.equal(ratePassword("password1").label, "Very weak");
  assert.equal(ratePassword("Summer2024!").label, "Weak");
  assert.equal(ratePassword("Tr0ub4dor&3").label, "Fair");
  assert.equal(ratePassword("k9#Qv2!mZr7x").label, "Strong");
  assert.equal(ratePassword(STRONG).label, "Very strong");
});

test("common passwords score 0 through leet, case and trailing digits/symbols", () => {
  for (const pw of ["P@ssw0rd!", "l3tm31n", "Dragon2024!!", "TRUSTNO1", "abc123", "Qwerty123$", "1q2w3e4r", "123456"]) {
    assert.equal(ratePassword(pw).score, 0, pw);
  }
});

test("repeats, sequences and keyboard walks cost bits", () => {
  const base = ratePassword("Zq8!hxmbrkpd").bits;
  assert.ok(ratePassword("Zq8!aaaaaaaa").bits < base);
  assert.ok(ratePassword("Zq8!abcdefgh").bits < base);
  assert.ok(ratePassword("Zq8!hgfedcba").bits < base);
  assert.ok(ratePassword("Zq8!zxcvbnmk").bits < base);
  assert.ok(ratePassword("Zq8!87654321").bits < ratePassword("Zq8!83710592").bits);
});

test("a year inside counts as ~4 bits", () => {
  const withYear = ratePassword("Kq8!xz2019").bits;
  const withDigits = ratePassword("Kq8!xz7351").bits;
  assert.ok(withDigits - withYear > 15, `${withDigits} vs ${withYear}`);
});

test("unicode counts by code point and widens the pool", () => {
  assert.equal(ratePassword("🔑").bits, 7, "one emoji is one char at log2(100)");
  assert.ok(ratePassword("k9#Qv2!mZr7é").bits > ratePassword("k9#Qv2!mZr7x").bits);
  assert.equal(ratePassword("日本語のパスワード").score, 2);
});

test("reused counts the OTHER logins sharing a password, case-sensitive", () => {
  const issues = findIssues([login("a", STRONG), login("b", STRONG), login("c", STRONG), login("d", STRONG.toUpperCase())], TODAY, sha256);
  for (const id of ["a", "b", "c"]) assert.deepEqual(issues.get(id), [{ type: "reused", count: 2 }]);
  assert.equal(issues.has("d"), false);
});

test("empty passwords are never reused or weak; other kinds are ignored", () => {
  const issues = findIssues([
    login("a", ""),
    login("b", ""),
    { id: "l", kind: "link", password: STRONG, updatedAt: "2000-01-01" },
    { id: "n", kind: "note", password: STRONG },
    login("c", STRONG),
  ], TODAY, sha256);
  assert.equal(issues.size, 0);
});

test("passwords are not compared across kinds", () => {
  const issues = findIssues([login("a", STRONG), { id: "k", kind: "key", password: STRONG, expires: "" }], TODAY, sha256);
  assert.equal(issues.size, 0);
});

test("weak flags logins scoring 0 or 1, not 2", () => {
  const issues = findIssues([login("a", "password1"), login("b", "Summer2024!"), login("c", "Tr0ub4dor&3")], TODAY, sha256);
  assert.deepEqual(issues.get("a"), [{ type: "weak" }]);
  assert.deepEqual(issues.get("b"), [{ type: "weak" }]);
  assert.equal(issues.has("c"), false);
});

test("old: 365 days is fine, 366 is old", () => {
  const issues = findIssues([
    login("fresh", STRONG, { passwordChangedAt: day(-365) }),
    login("stale", STRONG + "x", { passwordChangedAt: day(-366) }),
  ], TODAY, sha256);
  assert.equal(issues.has("fresh"), false);
  assert.deepEqual(issues.get("stale"), [{ type: "old", days: 366 }]);
});

test("old falls back to updatedAt, and passwordChangedAt wins when present", () => {
  const issues = findIssues([
    login("fallback", STRONG, { updatedAt: day(-400) }),
    login("changed", STRONG + "x", { updatedAt: day(-400), passwordChangedAt: day(-10) }),
  ], TODAY, sha256);
  assert.deepEqual(issues.get("fallback"), [{ type: "old", days: 400 }]);
  assert.equal(issues.has("changed"), false);
});

test("held for someone: no old nag, but weak and reused still count", () => {
  const old = { updatedAt: day(-500), heldFor: "Mock Lola" };
  const issues = findIssues([login("strong", STRONG, old), login("a", "password1", old), login("b", "password1", { updatedAt: day(-500) })], TODAY, sha256);
  assert.equal(issues.has("strong"), false);
  assert.deepEqual(issues.get("a"), [{ type: "reused", count: 1 }, { type: "weak" }]);
  assert.deepEqual(issues.get("b"), [{ type: "reused", count: 1 }, { type: "weak" }, { type: "old", days: 500 }]);
});

test("an account being closed gets no nags, but still counts as a reuse for others", () => {
  const closing = { updatedAt: day(-500) };
  const issues = findIssues([
    login("dormant", "password1", { ...closing, lifecycle: { state: "dormant" } }),
    login("asked", "password1", { ...closing, lifecycle: { state: "deletion-requested", requestedAt: day(-40), followUpAt: day(-10) }, recoveryCodes: { codes: [{ code: "x", used: true }] } }),
    { id: "gone", kind: "login", lifecycle: { state: "gone", goneAt: TODAY } },
    login("active", "password1"),
  ], TODAY, sha256);
  for (const id of ["dormant", "asked", "gone"]) assert.equal(issues.has(id), false, id);
  assert.deepEqual(issues.get("active"), [{ type: "reused", count: 2 }, { type: "weak" }]);
});

test("key expiry boundaries: -1 expired, today/+30 expiring, +31 nothing", () => {
  const issues = findIssues([key("past", day(-1)), key("today", TODAY), key("soon", day(30)), key("later", day(31)), key("none", ""), { id: "missing", kind: "key" }], TODAY, sha256);
  assert.deepEqual(issues.get("past"), [{ type: "expired", days: 1 }]);
  assert.deepEqual(issues.get("today"), [{ type: "expiring", days: 0 }]);
  assert.deepEqual(issues.get("soon"), [{ type: "expiring", days: 30 }]);
  for (const id of ["later", "none", "missing"]) assert.equal(issues.has(id), false, id);
});

test("an ID's expiry (a thing) counts like a key's; a thing without one has no issues", () => {
  const thing = (id, expires) => ({ id, kind: "thing", spot: "blue folder", expires });
  const issues = findIssues([thing("past", day(-1)), thing("soon", day(30)), thing("later", day(31)), { id: "none", kind: "thing", spot: "wallet" }], TODAY, sha256);
  assert.deepEqual(issues.get("past"), [{ type: "expired", days: 1 }]);
  assert.deepEqual(issues.get("soon"), [{ type: "expiring", days: 30 }]);
  for (const id of ["later", "none"]) assert.equal(issues.has(id), false, id);
});

test("date math crosses month and year ends without drift", () => {
  const issues = findIssues([key("k", "2027-01-01"), login("l", STRONG, { updatedAt: "2025-02-28" })], "2026-12-31", sha256);
  assert.deepEqual(issues.get("k"), [{ type: "expiring", days: 1 }]);
  assert.deepEqual(issues.get("l"), [{ type: "old", days: 671 }]);
});

test("issues come in order: reused, weak, old", () => {
  const old = { updatedAt: day(-500) };
  const issues = findIssues([login("a", "password1", old), login("b", "password1", old)], TODAY, sha256);
  assert.deepEqual(issues.get("a"), [{ type: "reused", count: 1 }, { type: "weak" }, { type: "old", days: 500 }]);
});

test("entries without issues are absent from the map", () => {
  const issues = findIssues([login("ok", STRONG), key("k", day(90)), login("bad", "password1")], TODAY, sha256);
  assert.deepEqual([...issues.keys()], ["bad"]);
});

test("backup codes: 2 or fewer unused is an issue, all used says 0; any login, password or not", () => {
  const set = (total, used) => ({ codes: Array.from({ length: total }, (_, i) => ({ code: `mock-${i}`, used: i < used })), setAt: TODAY, paper: [] });
  const issues = findIssues([
    login("plenty", STRONG, { recoveryCodes: set(10, 7) }),
    login("two", STRONG + "x", { recoveryCodes: set(10, 8) }),
    login("none", STRONG + "y", { recoveryCodes: set(8, 8) }),
    { id: "oauth", kind: "login", password: "", updatedAt: TODAY, recoveryCodes: set(5, 4) },
    login("weak", "password1", { recoveryCodes: set(10, 9) }),
    { id: "note", kind: "note", recoveryCodes: set(10, 10) },
  ], TODAY, sha256);
  assert.equal(issues.has("plenty"), false, "3 left is fine");
  assert.deepEqual(issues.get("two"), [{ type: "codes", left: 2 }]);
  assert.deepEqual(issues.get("none"), [{ type: "codes", left: 0 }]);
  assert.deepEqual(issues.get("oauth"), [{ type: "codes", left: 1 }]);
  assert.deepEqual(issues.get("weak"), [{ type: "weak" }, { type: "codes", left: 1 }]);
  assert.equal(issues.has("note"), false, "only logins carry backup codes");
});

test("a master password needs 12 characters after trimming and a Strong rating", () => {
  assert.equal(masterProblem("correct horse battery"), null);
  assert.equal(masterProblem("   short    "), "Use at least 12 characters.");
  assert.equal(masterProblem(undefined), "Use at least 12 characters.");
  assert.match(masterProblem("Summer2024!!"), /Too easy to guess/);
});

// SECURITY-AUDIT-2026-09-28.md M4: these four passed the rule. A repeated block, a common word inside a longer
// password, and CamelCase words are what a guesser tries early.
test("the master rule refuses repeats, inner common words and the app's own name", () => {
  for (const pw of ["Aa1!Aa1!Aa1!", "password password", "Dragon!Dragon!1", "KapeVault2026!", "MyVault-Vault-1"]) {
    assert.match(masterProblem(pw) ?? "", /Too easy to guess/, pw);
  }
  for (const pw of ["correct horse battery", "Lantern-Mango-Quiet-47", "Harbor-Pine-Slack-2291-kv", "xK9#mQ2$vL7!"]) {
    assert.equal(masterProblem(pw), null, pw);
  }
});
