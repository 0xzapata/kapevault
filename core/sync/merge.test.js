import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { adoptEpoch, isNewerEpoch, isNewerKey, merge, sharedState, VaultMismatchError } from "./merge.js";
import { splitGroups } from "./groups.js";
import { syncChanges } from "./review.js";
import { SHARED_FIELDS, newEpoch, validSync } from "./shape.js";
import { repair, stamp } from "./stamp.js";
import { DEVICES, editor, firstSync, random } from "./test-helpers.js";
import { clearHistory, isTrashed, removeEntries, toggleFavorite, touchEntry, upsertEntry } from "../entries.js";
import { deleteForever, restoreEntry, trashEntry } from "../trash.js";
import { recordGenerated } from "../generated.js";
import { confirmGone, setLifecycle } from "../lifecycle.js";
import { markRecoveryCode, setRecoveryCodes } from "../recovery-codes.js";
import { addSpace, deleteSpace, renameSpace } from "../spaces.js";

// The core functions read the clock and make ids; both are faked so every run replays from its seed.
const T0 = Date.UTC(2026, 8, 1, 2);
const DAY = 24 * 60 * 60 * 1000;
let uuids = 0;
mock.timers.enable({ apis: ["Date"], now: T0 });
mock.method(globalThis.crypto, "randomUUID", () => `id-${++uuids}`);

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const HOST = { sha256 };
const SEED = Number(process.env.MERGE_SEED ?? 20260926);
const RUNS = Number(process.env.MERGE_RUNS ?? 10_000);

// --- Devices -----------------------------------------------------------------------------------------

const PERSONAL = "space-personal";
const CLIENT = "space-client";

/** A vault saved before sync, opened for the first time: nothing is stamped. */
function legacyVault(fill) {
  mock.timers.setTime(T0);
  uuids = 0;
  const vault = { spaces: [{ id: PERSONAL, name: "Personal", kind: "personal" }, { id: CLIENT, name: "Client One", kind: "client" }], entries: [] };
  fill(vault);
  return { ...vault, sync: firstSync(vault) };
}

const device = (spec, vault, skew = 0) => ({ ...spec, skew, data: { ...vault, cloud: { bucket: `bucket-${spec.id}` } } });

/** One edit on a device at wall time `wall` (its own clock reads wall + skew), stamped as persist() does. */
function change(dev, wall, edit) {
  const now = wall + dev.skew;
  mock.timers.setTime(now);
  const data = { ...dev.data };
  edit(data);
  data.sync = stamp(dev.data, data, { installId: dev.id, now, sha256 });
  dev.data = data;
}

/** `dev` pulls `other`'s snapshot; every merge is checked. Returns what the host sees of a pull: the
 * report, and what the gate and the sync log count (syncChanges). */
function pull(dev, other) {
  const { data, report } = merge(dev.data, other.data, HOST);
  checkMerge(dev.data, other.data, data);
  const changes = syncChanges(dev.data, data);
  dev.data = data;
  return { ...report, ...changes };
}

// --- What every merge must hold ----------------------------------------------------------------------

const NO_META = { vv: {}, g: {} };
const seen = (stamp, vv) => !stamp || (vv[stamp.dot[0]] ?? 0) >= stamp.dot[1];
const covers = (vv, other) => Object.entries(other).every(([d, n]) => (vv[d] ?? 0) >= n);
const closed = (entry) => entry?.lifecycle?.state === "gone";
const json = (value) => JSON.stringify(value, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));

// A value survives as itself, or inside a copy (whose title gains a suffix).
function holds(name, want, got) {
  if (!got) return false;
  if (name === "pw") return got.password === want.password;
  if (name === "codes") {
    const [w, g] = [want.recoveryCodes.codes, got.recoveryCodes.codes];
    return json(w.map((c) => c.code)) === json(g.map((c) => c.code)) && w.every((c, i) => !c.used || g[i].used);
  }
  if (name === "core") return json({ ...want, title: undefined }) === json({ ...got, title: undefined }) && (got.title === want.title || got.title.startsWith(`${want.title} (`));
  return json(want) === json(got);
}

// The copies a merge made of `entry`: titled after it and carrying one of its writes as their only history.
function copiesOf(entry, meta, result) {
  const dots = new Set(Object.values(meta.g).map((s) => s.dot.join(":")));
  return result.entries.filter((copy) => copy.title.startsWith(`${entry.title} (`) && dots.has(Object.entries(result.sync.meta[copy.id]?.vv ?? {}).flat().join(":")));
}

// For both inputs: a group value the other side never saw is still in the result (winner, history or a
// copy); one the other side saw and replaced gives way to that successor, whatever the clocks say; and an
// item goes only if a delete saw all of it.
function checkMerge(a, b, result) {
  const out = new Map(result.entries.map((e) => [e.id, e]));
  for (const [mine, theirs] of [[a, b], [b, a]]) {
    const other = new Map(theirs.entries.map((e) => [e.id, e]));
    for (const entry of mine.entries) {
      const meta = mine.sync.meta[entry.id] ?? NO_META;
      const got = out.get(entry.id);
      const tombstone = result.sync.gone[entry.id];
      if (tombstone && covers(tombstone.vv, meta.vv)) continue; // a delete saw this version: it is gone, whatever else survives
      assert.ok(got, `${entry.id} was deleted by a delete that never saw it`);
      const theirEntry = other.get(entry.id);
      const theirMeta = theirs.sync.meta[entry.id] ?? NO_META;
      const oneClosed = theirEntry && closed(entry) !== closed(theirEntry);
      const theirsDeleted = tombstone && covers(tombstone.vv, theirMeta.vv); // then the item lives on as this version
      const groups = splitGroups(entry);
      for (const [name, stamp] of Object.entries(meta.g)) {
        if (name === "life" || name === "history" || name === "trash") continue;
        const successor = theirMeta.g[name];
        if (theirEntry && seen(stamp, theirMeta.vv)) {
          if (!oneClosed && !theirsDeleted && successor && !seen(successor, meta.vv)) assert.deepEqual(result.sync.meta[entry.id].g[name], successor, `${entry.id}.${name}: the later edit that saw this one must win`);
          continue;
        }
        const value = groups[name];
        if (!value || (name === "pw" && !value.password) || (closed(got) && !closed(entry) && (name === "fav" || name === "space"))) continue;
        const kept =
          holds(name, value, splitGroups(got)[name]) ||
          (name === "pw" && (got.history?.some((h) => h.password === value.password) || got.history?.length === 10)) ||
          copiesOf(entry, meta, result).some((copy) => holds(name, value, splitGroups(copy)[name]));
        assert.ok(kept, `${entry.id}.${name} = ${json(value)} was dropped though the other side never saw it`);
      }
    }
  }
}

// A merged vault is well formed, and neither repair() on open nor the next save's stamp() finds anything
// in it: a merge never looks like a local edit.
function checkWellFormed(data) {
  const context = { installId: "dev-check", now: T0, sha256 };
  assert.deepEqual(validSync(data.sync), data.sync, "the merged sync object is not well formed");
  assert.deepEqual(repair(data, context), data.sync, "repair() found something to stamp in a merged vault");
  assert.deepEqual(stamp(JSON.parse(JSON.stringify(data)), data, context), data.sync, "saving a merged vault stamped a change");
}

// --- Random histories --------------------------------------------------------------------------------

// Mostly true clocks; some a year behind, an hour ahead, or ten minutes off.
const SKEWS = [0, 0, 0, -365 * DAY, 60 * 60 * 1000, -10 * 60 * 1000];

/** Three devices from one legacy vault, after random edits and syncs, each merge checked. */
function history(seed) {
  const r = random(seed);
  const edits = editor(r);
  const vault = legacyVault((data) => {
    for (let i = 0; i < 4 + r.int(4); i++) edits.create(data);
  });
  const devices = DEVICES.map((spec) => device(spec, vault, r.pick(SKEWS)));
  let wall = T0;
  for (let step = 8 + r.int(25); step > 0; step--) {
    wall += 1000 + r.int(6 * 60 * 60 * 1000);
    const dev = r.pick(devices);
    if (r.chance(0.3)) pull(dev, r.pick(devices.filter((d) => d !== dev)));
    else {
      try {
        change(dev, wall, edits.any);
      } catch {
        // the edit does not apply to this vault (nothing of that kind, a closed account): skip it
      }
    }
  }
  return { devices, r };
}

// One pair per history: over thousands of histories every pair is covered many times.
function commutativeAndIdempotent(devices, r) {
  const i = r.int(3);
  const [x, y] = [devices[i], devices[(i + 1 + r.int(2)) % 3]];
  const xy = merge(x.data, y.data, HOST);
  assert.equal(sharedState(xy.data), sharedState(merge(y.data, x.data, HOST).data), "merge(x, y) != merge(y, x)");
  assert.equal(merge(x.data, x.data, HOST).report.unchanged, true, "merge(x, x) changed x");
  for (const again of [merge(xy.data, y.data, HOST), merge(xy.data, x.data, HOST)]) {
    assert.equal(again.report.unchanged, true, "merging a result with one of its inputs changed it");
    assert.equal(again.data, xy.data);
  }
}

// The order in which three states meet shows in two places only: where a losing value is kept (which
// conflict copies exist, which passwords went to history), and where a removal that leaves no record of
// its own (a deleted version of an item, an unmarked backup code) meets a concurrent change. Tests after
// the properties pin each case.
const COPY_TITLE = / \((conflict copy|changed after closing), /;
function outsideOrderEffects(data, deleted) {
  const state = JSON.parse(sharedState(data));
  const skip = new Set([...deleted, ...state.entries.filter((e) => COPY_TITLE.test(e.title)).map((e) => e.id)]);
  const withoutMarks = (set) => set && { ...set, codes: set.codes.map((c) => c.code) };
  state.entries = state.entries.filter((e) => !skip.has(e.id)).map(({ history, ...entry }) => ({ ...entry, recoveryCodes: withoutMarks(entry.recoveryCodes) }));
  state.sync.meta = Object.fromEntries(Object.entries(state.sync.meta).filter(([key]) => !skip.has(key)).map(([key, { g, ...meta }]) => [key, { ...meta, g: { ...g, history: undefined } }]));
  return JSON.stringify(state);
}

function associative([a, b, c]) {
  const deleted = new Set([a, b, c].flatMap((d) => Object.keys(d.data.sync.gone)));
  const left = merge(merge(a.data, b.data, HOST).data, c.data, HOST).data;
  const right = merge(a.data, merge(b.data, c.data, HOST).data, HOST).data;
  assert.equal(outsideOrderEffects(left, deleted), outsideOrderEffects(right, deleted));
}

function converge(devices, r) {
  for (let round = 0; ; round++) {
    assert.ok(round < 10, "no quiet round after 10 rounds of syncs");
    const pairs = devices.flatMap((x) => devices.filter((y) => y !== x).map((y) => [x, y]));
    let quiet = true;
    while (pairs.length) {
      const [x, y] = pairs.splice(r.int(pairs.length), 1)[0];
      if (!pull(x, y).unchanged) quiet = false;
    }
    if (quiet) break;
  }
  const [first, ...rest] = devices.map((d) => sharedState(d.data));
  for (const other of rest) assert.equal(other, first, "two devices differ after syncing until quiet");
  checkWellFormed(r.pick(devices).data);
  for (const d of devices) {
    assert.deepEqual(Object.keys(d.data).filter((key) => !SHARED_FIELDS.includes(key)), ["cloud"]);
    assert.deepEqual(d.data.cloud, { bucket: `bucket-${d.id}` }, "a device-local key was merged");
  }
}

// Every property runs on the same histories, so each is built once.
test(`merge properties over ${RUNS} random 3-device histories (seed ${SEED})`, async (t) => {
  const PROPERTIES = {
    "every merge keeps what the other side never saw, and a later edit that saw an earlier one wins": () => {},
    "merge is commutative and idempotent": commutativeAndIdempotent,
    "merge is associative outside kept losers and record-less removals": associative,
    "devices converge after pairwise syncs in any order, to a well-formed vault": converge,
  };
  const failed = {};
  for (let i = 0; i < RUNS; i++) {
    const seed = SEED + i;
    const replay = (error) => new Error(`seed ${seed} - replay with MERGE_SEED=${seed} MERGE_RUNS=1`, { cause: error });
    let run;
    try {
      run = history(seed); // checks every merge it makes
    } catch (error) {
      failed[Object.keys(PROPERTIES)[0]] ??= replay(error);
      continue;
    }
    for (const [name, check] of Object.entries(PROPERTIES)) {
      if (failed[name]) continue;
      try {
        check(run.devices, run.r);
      } catch (error) {
        failed[name] = replay(error);
      }
    }
  }
  for (const name of Object.keys(PROPERTIES)) {
    await t.test(name, () => {
      if (failed[name]) throw failed[name];
    });
  }
});

// --- Each rule ---------------------------------------------------------------------------------------

let wall = T0;
const later = () => (wall += 60 * 60 * 1000);
const find = (dev, title) => dev.data.entries.find((e) => e.title === title);
const copies = (dev) => dev.data.entries.filter((e) => COPY_TITLE.test(e.title));

/** PC, phone and tablet that all hold the same legacy vault: a login, a thing and a note. */
function devicesWithVault({ phoneSkew = 0 } = {}) {
  const vault = legacyVault((data) => {
    upsertEntry(data, { kind: "login", title: "Mock Bank", spaceId: PERSONAL, username: "mock.user", password: "old-pass" });
    upsertEntry(data, { kind: "thing", title: "Mock Passport", spaceId: PERSONAL, spot: "top drawer" });
    upsertEntry(data, { kind: "note", title: "Mock Note", spaceId: CLIENT, body: "first" });
  });
  wall = T0;
  return [device(DEVICES[0], vault), device(DEVICES[1], vault, phoneSkew), device(DEVICES[2], vault)];
}

const edit = (dev, title, fields) => change(dev, later(), (data) => upsertEntry(data, { ...find(dev, title), ...fields }));
const syncBoth = (x, y) => [pull(x, y), pull(y, x)];

test("the order three states meet in can decide whether a copy exists of a value a third device replaced", () => {
  const [pc, phone, tablet] = devicesWithVault();
  edit(pc, "Mock Note", { body: "pc body" });
  pull(tablet, pc);
  edit(phone, "Mock Note", { body: "phone body" });
  edit(tablet, "Mock Note", { body: "tablet body, after seeing the PC's" });
  const left = merge(merge(pc.data, phone.data, HOST).data, tablet.data, HOST).data;
  const right = merge(pc.data, merge(phone.data, tablet.data, HOST).data, HOST).data;
  const bodies = (data) => data.entries.filter((e) => COPY_TITLE.test(e.title)).map((e) => e.body).sort();
  // PC's body lost to the phone's before the tablet's replacement of it arrived: it is kept, once.
  assert.deepEqual(bodies(left), ["pc body", "phone body"]);
  // The tablet had already replaced the PC's body on purpose, so no copy of it is made.
  assert.deepEqual(bodies(right), ["phone body"]);
  for (const data of [left, right]) assert.equal(data.entries.find((e) => e.title === "Mock Note").body, "tablet body, after seeing the PC's");
});

test("the order three states meet in can decide what is left of an item a delete met alongside a concurrent edit", () => {
  const [pc, phone, tablet] = devicesWithVault();
  const id = find(pc, "Mock Note").id;
  change(tablet, later(), (data) => toggleFavorite(data, id));
  pull(phone, tablet);
  change(phone, later(), (data) => removeEntries(data, new Set([id])));
  edit(pc, "Mock Note", { body: "pc body, never saw the delete" });
  const left = merge(merge(pc.data, tablet.data, HOST).data, phone.data, HOST).data;
  const right = merge(pc.data, merge(tablet.data, phone.data, HOST).data, HOST).data;
  const note = (data) => data.entries.find((e) => e.id === id);
  // The PC's edit keeps the item either way. The star the delete saw rides along only when it had
  // already joined the PC's version before the delete arrived.
  for (const data of [left, right]) assert.equal(note(data).body, "pc body, never saw the delete");
  assert.equal(note(left).favorite, true);
  assert.equal(note(right).favorite, false);
});

test("the order three states meet in can decide whether a backup code unmarked by mistake stays unmarked", () => {
  const [pc, phone, tablet] = devicesWithVault();
  const id = find(pc, "Mock Bank").id;
  change(pc, later(), (data) => setRecoveryCodes(data, id, ["aaaa-1111", "bbbb-2222", "cccc-3333", "dddd-4444"]));
  pull(phone, pc);
  change(pc, later(), (data) => markRecoveryCode(data, id, 0, true));
  pull(tablet, pc);
  change(tablet, later(), (data) => markRecoveryCode(data, id, 0, false));
  change(phone, later(), (data) => markRecoveryCode(data, id, 1, true));
  const used = (data) => data.entries.find((e) => e.id === id).recoveryCodes.codes.map((c) => c.used);
  // The unmark stands where the tablet has seen everything the other side has; where the PC's mark
  // already joined the phone's, the mark wins. Either way no code marked used is ever shown unused.
  assert.deepEqual(used(merge(merge(pc.data, phone.data, HOST).data, tablet.data, HOST).data), [true, true, false, false]);
  assert.deepEqual(used(merge(pc.data, merge(phone.data, tablet.data, HOST).data, HOST).data), [false, true, false, false]);
});

test("sequential edits on two devices make no conflict copy", () => {
  const [pc, phone] = devicesWithVault();
  edit(pc, "Mock Bank", { username: "pc.user" });
  pull(phone, pc);
  edit(phone, "Mock Bank", { username: "phone.user" });
  const [report] = syncBoth(pc, phone);
  assert.equal(find(pc, "Mock Bank").username, "phone.user");
  assert.deepEqual(report.copies, []);
  assert.equal(copies(pc).length, 0);
});

test("concurrent edits to different groups both stay, with no copy", () => {
  const [pc, phone] = devicesWithVault();
  const id = find(pc, "Mock Bank").id;
  change(pc, later(), (data) => setLifecycle(data, id, "dormant"));
  edit(phone, "Mock Bank", { password: "phone-pass" });
  syncBoth(pc, phone);
  for (const dev of [pc, phone]) {
    const login = find(dev, "Mock Bank");
    assert.equal(login.lifecycle.state, "dormant");
    assert.equal(login.password, "phone-pass");
    assert.equal(copies(dev).length, 0);
  }
  assert.equal(sharedState(pc.data), sharedState(phone.data));
});

test("a real conflict: the later edit wins and both devices derive the same conflict copy", () => {
  const [pc, phone] = devicesWithVault();
  const id = find(pc, "Mock Note").id;
  edit(pc, "Mock Note", { body: "pc body" });
  edit(phone, "Mock Note", { body: "phone body" });
  const lost = pc.data.sync.meta[id].g.body;
  const [onPc, onPhone] = [merge(pc.data, phone.data, HOST), merge(phone.data, pc.data, HOST)];
  assert.equal(sharedState(onPc.data), sharedState(onPhone.data));
  assert.equal(syncChanges(pc.data, onPc.data).copies.length, 1);
  const copy = onPc.data.entries.find((e) => COPY_TITLE.test(e.title));
  assert.match(copy.id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(copy.body, "pc body");
  assert.equal(copy.title, `Mock Note (conflict copy, Test PC, ${new Date(lost.at[0]).toISOString().slice(0, 10)})`);
  assert.deepEqual(onPc.data.sync.meta[copy.id].vv, { [lost.dot[0]]: lost.dot[1] });
  assert.equal(onPc.data.entries.find((e) => e.id === id).body, "phone body");
  // Each device resolved it on its own; syncing them is a no-op.
  assert.equal(merge(onPc.data, onPhone.data, HOST).report.unchanged, true);
});

test("a concurrent password change keeps the losing password in history, with no copy", () => {
  const [pc, phone] = devicesWithVault();
  edit(pc, "Mock Bank", { password: "pc-pass" });
  edit(phone, "Mock Bank", { password: "phone-pass" });
  const [report] = syncBoth(pc, phone);
  const login = find(pc, "Mock Bank");
  const lostAt = new Date(wall - 60 * 60 * 1000).toISOString(); // UTC, the same on every device
  assert.equal(login.password, "phone-pass");
  assert.deepEqual(login.history.map((h) => h.password).sort(), ["old-pass", "pc-pass"]);
  assert.equal(login.history.find((h) => h.password === "pc-pass").changedAt, lostAt);
  assert.deepEqual(report.copies, []);
  assert.equal(report.secretItems, 1);
});

test("a password that lost alongside another group goes to history and to the copy", () => {
  const [pc, phone] = devicesWithVault();
  edit(pc, "Mock Bank", { password: "pc-pass", username: "pc.user" });
  edit(phone, "Mock Bank", { password: "phone-pass", username: "phone.user" });
  pull(pc, phone);
  const [copy] = copies(pc);
  assert.equal(copy.password, "pc-pass");
  assert.equal(copy.username, "pc.user");
  assert.ok(find(pc, "Mock Bank").history.some((h) => h.password === "pc-pass"));
});

test("history is a union: deduped by password, newest first, capped at 10", () => {
  const [pc, phone] = devicesWithVault();
  for (let i = 1; i <= 6; i++) edit(pc, "Mock Bank", { password: `pc-${i}` });
  for (let i = 1; i <= 6; i++) edit(phone, "Mock Bank", { password: `phone-${i}` });
  pull(pc, phone);
  const { history } = find(pc, "Mock Bank");
  assert.equal(history.length, 10);
  assert.equal(new Set(history.map((h) => h.password)).size, 10);
  assert.deepEqual([...history].sort((a, b) => b.changedAt.localeCompare(a.changedAt) || b.password.localeCompare(a.password)), history);
});

test("cleared history does not come back from a device that had not seen the clear", () => {
  const [pc, phone] = devicesWithVault();
  edit(pc, "Mock Bank", { password: "second-pass" });
  syncBoth(phone, pc);
  wall += 2 * DAY;
  change(pc, wall, (data) => clearHistory(data, find(pc, "Mock Bank").id));
  edit(phone, "Mock Bank", { username: "phone.user" });
  syncBoth(pc, phone);
  for (const dev of [pc, phone]) assert.equal(find(dev, "Mock Bank").history, undefined);
  edit(phone, "Mock Bank", { password: "third-pass" });
  pull(pc, phone);
  assert.deepEqual(find(pc, "Mock Bank").history.map((h) => h.password), ["second-pass"]);
});

test("backup codes: on the same set a code used anywhere stays used; a replaced set wins and the other goes to a copy", () => {
  const [pc, phone] = devicesWithVault();
  const id = find(pc, "Mock Bank").id;
  change(pc, later(), (data) => setRecoveryCodes(data, id, ["aaaa-1111", "bbbb-2222", "cccc-3333", "dddd-4444"]));
  pull(phone, pc);
  change(pc, later(), (data) => markRecoveryCode(data, id, 0, true));
  change(phone, later(), (data) => markRecoveryCode(data, id, 2, true));
  syncBoth(pc, phone);
  assert.deepEqual(find(pc, "Mock Bank").recoveryCodes.codes.map((c) => c.used), [true, false, true, false]);
  assert.equal(copies(pc).length, 0);

  change(phone, later(), (data) => markRecoveryCode(data, id, 1, true));
  change(pc, later(), (data) => setRecoveryCodes(data, id, ["eeee-5555", "ffff-6666", "gggg-7777", "hhhh-8888"]));
  syncBoth(pc, phone);
  assert.equal(find(pc, "Mock Bank").recoveryCodes.codes[0].code, "eeee-5555");
  assert.deepEqual(copies(pc)[0].recoveryCodes.codes.map((c) => c.used), [true, true, true, false]);
});

test("a closed account stays closed; a password changed concurrently goes to a copy", () => {
  const [pc, phone] = devicesWithVault();
  const id = find(pc, "Mock Bank").id;
  change(pc, later(), (data) => confirmGone(data, id, false));
  edit(phone, "Mock Bank", { password: "phone-pass" });
  syncBoth(pc, phone);
  for (const dev of [pc, phone]) {
    const login = dev.data.entries.find((e) => e.id === id);
    assert.equal(login.lifecycle.state, "gone");
    assert.equal(login.password, undefined);
    const [copy] = copies(dev);
    assert.equal(copy.password, "phone-pass");
    assert.match(copy.title, /^Mock Bank \(changed after closing, Test Phone, /);
  }
});

test("lastUsedAt is the latest use, and a use never beats a real edit", () => {
  const [pc, phone] = devicesWithVault();
  const id = find(pc, "Mock Note").id;
  edit(pc, "Mock Note", { body: "pc body" });
  change(phone, later(), (data) => touchEntry(data, id));
  const [report] = syncBoth(pc, phone);
  assert.equal(find(pc, "Mock Note").body, "pc body");
  assert.equal(find(pc, "Mock Note").lastUsedAt, wall);
  assert.deepEqual(report.copies, []);
});

test("spaces: a rename is last-writer-wins; a deleted space's items stay as they are", () => {
  const [pc, phone] = devicesWithVault();
  change(pc, later(), (data) => renameSpace(data, CLIENT, "PC name"));
  change(phone, later(), (data) => renameSpace(data, CLIENT, "Phone name"));
  syncBoth(pc, phone);
  assert.equal(pc.data.spaces.find((s) => s.id === CLIENT).name, "Phone name");

  change(pc, later(), (data) => deleteSpace(data, CLIENT, PERSONAL));
  change(phone, later(), (data) => upsertEntry(data, { kind: "note", title: "Made on phone", spaceId: CLIENT, body: "x" }));
  const phoneItem = find(phone, "Made on phone");
  pull(pc, phone);
  assert.equal(pc.data.spaces.some((s) => s.id === CLIENT), false);
  assert.equal(find(pc, "Made on phone"), phoneItem);
  assert.deepEqual(pc.data.sync.meta[phoneItem.id], phone.data.sync.meta[phoneItem.id]);
});

test("delete vs edit: a delete that saw the item wins; an edit it never saw keeps the item", () => {
  const [pc, phone] = devicesWithVault();
  const note = find(pc, "Mock Note").id;
  const thing = find(pc, "Mock Passport").id;
  change(pc, later(), (data) => removeEntries(data, new Set([note])));
  const stale = phone.data;
  pull(phone, pc);
  assert.equal(find(phone, "Mock Note"), undefined);
  assert.equal(merge(pc.data, stale, HOST).data.entries.some((e) => e.id === note), false, "a stale snapshot resurrected a deleted item");

  change(pc, later(), (data) => removeEntries(data, new Set([thing])));
  edit(phone, "Mock Passport", { spot: "safe" });
  const [report] = syncBoth(pc, phone);
  assert.equal(find(pc, "Mock Passport").spot, "safe");
  assert.ok(pc.data.sync.gone[thing], "the tombstone stays for the record");
  assert.deepEqual(report.added, [thing], "the PC's delete is undone: the gate sees the item come back");
});

test("trash: a trash reaches the other device, a restore undoes it, and a trash beside an edit keeps both", () => {
  const [pc, phone] = devicesWithVault();
  const bank = find(pc, "Mock Bank").id;
  change(pc, later(), (data) => trashEntry(data, bank, Date.now()));
  pull(phone, pc);
  assert.equal(isTrashed(find(phone, "Mock Bank")), true, "trashed on the PC shows as trashed on the phone");

  change(phone, later(), (data) => restoreEntry(data, bank));
  pull(pc, phone);
  assert.equal(isTrashed(find(pc, "Mock Bank")), false, "restored on the phone restores it on the PC");

  // Trashed on the PC while the phone changes the password: no copy, the newest password in the Trash.
  change(pc, later(), (data) => trashEntry(data, bank, Date.now()));
  edit(phone, "Mock Bank", { password: "new-pass" });
  syncBoth(pc, phone);
  for (const dev of [pc, phone]) {
    assert.equal(find(dev, "Mock Bank").password, "new-pass");
    assert.equal(isTrashed(find(dev, "Mock Bank")), true);
    assert.equal(copies(dev).length, 0);
  }
});

test("trash: a restore that never saw the purge keeps the item; a purge that saw everything removes it; two trashes make no copy", () => {
  const [pc, phone] = devicesWithVault();
  const note = find(pc, "Mock Note").id;
  change(pc, later(), (data) => trashEntry(data, note, Date.now()));
  pull(phone, pc);
  // The PC purges while the phone restores: the restore is a change the purge never saw.
  change(pc, later(), (data) => deleteForever(data, note));
  change(phone, later(), (data) => restoreEntry(data, note));
  syncBoth(pc, phone);
  for (const dev of [pc, phone]) {
    assert.equal(isTrashed(find(dev, "Mock Note")), false, "restored wins over a purge made without seeing it");
    assert.equal(copies(dev).length, 0);
  }

  // A purge of what both have seen goes everywhere.
  change(pc, later(), (data) => trashEntry(data, note, Date.now()));
  pull(phone, pc);
  change(phone, later(), (data) => deleteForever(data, note));
  pull(pc, phone);
  assert.equal(find(pc, "Mock Note"), undefined);

  // Trashed on both devices at once: the later write wins and nothing is copied.
  const thing = find(pc, "Mock Passport").id;
  change(pc, later(), (data) => trashEntry(data, thing, Date.now()));
  change(phone, later(), (data) => trashEntry(data, thing, Date.now()));
  syncBoth(pc, phone);
  for (const dev of [pc, phone]) {
    assert.equal(isTrashed(find(dev, "Mock Passport")), true);
    assert.equal(copies(dev).length, 0);
  }
  assert.equal(sharedState(pc.data), sharedState(phone.data));
});

test("causal order beats a wrong clock", () => {
  const [pc, phone] = devicesWithVault({ phoneSkew: -365 * DAY });
  edit(pc, "Mock Note", { body: "pc body" });
  pull(phone, pc);
  edit(phone, "Mock Note", { body: "phone body, a year behind" });
  pull(pc, phone);
  assert.equal(find(pc, "Mock Note").body, "phone body, a year behind");

  // Even a successor stamped before its predecessor (a broken clock) wins.
  const id = find(pc, "Mock Note").id;
  edit(phone, "Mock Note", { body: "latest" });
  const meta = phone.data.sync.meta[id];
  const broken = { ...phone.data, sync: { ...phone.data.sync, meta: { ...phone.data.sync.meta, [id]: { ...meta, g: { ...meta.g, body: { ...meta.g.body, at: [1, 0, "dev-b"] } } } } } };
  assert.equal(merge(pc.data, broken, HOST).data.entries.find((e) => e.id === id).body, "latest");
});

test("the sync records: keys by salt, floors and tombstones by max, devices by the later record with revocation final", () => {
  const [pc, phone] = devicesWithVault();
  const at = (ms, dev = "dev-a") => [ms, 0, dev];
  const withSync = (dev, sync) => ({ ...dev.data, sync: { ...dev.data.sync, ...sync } });
  const a = withSync(pc, {
    clock: at(50),
    keys: [{ salt: "salt-1", n: 1, at: at(0), by: "" }, { salt: "salt-2", n: 2, at: at(40), by: "dev-a" }],
    histFloor: { x: at(10), y: at(30) },
    gone: { z: { vv: { "dev-a": 3, "dev-b": 1 }, at: at(20) } },
    devices: { "dev-a": { name: "Old PC", platform: "win32", addedAt: at(5) }, "dev-b": { name: "Phone", platform: "android", addedAt: at(1, "dev-b"), revokedAt: at(30) } },
  });
  const b = withSync(phone, {
    clock: at(60, "dev-b"),
    keys: [{ salt: "salt-1", n: 1, at: at(0), by: "" }, { salt: "salt-3", n: 2, at: at(45, "dev-b"), by: "dev-b" }],
    histFloor: { x: at(15, "dev-b") },
    gone: { z: { vv: { "dev-a": 1, "dev-b": 4 }, at: at(25, "dev-b") } },
    devices: { "dev-a": { name: "Reinstalled PC", platform: "win32", addedAt: at(9) }, "dev-b": { name: "Phone", platform: "android", addedAt: at(1, "dev-b"), revokedAt: at(20) } },
  });
  const { sync } = merge(a, b, HOST).data;
  assert.deepEqual(sync.clock, at(60, "dev-b"));
  assert.deepEqual(sync.keys.map((k) => k.salt), ["salt-1", "salt-2", "salt-3"]);
  assert.deepEqual(sync.histFloor, { x: at(15, "dev-b"), y: at(30) });
  assert.deepEqual(sync.gone.z, { vv: { "dev-a": 3, "dev-b": 4 }, at: at(25, "dev-b") });
  assert.equal(sync.devices["dev-a"].name, "Reinstalled PC");
  assert.deepEqual(sync.devices["dev-b"].revokedAt, at(20));
});

test("a different vault is refused, and a different epoch is left to the restore flow", () => {
  const [pc, phone] = devicesWithVault();
  const other = (sync) => ({ ...phone.data, sync: { ...phone.data.sync, ...sync } });
  assert.throws(() => merge(pc.data, other({ vaultId: "someone-else" }), HOST), VaultMismatchError);
  const { data, report } = merge(pc.data, other({ epoch: { id: "epoch-2", at: [1, 0, "dev-b"] } }), HOST);
  assert.equal(data, pc.data);
  assert.equal(report.epochDiffers, true);
});

test("a newer epoch replaces this device's items; what it never saw stays as a conflict copy", () => {
  const [pc, phone] = devicesWithVault();
  syncBoth(pc, phone);
  const restored = pc.data; // the backup the PC restores
  // On the phone after that backup: a delete, an edit, and a new item.
  const thing = find(phone, "Mock Passport").id;
  change(phone, later(), (data) => removeEntries(data, new Set([thing])));
  edit(phone, "Mock Note", { body: "phone body" });
  change(phone, later(), (data) => upsertEntry(data, { kind: "note", title: "Mock Phone Note", spaceId: PERSONAL, body: "new" }));
  mock.timers.setTime(later());
  const everywhere = { ...restored, sync: newEpoch(restored.sync, { id: "epoch-2", installId: "dev-a", now: Date.now() }) };

  const { data, report } = adoptEpoch(phone.data, everywhere, HOST);
  const after = { ...phone, data };
  assert.equal(data.sync.epoch.id, "epoch-2");
  assert.ok(find(after, "Mock Passport"), "the delete is undone");
  assert.equal(data.sync.gone[thing], undefined);
  assert.equal(find(after, "Mock Note").body, "first");
  assert.deepEqual(copies(after).map((e) => [e.title.replace(/, \d{4}-\d{2}-\d{2}\)$/, ")"), e.body]).sort(), [
    ["Mock Note (conflict copy, Test Phone)", "phone body"],
    ["Mock Phone Note (conflict copy, Test Phone)", "new"],
  ]);
  assert.equal(find(after, "Mock Phone Note"), undefined, "a new item comes back only as a copy");
  assert.deepEqual(data.cloud, { bucket: "bucket-dev-b" }, "device-local keys stay");
  assert.deepEqual(report, { unchanged: false, epochDiffers: false });
  assert.equal(syncChanges(phone.data, data).copies.length, 2);
  checkWellFormed(data);
  assert.equal(sharedState(adoptEpoch(phone.data, everywhere, HOST).data), sharedState(data), "the same bytes every time");
  // Hashes match content, so the next open's repair stamps nothing.
  assert.equal(repair(data, { installId: "dev-b", now: later(), sha256 }), data.sync);

  // From here it is one epoch: the PC merges the copies in, and the two agree.
  pc.data = everywhere;
  phone.data = data;
  syncBoth(pc, phone);
  assert.equal(copies(pc).length, 2);
  assert.equal(sharedState(pc.data), sharedState(phone.data));
});

test("an item from before sync that the restored vault never knew stays as it is", () => {
  const [pc, phone] = devicesWithVault();
  const old = { id: "legacy-only-here", kind: "note", title: "Mock Old Note", spaceId: PERSONAL, body: "kept" };
  phone.data = { ...phone.data, entries: [...phone.data.entries, old] };
  const everywhere = { ...pc.data, sync: newEpoch(pc.data.sync, { id: "epoch-2", installId: "dev-a", now: later() }) };
  const { data } = adoptEpoch(phone.data, everywhere, HOST);
  assert.equal(data.entries.find((e) => e.id === old.id), old);
  assert.throws(() => adoptEpoch(phone.data, { ...everywhere, sync: { ...everywhere.sync, vaultId: "someone-else" } }, HOST), VaultMismatchError);
});

test("the later epoch and the later master password key win, by clock then by id", () => {
  const epoch = (ms, id = "e") => ({ id, at: [ms, 0, "dev-a"] });
  assert.equal(isNewerEpoch(epoch(2), epoch(1)), true);
  assert.equal(isNewerEpoch(epoch(1), epoch(2)), false);
  assert.equal(isNewerEpoch(epoch(1, "b"), epoch(1, "a")), true);
  assert.equal(isNewerEpoch(epoch(1), epoch(1)), false);
  const keys = (...list) => ({ keys: list.map(([salt, ms]) => ({ salt, n: 1, at: [ms, 0, "dev-a"], by: "dev-a" })) });
  assert.equal(isNewerKey(keys(["s1", 0], ["s2", 5]), keys(["s1", 0])), true);
  assert.equal(isNewerKey(keys(["s1", 0]), keys(["s1", 0], ["s2", 5])), false, "a device that is behind");
  assert.equal(isNewerKey(keys(["s1", 0], ["s3", 4]), keys(["s1", 0], ["s2", 5])), false, "a fork goes to the later change");
  assert.equal(isNewerKey(keys(["s1", 0], ["s3", 6]), keys(["s1", 0], ["s2", 5])), true);
});

test("device-local keys come from this device; a no-op merge returns this device's data untouched", () => {
  const [pc, phone] = devicesWithVault();
  phone.data = { ...phone.data, olderBackupsPending: true };
  edit(phone, "Mock Note", { body: "phone body" });
  pull(pc, phone);
  assert.deepEqual(pc.data.cloud, { bucket: "bucket-dev-a" });
  assert.equal("olderBackupsPending" in pc.data, false);
  const again = merge(pc.data, phone.data, HOST);
  assert.equal(again.data, pc.data);
  assert.equal(again.report.unchanged, true);
});

test("a device's generated passwords (genHistory) are its own: never stamped, never merged, never lost to a merge", () => {
  const [pc, phone] = devicesWithVault();
  const before = sharedState(pc.data);
  change(pc, later(), (data) => recordGenerated(data, "mock-pc-Pass-1", Date.now()));
  change(phone, later(), (data) => recordGenerated(data, "mock-phone-Pass-2", Date.now()));
  assert.equal(sharedState(pc.data), before, "recording stamps nothing, so nothing for sync to carry");
  pull(pc, phone);
  pull(phone, pc);
  assert.deepEqual(pc.data.genHistory.map((g) => g.value), ["mock-pc-Pass-1"]);
  assert.deepEqual(phone.data.genHistory.map((g) => g.value), ["mock-phone-Pass-2"]);
  assert.equal(SHARED_FIELDS.includes("genHistory"), false);
  // A restored epoch replaces the shared state, not this device's list.
  const adopted = adoptEpoch(pc.data, { ...phone.data, sync: newEpoch(phone.data.sync, { id: "epoch-2", installId: "dev-b", now: Date.now() }) }, HOST);
  assert.deepEqual(adopted.data.genHistory.map((g) => g.value), ["mock-pc-Pass-1"]);
});

test("what the host gates on: the report says only whether anything came in; syncChanges counts", () => {
  const [pc, phone] = devicesWithVault();
  change(pc, later(), (data) => {
    for (let i = 0; i < 6; i++) upsertEntry(data, { kind: "note", title: `Mock ${i}`, spaceId: PERSONAL, body: "x" });
  });
  pull(phone, pc);
  change(phone, later(), (data) => removeEntries(data, new Set(data.entries.filter((e) => /^Mock \d$/.test(e.title)).map((e) => e.id))));
  edit(phone, "Mock Bank", { password: "phone-pass" });
  change(phone, later(), (data) => addSpace(data, "New client"));
  const before = pc.data;
  const { data, report } = merge(before, phone.data, HOST);
  checkMerge(before, phone.data, data);
  assert.deepEqual(report, { unchanged: false, epochDiffers: false });
  const numbered = before.entries.filter((e) => /^Mock \d$/.test(e.title)).map((e) => e.id);
  assert.deepEqual(syncChanges(before, data), { added: [], changed: [find(pc, "Mock Bank").id], deleted: numbered, copies: [], secretItems: 1 });
});

test("merge reads no clock and makes no random value", (t) => {
  const { devices } = history(SEED);
  for (const [target, name] of [[Date, "now"], [Math, "random"], [globalThis.crypto, "randomUUID"]]) {
    t.mock.method(target, name, () => {
      throw new Error(`merge called ${name}()`);
    });
  }
  merge(devices[0].data, devices[1].data, HOST);
  merge(devices[1].data, devices[2].data, HOST);
  adoptEpoch(devices[0].data, { ...devices[1].data, sync: { ...devices[1].data.sync, epoch: { id: "epoch-2", at: [T0, 0, "dev-b"] } } }, HOST);
});
