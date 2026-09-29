import test from "node:test";
import assert from "node:assert/strict";
import { isRealDate } from "./dates.js";
import { upsertEntry } from "./entries.js";
import { importEntries } from "./import.js";
import { addPaperCopy, setRecoveryCodes } from "./recovery-codes.js";

const vault = () => ({ spaces: [{ id: "s", name: "Personal", kind: "personal" }], entries: [] });
const NOT_DAYS = ["2026-02-31", "2026-02-29", "2026-13-01", "2026-99-99", "2026-9-01", "26-09-01", "", null, 20260901];

test("a real calendar day, not just the YYYY-MM-DD shape", () => {
  for (const day of ["2026-09-29", "2024-02-29", "2026-12-31", "2026-01-01"]) assert.equal(isRealDate(day), true, day);
  for (const day of NOT_DAYS) assert.equal(isRealDate(day), false, String(day));
});

test("an expiry, an imported expiry and a printed date must each be a real day", () => {
  const data = vault();
  assert.throws(() => upsertEntry(data, { kind: "key", spaceId: "s", title: "Mock API", secret: "x", expires: "2026-02-31" }), /Expiry must be a date/);
  assert.throws(() => upsertEntry(data, { kind: "thing", spaceId: "s", title: "Mock Passport", spot: "drawer", expires: "2026-02-31" }), /Expiry must be a date/);
  upsertEntry(data, { kind: "key", spaceId: "s", title: "Mock API", secret: "x", expires: "2028-02-29" });
  assert.equal(data.entries[0].expires, "2028-02-29");
  assert.throws(() => importEntries(vault(), [{ kind: "key", title: "Mock API", secret: "x", expires: "2026-02-31" }]), /expires must be YYYY-MM-DD/);
  const login = upsertEntry(data, { kind: "login", spaceId: "s", title: "Mock Bank", password: "pw" });
  setRecoveryCodes(data, login, ["1111", "2222", "3333", "4444"]);
  assert.throws(() => addPaperCopy(data, login, "Mock drawer", "2026-02-31"), /Printed date must be a date/);
});
