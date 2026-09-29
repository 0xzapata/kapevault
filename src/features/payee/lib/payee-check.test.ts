// Run with `npm test` (Node strips the types). Payee Check: number normalising and every verdict.
import test from "node:test";
import assert from "node:assert/strict";
import { checkPayee, cleanNumber, editDistance, findNumbers, formatNumber, maskNumber, numberKey } from "./payee-check.ts";
import type { PayeeEntry } from "@/features/vault/types";

let next = 0;
function payee(who: string, number: string, extra: Partial<PayeeEntry> = {}): PayeeEntry {
  next += 1;
  return {
    id: `p${next}`,
    kind: "payee",
    spaceId: "s",
    title: `${who} ${extra.provider ?? "GCash"}`,
    tags: [],
    favorite: false,
    notes: "",
    updatedAt: "2026-09-01",
    issues: [],
    who,
    relation: "",
    provider: "GCash",
    number,
    accountName: "",
    ...extra,
  };
}

const rosa = payee("Mock Tita Rosa", "09171234567", { confirmedAt: "2026-09-12" });
const rosaBank = payee("Mock Tita Rosa", "001234567890", { provider: "BDO" });
const lito = payee("Mock Tito Lito", "09281112222");
const all = [rosa, rosaBank, lito];

test("every way a PH mobile is written is one number", () => {
  for (const text of ["09171234567", "+63 917 123 4567", "+639171234567", "63 917 123 4567", "917 123 4567", "9171234567", "0917-123-4567", "(0917) 123.4567"]) {
    assert.equal(numberKey(text), "09171234567", text);
    assert.equal(checkPayee(text, all)?.kind, "match", text);
  }
});

test("cleanNumber saves what main saves", () => {
  assert.equal(cleanNumber(" +63 (917) 123.4567 "), "09171234567");
  assert.equal(cleanNumber("63 917 123 4567"), "09171234567");
  assert.equal(cleanNumber("917 123 4567"), "9171234567", "a bare 9... may be a bank account");
  assert.equal(cleanNumber("0012-3456-7890"), "001234567890");
});

test("bank account numbers keep their digits", () => {
  assert.equal(numberKey("0012 3456 7890"), "001234567890");
  assert.equal(numberKey("1234567"), "1234567");
  assert.equal(numberKey("91234567890"), "91234567890", "11 digits starting 9 is not a mobile");
});

test("short numbers, dates and plain words are not a number to check", () => {
  for (const text of ["123456", "gcash", "2026-09-12", "2026.09.26", "2026/9/26"]) assert.deepEqual(findNumbers(text), [], text);
  assert.equal(checkPayee("rosa 2026", all), null);
});

test("an amount or a date beside the number never hides a match", () => {
  for (const text of ["09171234567 500", "send 500 0917-123-4567", "Mock Tita Rosa 0917 123 4567 2026-09-26", "0917 123 4567\n500", "padala 1,500 sa 0917 123 4567"]) {
    const v = checkPayee(text, all);
    assert.ok(v?.kind === "match" && v.payee.id === rosa.id, text);
  }
});

test("of several readings, a PH mobile wins, and the name stays in the rest", () => {
  const v = checkPayee("Mama 2 0999 888 7777", all);
  assert.equal(v?.kind === "not-payee" && v.typed, "09998887777");
  assert.ok(findNumbers("Mock Tita Rosa: 0918 123 4567, padala ka muna").some((f) => f.key === "09181234567" && /Mock Tita Rosa/.test(f.rest)));
});

test("format and mask", () => {
  assert.equal(formatNumber("09171234567"), "0917 123 4567");
  assert.equal(formatNumber("001234567890"), "0012 3456 7890");
  assert.equal(maskNumber("09171234567"), "0917 ••• 4567");
  assert.equal(maskNumber("12345678"), "••• 5678", "a short number shows only its end");
});

test("edit distance counts a swap as one", () => {
  assert.equal(editDistance("09171234567", "09171234567"), 0);
  assert.equal(editDistance("09171234567", "09171234576"), 1);
  assert.equal(editDistance("09171234567", "09171234568"), 1);
  assert.equal(editDistance("09171234567", "09991234567"), 2);
});

test("MATCH: a saved number in any format", () => {
  const v = checkPayee("+63 917 123 4567", all);
  assert.equal(v?.kind, "match");
  assert.equal(v?.kind === "match" && v.payee.id, rosa.id);
  assert.equal(checkPayee("0012-3456-7890", all)?.kind, "match");
});

test("MATCH: naming the right person still matches", () => {
  const v = checkPayee("Mock Tita Rosa 0917 123 4567", all);
  assert.equal(v?.kind, "match");
});

test("MATCH: two payees with one number - the confirmed one leads, the other is listed", () => {
  const shared = payee("Mock Tito Lito", "09171234567");
  const v = checkPayee("09171234567", [shared, rosa]);
  assert.ok(v?.kind === "match");
  assert.equal(v.payee.id, rosa.id);
  assert.deepEqual(v.others.map((p) => p.id), [shared.id]);
});

test("MATCH: the named person wins over the confirmed one when both hold the number", () => {
  const shared = payee("Mock Tito Lito", "09171234567");
  const v = checkPayee("Mock Tito Lito 09171234567", [shared, rosa]);
  assert.ok(v?.kind === "match");
  assert.equal(v.payee.id, shared.id);
});

test("NEW NUMBER: a saved name with a number never saved for them", () => {
  const v = checkPayee("Mock Tita Rosa 0999 888 7777 bagong GCash ko ito", all);
  assert.ok(v?.kind === "new-number");
  assert.equal(v.payee.who, "Mock Tita Rosa");
  assert.equal(v.typed, "09998887777");
  assert.equal(v.payee.id, rosa.id, "the closest of her saved numbers (the mobile, not the bank account)");
});

test("NEW NUMBER: names are whole words, any case", () => {
  assert.equal(checkPayee("mock tita rosa 09998887777", all)?.kind, "new-number");
  assert.equal(checkPayee("Mock Tita Rosalinda 09998887777", all)?.kind, "not-payee");
});

test("NEW NUMBER: someone else's saved number under this name says whose it is", () => {
  const v = checkPayee("Mock Tito Lito 09171234567", all);
  assert.ok(v?.kind === "new-number");
  assert.equal(v.payee.id, lito.id);
  assert.equal(v.owner?.id, rosa.id);
});

test("NEAR-MISS: one digit off, a swap, or two digits off", () => {
  for (const [text, diff] of [
    ["09171234568", [10]],
    ["09171234576", [9, 10]],
    ["09171239967", [7, 8]],
  ] as const) {
    const v = checkPayee(text, all);
    assert.ok(v?.kind === "near-miss", text);
    assert.equal(v.payee.id, rosa.id);
    assert.deepEqual(v.diff, diff);
  }
});

test("NEAR-MISS: three digits off is not near; nor is a different length", () => {
  assert.equal(checkPayee("09171299968", all)?.kind, "not-payee");
  assert.equal(checkPayee("0917123456", all)?.kind, "not-payee");
});

test("NEAR-MISS: short numbers allow one digit, not two", () => {
  const coop = payee("Mock Coop", "1234567");
  assert.equal(checkPayee("1234568", [coop])?.kind, "near-miss");
  assert.equal(checkPayee("1234598", [coop])?.kind, "not-payee");
});

test("NEAR-MISS: naming someone checks only their numbers", () => {
  const v = checkPayee("Mock Tito Lito 09171234568", all);
  assert.equal(v?.kind, "new-number", "close to Rosa's, but Lito was named");
  assert.equal(checkPayee("Mock Tito Lito 09281112223", all)?.kind, "near-miss");
});

test("NOT A PAYEE: a number nobody has", () => {
  assert.deepEqual(checkPayee("0999 888 7777", all), { kind: "not-payee", typed: "09998887777" });
});

test("no payees saved: no verdict at all", () => {
  assert.equal(checkPayee("0999 888 7777", []), null);
});
