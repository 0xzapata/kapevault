// Run with `npm test` (Node strips the types). File and backup sizes, and backup times.
import test from "node:test";
import assert from "node:assert/strict";
import { formatBackupSize, formatClock, formatSize, formatWhen } from "./format.ts";

test("formatSize: bytes, then KB / MB / GB, a decimal under 10", () => {
  assert.equal(formatSize(0), "0 B");
  assert.equal(formatSize(1023), "1023 B");
  assert.equal(formatSize(1024), "1.0 KB");
  assert.equal(formatSize(3500), "3.4 KB");
  assert.equal(formatSize(20 * 1024), "20 KB");
  assert.equal(formatSize(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatSize(120 * 1024 * 1024), "120 MB");
  assert.equal(formatSize(3 * 1024 ** 4), "3072 GB");
});

test("formatBackupSize: whole KB (at least 1), then MB to a tenth", () => {
  assert.equal(formatBackupSize(10), "1 KB");
  assert.equal(formatBackupSize(412 * 1024), "412 KB");
  assert.equal(formatBackupSize(1024 * 1024), "1.0 MB");
  assert.equal(formatBackupSize(1.34 * 1024 * 1024), "1.3 MB");
});

test("formatWhen is the viewer's own date and time, to the second", () => {
  const ms = new Date(2026, 8, 25, 15, 15, 2).getTime();
  assert.match(formatWhen(ms), /02/);
  assert.match(formatWhen(ms), /15/);
});

test("formatClock is the 12-hour time with no day period, in any locale", () => {
  const now = new Date(2026, 8, 25, 15, 5, 2);
  for (const locale of ["en-US", "es", "ja"]) assert.equal(formatClock(now, locale), "3:05", locale);
});
