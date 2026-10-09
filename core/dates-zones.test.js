import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { daysBetween, daysFromToday } from "./dates.js";

test("daysBetween counts calendar days across months, years and leap days", () => {
  assert.equal(daysBetween("2026-09-26", "2026-09-26"), 0);
  assert.equal(daysBetween("2026-09-26", "2026-10-01"), 5);
  assert.equal(daysBetween("2026-09-26", "2026-09-20"), -6);
  assert.equal(daysBetween("2028-02-28", "2028-03-01"), 2);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
});

test("daysFromToday: 20 = in 20 days, -3 = 3 days ago, null for anything that is not a real day", () => {
  assert.equal(daysFromToday("2026-10-16", "2026-09-26"), 20);
  assert.equal(daysFromToday("2026-09-23", "2026-09-26"), -3);
  for (const bad of ["next week", "", "2026-02-31", "2026-9-26", "2026-09-26T00:00"]) assert.equal(daysFromToday(bad, "2026-09-26"), null, bad);
});

// The rule must hold in every time zone, and the PC and the phone both run it in the viewer's: Manila has
// no daylight saving, New York loses an hour in March (a 23-hour day) and gains one in November (25).
// Each zone runs in its own process, because a process reads TZ once.
const CHECKS = `
  import assert from "node:assert/strict";
  import { addDays, daysBetween, daysFromToday, today } from "./core/dates.js";
  assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2, "spring forward weekend");
  assert.equal(daysBetween("2026-10-31", "2026-11-02"), 2, "fall back weekend");
  assert.equal(daysBetween("2026-03-08", "2026-03-09"), 1, "the 23-hour day");
  assert.equal(daysBetween("2026-11-01", "2026-11-02"), 1, "the 25-hour day");
  assert.equal(daysFromToday(today()), 0);
  for (const n of [1, 3, 20, 400, -1, -3, -400]) assert.equal(daysFromToday(addDays(today(), n)), n, String(n));
  console.log("ok");
`;
for (const zone of ["Asia/Manila", "America/New_York", "Pacific/Auckland"]) {
  test(`the day count is whole calendar days in ${zone}`, () => {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", CHECKS], { cwd: new URL("..", import.meta.url), env: { ...process.env, TZ: zone }, encoding: "utf8" });
    assert.equal(out.trim(), "ok");
  });
}
