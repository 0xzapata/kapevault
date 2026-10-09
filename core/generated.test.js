import { test } from "node:test";
import assert from "node:assert/strict";
import { GENERATED_DAYS, GENERATED_LIMIT, MAX_GENERATED_LENGTH, clearGenerated, generatedValue, generatedView, purgeGenerated, recentGenerated, recordGenerated } from "./generated.js";
import { cleanVault } from "./clean-vault.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 9, 4);
const vault = (extra = {}) => ({ spaces: [{ id: "s", name: "Personal", kind: "personal" }], entries: [], ...extra });

test("a recorded value is kept with its UTC time, newest first", () => {
  const data = vault();
  recordGenerated(data, "mock-first-Pass-1", NOW);
  recordGenerated(data, "mock-second-Pass-2", NOW + 1000);
  assert.deepEqual(data.genHistory, [
    { value: "mock-second-Pass-2", at: new Date(NOW + 1000).toISOString() },
    { value: "mock-first-Pass-1", at: new Date(NOW).toISOString() },
  ]);
});

test("the same value recorded again (copied, then used) stays one row, with its first time", () => {
  const data = vault();
  recordGenerated(data, "mock-same-Pass-1", NOW);
  const before = data.genHistory;
  recordGenerated(data, "mock-same-Pass-1", NOW + DAY);
  assert.equal(data.genHistory, before, "nothing to replace, so nothing to save");
  assert.equal(data.genHistory.length, 1);
});

test("only the newest 20 are kept", () => {
  assert.equal(GENERATED_LIMIT, 20, "the numbers these tests lean on are the documented ones");
  assert.equal(GENERATED_DAYS, 90);
  const data = vault();
  for (let i = 0; i < 25; i++) recordGenerated(data, `mock-pass-${i}`, NOW + i * 1000);
  assert.equal(data.genHistory.length, 20);
  assert.equal(data.genHistory[0].value, "mock-pass-24");
  assert.equal(data.genHistory.at(-1).value, "mock-pass-5", "the five oldest went");
});

test("a stored list longer than 20 is listed as its newest 20 before any save", () => {
  const genHistory = Array.from({ length: 25 }, (_, i) => ({ value: `mock-pass-${24 - i}`, at: new Date(NOW - i * 1000).toISOString() }));
  const shown = recentGenerated(vault({ genHistory }), NOW);
  assert.equal(shown.length, 20);
  assert.equal(shown.at(-1).value, "mock-pass-5");
});

test("a value older than 90 days is dropped, one just inside stays", () => {
  const data = vault({
    genHistory: [
      { value: "inside", at: new Date(NOW - (GENERATED_DAYS * DAY - 1000)).toISOString() },
      { value: "outside", at: new Date(NOW - (GENERATED_DAYS * DAY + 1000)).toISOString() },
    ],
  });
  assert.deepEqual(recentGenerated(data, NOW).map((g) => g.value), ["inside"], "an old row is not listed even before a save");
  recordGenerated(data, "fresh", NOW);
  assert.deepEqual(data.genHistory.map((g) => g.value), ["fresh", "inside"], "recording drops it for good");
});

test("purgeGenerated drops expired rows and the field itself when none is left", () => {
  const data = vault({ genHistory: [{ value: "old", at: new Date(NOW - 100 * DAY).toISOString() }] });
  purgeGenerated(data, NOW);
  assert.equal(data.genHistory, undefined);
  const kept = vault({ genHistory: [{ value: "new", at: new Date(NOW).toISOString() }] });
  const list = kept.genHistory;
  purgeGenerated(kept, NOW);
  assert.equal(kept.genHistory, list, "nothing expired, nothing replaced");
});

test("a row whose time cannot be read is kept, never silently lost", () => {
  const data = vault({ genHistory: [{ value: "odd", at: "not a date" }] });
  assert.equal(recentGenerated(data, NOW).length, 1);
  purgeGenerated(data, NOW);
  assert.equal(data.genHistory.length, 1);
});

test("the page's view carries the times only, never a value", () => {
  const data = vault();
  recordGenerated(data, "mock-secret-Pass-1", NOW);
  const view = generatedView(data, NOW);
  assert.deepEqual(view, [{ at: new Date(NOW).toISOString() }]);
  assert.equal(JSON.stringify(view).includes("mock-secret"), false);
  assert.deepEqual(generatedView(vault(), NOW), []);
});

test("one value is read by its place in the list; a bad place gives nothing", () => {
  const data = vault();
  recordGenerated(data, "mock-a-Pass-1", NOW);
  recordGenerated(data, "mock-b-Pass-2", NOW + 1000);
  assert.equal(generatedValue(data, 0, NOW + 1000), "mock-b-Pass-2");
  assert.equal(generatedValue(data, 1, NOW + 1000), "mock-a-Pass-1");
  for (const index of [2, -1, 1.5, Number.NaN]) assert.equal(generatedValue(data, index, NOW + 1000), "", String(index));
});

test("Clear removes the whole list", () => {
  const data = vault();
  recordGenerated(data, "mock-a-Pass-1", NOW);
  clearGenerated(data);
  assert.equal(data.genHistory, undefined);
  assert.deepEqual(generatedView(data, NOW), []);
});

test("a value that is not text, empty, or over the cap is refused and nothing is recorded", () => {
  const data = vault();
  for (const bad of [undefined, null, 42, {}, [], "", "x".repeat(MAX_GENERATED_LENGTH + 1)]) {
    assert.throws(() => recordGenerated(data, /** @type {any} */ (bad), NOW), /Nothing to keep/, String(bad));
  }
  assert.equal(data.genHistory, undefined);
  recordGenerated(data, "x".repeat(MAX_GENERATED_LENGTH), NOW);
  assert.equal(data.genHistory.length, 1);
});

test("recording replaces the list, so a failed save can put the old one back", () => {
  const data = vault();
  recordGenerated(data, "mock-a-Pass-1", NOW);
  const saved = { ...data };
  recordGenerated(data, "mock-b-Pass-2", NOW + 1000);
  assert.equal(saved.genHistory.length, 1, "the saved copy still holds the old list");
});

test("cleanVault keeps a good list and drops only what is the wrong type", () => {
  const good = [{ value: "mock-a-Pass-1", at: "2026-10-09T04:00:00.000Z" }];
  assert.deepEqual(cleanVault(vault({ genHistory: good })).genHistory, good);
  assert.equal(cleanVault(vault({ genHistory: "boom" })).genHistory, undefined);
  assert.equal(cleanVault(vault({ genHistory: { value: "x" } })).genHistory, undefined);
  const mixed = cleanVault(vault({ genHistory: [{ value: 1, at: "2026-10-09T04:00:00.000Z" }, null, "x", { value: "kept", at: "2026-10-09T04:00:00.000Z", note: "a newer field" }, { value: "no time" }] }));
  assert.deepEqual(mixed.genHistory, [{ value: "kept", at: "2026-10-09T04:00:00.000Z", note: "a newer field" }, { value: "no time" }]);
});
