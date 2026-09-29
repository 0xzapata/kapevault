import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { MASTER_EVERY_MS, masterDue } from "./master-due.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 29);

test("the master password is due after 14 days, for a date ahead, a clock set back, or a v1 record", () => {
  assert.equal(MASTER_EVERY_MS, 14 * DAY);
  const record = (over) => ({ version: 2, masterAt: NOW - DAY, highWater: NOW, ...over });
  const cases = [
    [record({}), false],
    [record({ masterAt: NOW - 14 * DAY }), false],
    [record({ masterAt: NOW - 14 * DAY - 1 }), true],
    [record({ masterAt: NOW + 60 * 1000 }), false],
    [record({ masterAt: NOW + 60 * 1000 + 1 }), true],
    [record({ highWater: NOW + DAY }), false],
    [record({ highWater: NOW + DAY + 1 }), true],
    [record({ version: 1 }), true],
  ];
  for (const [r, due] of cases) assert.equal(masterDue(r, NOW), due, JSON.stringify(r));
  assert.equal(masterDue(record({ masterAt: NOW - 2000 }), NOW, 1000), true, "a shorter rule (tests)");
});

test("Windows Hello and Touch ID use this rule", () => {
  const pc = createRequire(import.meta.url)("../electron/biometric-record.cjs");
  assert.equal(pc.masterDue, masterDue);
});
