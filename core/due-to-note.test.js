import test from "node:test";
import assert from "node:assert/strict";
import { dueToNotes } from "./due-to-note.js";

const portal = { id: "mock-login", spaceId: "mock-space", kind: "login", title: "Mock My.SSS", username: "mock@example.com", password: "Mock-pw-1" };

test("a full due date becomes a note that keeps every field in its body", () => {
  const due = {
    id: "mock-due",
    spaceId: "mock-space",
    kind: "due",
    title: "Mock SSS contribution",
    tags: ["gov"],
    favorite: true,
    notes: "Pay through GCash",
    updatedAt: "2026-09-20",
    lastUsedAt: 1790000000000,
    heldFor: "Mama",
    brand: undefined,
    agency: "sss",
    schedule: { every: "month", day: 31 },
    nextDue: "2026-10-31",
    amount: "1,500",
    viaEntryId: "mock-login",
    receipts: [
      { paidAt: "2026-09-28", dueDate: "2026-09-30", reference: "PRN-MOCK-2", amount: "1,500" },
      { paidAt: "2026-08-30", dueDate: "2026-08-31" },
    ],
  };
  const [note, login] = dueToNotes([due, portal]);
  assert.deepEqual(note, {
    id: "mock-due",
    spaceId: "mock-space",
    kind: "note",
    title: "Mock SSS contribution",
    tags: ["gov"],
    favorite: true,
    notes: "Pay through GCash",
    updatedAt: "2026-09-20",
    lastUsedAt: 1790000000000,
    heldFor: "Mama",
    brand: undefined,
    body: [
      "For: SSS",
      "Schedule: Every month, by the last day",
      "Next due: 2026-10-31",
      "Amount: 1,500",
      "Website login: Mock My.SSS",
      "Paid 2026-09-28: for 2026-09-30, ref PRN-MOCK-2, amount 1,500",
      "Paid 2026-08-30: for 2026-08-31",
    ].join("\n"),
  });
  assert.equal(login, portal, "the login is untouched");
});

test("a minimal due date becomes a note with only what it had", () => {
  const [note] = dueToNotes([{ id: "mock-min", spaceId: "mock-space", kind: "due", title: "Mock permit", agency: "custom", schedule: { every: "once" } }]);
  assert.deepEqual(note, { id: "mock-min", spaceId: "mock-space", kind: "note", title: "Mock permit", body: "Schedule: One time" });
});

test("schedules read in words; a shape it does not know is kept as written", () => {
  const body = (schedule) => dueToNotes([{ kind: "due", title: "Mock", schedule }])[0].body;
  assert.equal(body({ every: "month", day: 10 }), "Schedule: Every month, by day 10");
  assert.equal(body({ every: "quarter", dates: ["05-15", "08-15", "11-15"] }), "Schedule: Every May 15, Aug 15, Nov 15");
  assert.equal(body({ every: "year", date: "12-31" }), "Schedule: Every year, by Dec 31");
  assert.equal(body({ every: "week", on: "monday" }), 'Schedule: {"every":"week","on":"monday"}');
  assert.equal(body({ every: "quarter", dates: ["13-01"] }), 'Schedule: {"every":"quarter","dates":["13-01"]}');
});

test("an import item names its login by title; an unknown agency keeps its id", () => {
  const [note] = dueToNotes([{ space: "Mock Client", kind: "due", title: "Mock 2551Q", agency: "bir-2551q", via: "Mock eBIRForms", receipts: [{ reference: "REF-MOCK" }] }]);
  assert.deepEqual(note, { space: "Mock Client", kind: "note", title: "Mock 2551Q", body: "For: BIR 2551Q\nWebsite login: Mock eBIRForms\nPaid (no date): ref REF-MOCK" });
  assert.equal(dueToNotes([{ kind: "due", title: "Mock", agency: "gsis" }])[0].body, "For: gsis");
});

test("a link to a login that is gone is left out; every other item passes through as it is", () => {
  const [note] = dueToNotes([{ kind: "due", title: "Mock", viaEntryId: "mock-deleted" }]);
  assert.equal(note.body, "");
  const others = [portal, { id: "mock-note", kind: "note", title: "Mock", body: "For: SSS" }];
  const converted = dueToNotes(others);
  assert.deepEqual(converted, others);
  for (const [i, e] of converted.entries()) assert.equal(e, others[i], "the same object");
  assert.deepEqual(dueToNotes(dueToNotes([{ kind: "due", title: "Mock", nextDue: "2026-12-01" }])), [{ kind: "note", title: "Mock", body: "Next due: 2026-12-01" }], "twice = once");
});
