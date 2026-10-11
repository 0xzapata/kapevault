// Audit run-1 4.10: same-title rows made the rename loop quadratic and nothing capped the rows before it.
import test from "node:test";
import assert from "node:assert/strict";
import { ImportRefused, collector } from "./common.js";

const fill = (c, count, title = (i) => `Same ${i % 1}`) => {
  for (let i = 0; i < count; i += 1) c.login(i + 2, { title: title(i), username: "test.user", password: `mock-pass-${i}` });
};

test("8000 same-title rows are refused for the 5000-item cap, fast, with the import's own wording", () => {
  const c = collector();
  const started = performance.now();
  assert.throws(() => fill(c, 8000), (e) => e instanceof ImportRefused && /5000/.test(e.message) && /items/.test(e.message));
  assert.ok(performance.now() - started < 1000, "refusing must not take a second");
});

test("4900 same-title rows rename in linear time and keep the ' (n)' format", () => {
  const c = collector();
  fill(c, 4900);
  const started = performance.now();
  const { items } = c.result();
  assert.ok(performance.now() - started < 1000, "renaming must not be quadratic");
  assert.equal(items[0].title, "Same 0");
  assert.equal(items[1].title, "Same 0 (test.user)");
  assert.equal(items[2].title, "Same 0 (2)");
  assert.equal(items[3].title, "Same 0 (3)");
  assert.equal(new Set(items.map((i) => i.title.toLowerCase())).size, 4900);
});

test("distinct titles are left alone; a title that already ends in a number is not skipped over", () => {
  const c = collector();
  c.login(2, { title: "Alpha", password: "a", username: "" });
  c.login(3, { title: "Beta", password: "b", username: "" });
  c.login(4, { title: "Alpha", password: "c", username: "" });
  c.login(5, { title: "Alpha (2)", password: "d", username: "" });
  c.login(6, { title: "Alpha", password: "e", username: "" });
  assert.deepEqual(c.result().items.map((i) => i.title), ["Alpha", "Beta", "Alpha (2)", "Alpha (2) (2)", "Alpha (3)"]);
});
