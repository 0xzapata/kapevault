// Test-only, never imported by the app: a seeded random source and the edits a device makes, so merge
// tests run on real device histories. The edits call the real core functions; the test file fakes their
// clock and ids and stamps each edit with the real stamp().
import { newSync, validSync } from "./shape.js";
import { clearHistory, confirmPayee, moveEntry, removeEntries, toggleFavorite, touchEntry, upsertEntry } from "../entries.js";
import { confirmGone, setLifecycle } from "../lifecycle.js";
import { markRecoveryCode, setRecoveryCodes } from "../recovery-codes.js";
import { addSpace, deleteSpace, renameSpace } from "../spaces.js";

export const DEVICES = [
  { id: "dev-a", name: "Test PC" },
  { id: "dev-b", name: "Test Phone" },
  { id: "dev-c", name: "Test Tablet" },
];

/** mulberry32: small and seeded, so a failing run replays from its seed. */
export function random(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n) => Math.floor(next() * n), pick: (list) => list[Math.floor(next() * list.length)], chance: (p) => next() < p };
}

/** The sync block a vault saved before sync gets on first open (nothing stamped), with the test devices registered. */
export function firstSync(vault) {
  const devices = Object.fromEntries(DEVICES.map((d) => [d.id, { name: d.name, platform: "test", addedAt: [1, 0, d.id] }]));
  return validSync({ ...newSync(vault, "AAAAAAAAAAAAAAAAAAAAAA=="), devices }); // the clock catches up with addedAt
}

// --- A device's edits --------------------------------------------------------------------------------

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SHARED_CODES = ["1111-2222", "3333-4444", "5555-6666", "7777-8888", "9999-0000"];

/** Random edits over a vault. `value()` is usually a fresh string and sometimes a common one, so two devices sometimes type the same thing. */
export function editor(r) {
  let count = 0;
  const value = () => (r.chance(0.2) ? r.pick(["alpha", "bravo"]) : `v${++count}`);
  const digits = (n) => Array.from({ length: n }, () => r.int(10)).join("");
  const totp = () => (r.chance(0.3) ? "" : Array.from({ length: 16 }, () => r.pick([...BASE32])).join(""));
  const liveEntry = (data, kind) => {
    const pool = data.entries.filter((e) => (!kind || e.kind === kind) && e.lifecycle?.state !== "gone");
    if (!pool.length) throw new Error("nothing to edit");
    return r.pick(pool);
  };
  const FIELDS = {
    login: { password: value, username: value, totp, questions: () => [{ question: value(), answer: value() }] },
    note: { body: value },
    key: { secret: value, keyId: value },
    payee: { number: () => `09${digits(9)}`, provider: value, accountName: value },
    thing: { spot: value, room: value },
    device: { adminPassword: value, wifiPassword: value, model: value },
    link: { location: value },
  };
  const COMMON = { title: value, notes: value, tags: () => [value()] };
  const NEW = { login: { password: value }, note: { body: value }, key: { secret: value }, payee: { who: value, provider: () => "GCash", number: () => `09${digits(9)}` }, thing: { spot: value }, device: { type: () => "router" }, link: { location: value } };

  const create = (data) => {
    const kind = r.pick(Object.keys(NEW));
    const input = { kind, title: value(), spaceId: r.pick(data.spaces).id };
    for (const [field, make] of Object.entries(NEW[kind])) input[field] = make();
    upsertEntry(data, input);
  };
  const edit = (data) => {
    const entry = liveEntry(data);
    const fields = { ...COMMON, ...FIELDS[entry.kind] };
    const input = { ...entry };
    const changes = 1 + r.int(2);
    for (let i = 0; i < changes; i++) {
      const field = r.pick(Object.keys(fields));
      input[field] = fields[field]();
    }
    upsertEntry(data, input);
  };
  const codes = (data) => {
    const login = liveEntry(data, "login");
    if (login.recoveryCodes && r.chance(0.7)) markRecoveryCode(data, login.id, r.int(login.recoveryCodes.codes.length), r.chance(0.8));
    else setRecoveryCodes(data, login.id, r.chance(0.5) ? SHARED_CODES : SHARED_CODES.map(() => value()));
  };
  const space = (data) => {
    const client = data.spaces.filter((s) => s.kind === "client");
    if (!client.length || r.chance(0.3)) addSpace(data, value());
    else if (r.chance(0.6)) renameSpace(data, r.pick(client).id, value());
    else deleteSpace(data, r.pick(client).id, r.chance(0.5) ? data.spaces.find((s) => s.kind === "personal").id : undefined);
  };

  // Weighted: plain edits most, the rarer acts less.
  const EDITS = [
    [6, edit],
    [2, create],
    [1, (data) => removeEntries(data, new Set([liveEntry(data).id]))],
    [1, (data) => toggleFavorite(data, liveEntry(data).id)],
    [1, (data) => moveEntry(data, liveEntry(data).id, r.pick(data.spaces).id)],
    [1, (data) => { const payee = liveEntry(data, "payee"); confirmPayee(data, payee.id, payee.number); }],
    [2, codes],
    [1, (data) => setLifecycle(data, liveEntry(data, "login").id, r.pick(["dormant", "deletion-requested", null]))],
    [1, (data) => confirmGone(data, liveEntry(data, "login").id, r.chance(0.5))],
    [1, (data) => clearHistory(data, liveEntry(data, "login").id)],
    [1, (data) => touchEntry(data, liveEntry(data).id)],
    [1, space],
  ];
  const total = EDITS.reduce((sum, [weight]) => sum + weight, 0);
  const any = (data) => {
    let roll = r.int(total);
    for (const [weight, change] of EDITS) if ((roll -= weight) < 0) return change(data);
  };
  return { create, any };
}
