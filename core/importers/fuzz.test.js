// A seeded fuzz run over every importer. The fixtures are mutated (cut short, spliced together, bytes
// flipped, JSON values swapped for other types) and each result must be a parsed export, null (not a
// format we know) or an Error - never a hang, never an item whose secret is not text. The seed is fixed,
// so a failure here repeats; change SEED to look further.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseExport } from "./index.js";
import { importEntries } from "../import.js";

const SEED = 20261009;
const ROUNDS = 3000;
const MAX_MS_PER_CASE = 1000;
const SECRET_FIELDS = ["password", "totp", "body", "secret", "keyId", "username", "url", "notes"];

const dir = path.join(import.meta.dirname, "fixtures");
const fixtures = fs.readdirSync(dir).map((name) => fs.readFileSync(path.join(dir, name), "utf8"));

// mulberry32: a small seeded generator, so the run is the same every time.
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NASTY = ['"', ",", "\n", "\r\n", "\r", "{", "}", "[", "]", "\u0000", "﻿", "‮", "x".repeat(5000), '""', "\\", "null", "-1", "1e999", "{}", "[]"];

function mutateText(rand, text, others) {
  const pick = (n) => Math.floor(rand() * n);
  switch (pick(6)) {
    case 0:
      return text.slice(0, pick(text.length + 1)); // truncated
    case 1: {
      const at = pick(text.length + 1);
      return text.slice(0, at) + NASTY[pick(NASTY.length)] + text.slice(at + pick(4)); // a nasty token in, a few characters out
    }
    case 2: {
      const other = others[pick(others.length)];
      return text.slice(0, pick(text.length + 1)) + other.slice(pick(other.length + 1)); // spliced onto another export
    }
    case 3: {
      const at = pick(text.length);
      return text.slice(0, at) + text.slice(at, at + 1 + pick(40)).repeat(1 + pick(30)) + text.slice(at); // a stretch repeated
    }
    case 4:
      return text.replace(/[,\n]/g, (m) => (rand() < 0.1 ? NASTY[pick(NASTY.length)] : m)); // separators swapped
    default:
      return mutateJson(rand, text) ?? text;
  }
}

// A JSON export with some values replaced by other types: the shapes a hand-edited or damaged file has.
function mutateJson(rand, text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const swaps = [null, 7, true, [], {}, ["a"], { a: 1 }, "", "x".repeat(2000)];
  const walk = (node) => {
    if (node && typeof node === "object") {
      for (const key of Object.keys(node)) {
        if (rand() < 0.08) node[key] = swaps[Math.floor(rand() * swaps.length)];
        else walk(node[key]);
      }
    }
  };
  walk(json);
  return JSON.stringify(json);
}

function checkItems(items, label) {
  assert.ok(Array.isArray(items), `${label}: items is a list`);
  for (const item of items) {
    assert.equal(typeof item, "object", label);
    assert.equal(typeof item.title, "string", `${label}: title is text`);
    for (const field of SECRET_FIELDS) {
      if (item[field] !== undefined) assert.equal(typeof item[field], "string", `${label}: ${field} is text`);
    }
  }
}

test("every importer gives a result, null or an Error for damaged input, fast, with text-only secrets", () => {
  const rand = rng(SEED);
  let parsed = 0;
  let nulls = 0;
  let errors = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    const base = fixtures[Math.floor(rand() * fixtures.length)];
    let text = mutateText(rand, base, fixtures);
    if (rand() < 0.3) text = mutateText(rand, text, fixtures); // some get a second mutation
    const label = `round ${round}`;
    const started = performance.now();
    let result;
    try {
      result = parseExport(text);
    } catch (e) {
      assert.ok(e instanceof Error, `${label}: only an Error is thrown`);
      errors += 1;
      continue;
    } finally {
      assert.ok(performance.now() - started < MAX_MS_PER_CASE, `${label}: finished in time`);
    }
    if (result === null) {
      nulls += 1;
      continue;
    }
    parsed += 1;
    assert.equal(typeof result.source, "string", label);
    checkItems(result.items, label);
    assert.ok(Array.isArray(result.skipped) && Array.isArray(result.notes), label);
    // What comes out must also be something core's import takes or refuses with an Error.
    const data = { spaces: [{ id: "p", name: "Personal", kind: "personal" }], entries: [] };
    try {
      if (result.items.length) importEntries(data, result.items);
    } catch (e) {
      assert.ok(e instanceof Error, `${label}: core refuses with an Error`);
      continue;
    }
    for (const entry of data.entries) {
      for (const field of ["password", "totp", "body", "secret"]) {
        if (entry[field] !== undefined) assert.equal(typeof entry[field], "string", `${label}: stored ${field} is text`);
      }
    }
  }
  // The run must reach all three outcomes, or it is not testing what it claims to.
  assert.ok(parsed > ROUNDS / 20 && nulls > 0 && errors > 0, `outcomes: ${parsed} parsed, ${nulls} unknown, ${errors} refused`);
});
