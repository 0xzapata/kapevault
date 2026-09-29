// Run with `npm test` (Node strips the types). Local dates: every Date here is built from local
// fields, so the results hold in any time zone.
import test from "node:test";
import assert from "node:assert/strict";
import { daysBetween, daysFromToday, formatDay, localToday, parseDay, plural, relativeDays, relativeTime } from "./local-date.ts";

const TODAY = "2026-09-26";

test("localToday is the local date, not the UTC one", () => {
  assert.equal(localToday(new Date(2026, 8, 26, 0, 30)), "2026-09-26"); // just after midnight: UTC+8 is still the 25th in UTC
  assert.equal(localToday(new Date(2026, 8, 26, 23, 59)), "2026-09-26");
  assert.equal(localToday(new Date(2027, 0, 1, 7, 0)), "2027-01-01");
});

test("parseDay reads a local YYYY-MM-DD as local midnight, and nothing else", () => {
  const d = parseDay("2026-09-26");
  assert.ok(d);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 8, 26, 0]);
  for (const bad of ["", "2026-9-26", "26/09/2026", "2026-09-26T00:00", "soon"]) assert.equal(parseDay(bad), null, bad);
});

test("daysBetween counts calendar days across months, years and leap days", () => {
  assert.equal(daysBetween(TODAY, TODAY), 0);
  assert.equal(daysBetween(TODAY, "2026-10-01"), 5);
  assert.equal(daysBetween(TODAY, "2026-09-20"), -6);
  assert.equal(daysBetween("2028-02-28", "2028-03-01"), 2);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
  assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2); // across a daylight-saving weekend (US) still whole days
});

test("daysFromToday counts from today, and gives null for a bad date", () => {
  assert.equal(daysFromToday("2026-10-16", TODAY), 20);
  assert.equal(daysFromToday("2026-09-23", TODAY), -3);
  assert.equal(daysFromToday("next week", TODAY), null);
  assert.equal(daysFromToday(localToday()), 0);
});

test("plural adds an s unless the count is 1", () => {
  assert.equal(plural(1, "day"), "1 day");
  assert.equal(plural(0, "day"), "0 days");
  assert.equal(plural(3, "backup code"), "3 backup codes");
});

test("relativeDays says today, in N days, or N days ago", () => {
  assert.equal(relativeDays(0), "today");
  assert.equal(relativeDays(1), "in 1 day");
  assert.equal(relativeDays(20), "in 20 days");
  assert.equal(relativeDays(-1), "1 day ago");
  assert.equal(relativeDays(-3), "3 days ago");
});

test("formatDay shows the local day in the viewer's format, and leaves anything else alone", () => {
  const want = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  assert.equal(formatDay("2026-09-26"), want(new Date(2026, 8, 26)));
  assert.equal(formatDay(new Date(2026, 0, 2, 23, 0)), want(new Date(2026, 0, 2)));
  const stamp = "2026-03-04T05:06:07.000Z"; // a UTC timestamp shows its local day
  assert.equal(formatDay(stamp), want(new Date(stamp)));
  assert.equal(formatDay("soon"), "soon");
  assert.equal(formatDay(""), "");
});

test("relativeTime counts minutes, hours, then calendar days, then the date", () => {
  const now = new Date(2026, 8, 26, 15, 0).getTime();
  const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).getTime();
  assert.equal(relativeTime(now - 30_000, now), "just now");
  assert.equal(relativeTime(now - 5 * 60_000, now), "5 min ago");
  assert.equal(relativeTime(at(26, 14, 0), now), "1 hour ago");
  assert.equal(relativeTime(at(26, 9, 0), now), "6 hours ago");
  assert.equal(relativeTime(at(25, 23, 30), now), "yesterday"); // under a day, but yesterday by the calendar
  assert.equal(relativeTime(at(23, 12), now), "3 days ago");
  assert.equal(relativeTime(at(19, 12), now), formatDay(new Date(at(19, 12))));
});
