// A seeded mutator thrown at the vault readers: a hostile file or a hostile decrypted JSON must come out
// as null, a typed refusal or an Error - never a hang, never a secret that is not a string. The seed is
// printed on failure; set FUZZ_SEED to replay it. No dependency: mulberry32 is a dozen lines.
// Importer fuzzing lives with the importers (core/importers).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const core = require("../core/index.js");
const { openFile, openFileWithKey, encryptWithKey, parseVaultFile, checkVaultFile } = require("./vault-crypto.cjs");

const SEED = Number(process.env.FUZZ_SEED ?? 20261009);
const MASTER = "mock kettle harbor pass orbit gazelle";
const FIXTURES = path.join(__dirname, "..", "core", "fixtures");
const CASE_MS = 1000; // one case never takes longer than this: a hang is a failure
const SECRET_FIELDS = ["password", "secret", "totp", "body", "idNumber", "photo", "adminPassword", "wifiPassword", "number"];

function mulberry32(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  return { next, int, pick: (list) => list[int(list.length)], chance: (p) => next() < p };
}

// Runs one case, bounded in time. A thrown Error is a legitimate refusal; anything else thrown is not.
function bounded(label, fn) {
  const started = performance.now();
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof Error, `${label}: threw a non-Error`);
  }
  assert.ok(performance.now() - started < CASE_MS, `${label}: took over ${CASE_MS} ms`);
}

// --- the file -----------------------------------------------------------------------------------

function mutateBytes(r, bytes) {
  const out = Buffer.from(bytes);
  switch (r.int(5)) {
    case 0: // bit flips
      for (let i = 1 + r.int(4); i > 0; i--) out[r.int(out.length)] ^= 1 << r.int(8);
      return out;
    case 1: // truncate
      return out.subarray(0, r.int(out.length));
    case 2: { // re-pad base64: drop or add "=" after a random value
      const text = out.toString("utf8");
      return Buffer.from(r.chance(0.5) ? text.replace(/=+"/, '"') : text.replace(/"(,|})/, '="$1'), "utf8");
    }
    case 3: { // splice a chunk from one place into another
      const from = r.int(out.length);
      const chunk = out.subarray(from, from + r.int(40));
      const at = r.int(out.length);
      return Buffer.concat([out.subarray(0, at), chunk, out.subarray(at)]);
    }
    default: { // a header number or name swapped for something hostile
      const text = out.toString("utf8");
      const hostile = r.pick(['"N":1048576', '"r":1000', '"p":1048576', '"N":0', '"version":2', '"version":"1"', '"format":"x"', '"kdf":null', '"data":42', '"iv":""']);
      return Buffer.from(text.replace(/"(N|r|p|version|format|kdf|data|iv)":("[^"]*"|\{[^}]*\}|[^,}]*)/, hostile), "utf8");
    }
  }
}

test("mutated vault files: parseVaultFile and checkVaultFile say null or refuse, and a file that passes opens to null or a clean vault", async () => {
  const text = fs.readFileSync(path.join(FIXTURES, "vault-v1.kapevault"));
  const opened = await openFile(MASTER, JSON.parse(text.toString("utf8")));
  const r = mulberry32(SEED);
  let readable = 0;
  for (let i = 0; i < 600; i++) {
    const mutated = mutateBytes(r, text);
    bounded(`file case ${i} (seed ${SEED})`, () => {
      const file = parseVaultFile(mutated);
      if (file === null) {
        assert.throws(() => checkVaultFile(JSON.parse(mutated.toString("utf8"))), Error, "parse said null, so the check refuses too");
        return;
      }
      checkVaultFile(file);
      const data = openFileWithKey(opened.key, file)?.data ?? null;
      if (data !== null) {
        readable++;
        assertCleanVault(data, `file case ${i}`);
      }
    });
  }
  assert.ok(readable > 0, "the unmutated or harmless cases still open (the harness is not refusing everything)");
});

test("a few mutated files through openFile with a password: refused before any key derivation, or opened to null/data", async () => {
  const text = fs.readFileSync(path.join(FIXTURES, "vault-v1.kapevault"));
  const r = mulberry32(SEED + 1);
  let derived = 0;
  for (let i = 0; i < 500 && derived < 4; i++) {
    const file = parseVaultFile(mutateBytes(r, text));
    if (file === null) continue; // never reaches key derivation
    derived++;
    const started = performance.now();
    const result = await openFile(MASTER, file).catch((e) => e);
    assert.ok(result === null || result instanceof Error || typeof result?.data === "object", `openFile case ${i}`);
    assert.ok(performance.now() - started < 5000, `openFile case ${i} took too long`);
    result?.key?.fill?.(0);
  }
  assert.equal(derived, 4, "four mutated files passed the header check and went through scrypt");
});

// --- the decrypted JSON -------------------------------------------------------------------------

const JUNK = [null, undefined, true, false, 0, -1, 1.5, Number.MAX_SAFE_INTEGER, "", "x", "\u0000", "a".repeat(2000), [], {}, [[]], { __proto__: null }, "__proto__"];

function randomValue(r, depth = 0) {
  const kind = r.int(depth > 3 ? 3 : 6);
  if (kind < 2) return r.pick(JUNK);
  if (kind === 2) return r.pick(["login", "note", "key", "payee", "device", "id", "link", "due", "thing", "passkey"]);
  if (kind === 3 || kind === 4) return Array.from({ length: r.int(4) }, () => randomValue(r, depth + 1));
  return Object.fromEntries(Array.from({ length: r.int(5) }, () => [r.pick(["id", "kind", "title", "spaceId", ...SECRET_FIELDS, "history", "questions", "sync", "trashedAt", "lifecycle", "x"]), randomValue(r, depth + 1)]));
}

function assertCleanVault(data, label) {
  assert.ok(Array.isArray(data.entries) && Array.isArray(data.spaces), `${label}: not a vault shape`);
  for (const entry of data.entries) {
    for (const field of SECRET_FIELDS) {
      const value = entry[field];
      assert.ok(value === undefined || typeof value === "string", `${label}: ${field} is ${typeof value}`);
    }
  }
}

test("cleanVault on random JSON shapes: an Error or a vault whose secret fields are all strings", () => {
  const r = mulberry32(SEED + 2);
  const space = { id: "space-1", name: "Personal", kind: "personal" };
  let cleaned = 0;
  for (let i = 0; i < 4000; i++) {
    const shape = r.chance(0.3)
      ? randomValue(r)
      : { spaces: r.chance(0.8) ? [space] : randomValue(r), entries: Array.from({ length: r.int(4) }, () => ({ id: `e${i}-${r.int(3)}`, spaceId: "space-1", kind: r.pick(["login", "note", "key", "payee", "device", "id", "link"]), title: "Mock", ...Object.fromEntries(Array.from({ length: r.int(5) }, () => [r.pick(SECRET_FIELDS), randomValue(r, 2)])) })) };
    bounded(`cleanVault case ${i} (seed ${SEED})`, () => {
      const data = core.cleanVault(shape);
      cleaned++;
      assertCleanVault(data, `cleanVault case ${i}`);
    });
  }
  assert.ok(cleaned > 100, "enough shapes were accepted to mean something");
});

test("a real vault whose decrypted JSON is mutated, sealed under the real key, opens to null or a clean vault", async () => {
  const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, "vault-v1.expected.json"), "utf8"));
  const sealed = await openFile(MASTER, JSON.parse(fs.readFileSync(path.join(FIXTURES, "vault-v1.kapevault"), "utf8")));
  const r = mulberry32(SEED + 3);
  let opened = 0;
  for (let i = 0; i < 400; i++) {
    const data = structuredClone(expected);
    for (let m = 1 + r.int(3); m > 0; m--) {
      const entry = r.pick(data.entries);
      const field = r.pick([...SECRET_FIELDS, "title", "tags", "history", "id", "spaceId", "kind", "trashedAt"]);
      if (r.chance(0.2)) delete entry[field];
      else entry[field] = randomValue(r, 2);
    }
    const file = encryptWithKey(sealed.key, sealed.kdf, sealed.salt, data);
    bounded(`sealed case ${i} (seed ${SEED})`, () => {
      const result = openFileWithKey(sealed.key, file)?.data ?? null;
      if (result !== null) {
        opened++;
        assertCleanVault(result, `sealed case ${i}`);
      }
    });
  }
  assert.ok(opened > 0);
});
