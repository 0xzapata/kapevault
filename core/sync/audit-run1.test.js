// Regression tests for the 2026-10-11 audit run-1 findings in core (4.2, 4.3, 4.4, 4.6, trash review).
// Real stamp/merge/clean code, a faked clock and ids, mock names only.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { adoptEpoch, merge } from "./merge.js";
import { reviewReasons, syncChanges } from "./review.js";
import { newEpoch, readSync, validSync } from "./shape.js";
import { stamp } from "./stamp.js";
import { DEVICES, firstSync } from "./test-helpers.js";
import { cleanVault } from "../clean-vault.js";
import { publicView } from "../public-view.js";
import { openedVault } from "../opened-vault.js";
import { clearHistory, upsertEntry } from "../entries.js";
import { confirmGone } from "../lifecycle.js";
import { trashEntry } from "../trash.js";

const T0 = Date.UTC(2026, 8, 1, 2);
const DAY = 24 * 60 * 60 * 1000;
let uuids = 0;
mock.timers.enable({ apis: ["Date"], now: T0 });
mock.method(globalThis.crypto, "randomUUID", () => `id-${++uuids}`);

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const HOST = { sha256 };
const PERSONAL = "space-personal";
let wall = T0;
const later = () => (wall += 60 * 60 * 1000);

function pair(fill) {
  mock.timers.setTime(T0);
  uuids = 0;
  const vault = { spaces: [{ id: PERSONAL, name: "Personal", kind: "personal" }], entries: [] };
  fill(vault);
  const base = { ...vault, sync: firstSync(vault) };
  wall = T0;
  return DEVICES.slice(0, 2).map((spec) => ({ ...spec, data: { ...base } }));
}

function change(dev, at, edit) {
  mock.timers.setTime(at);
  const data = { ...dev.data };
  edit(data);
  data.sync = stamp(dev.data, data, { installId: dev.id, now: at, sha256 });
  dev.data = data;
}
const edit = (dev, title, fields) => change(dev, later(), (data) => upsertEntry(data, { ...find(dev, title), ...fields }));
const find = (dev, title) => dev.data.entries.find((e) => e.title === title);
const pull = (dev, other) => {
  dev.data = merge(dev.data, other.data, HOST).data;
};
const COPY = / \((conflict copy|changed after closing), /;
const bank = (fill) => (data) => {
  upsertEntry(data, { kind: "login", title: "Mock Bank", spaceId: PERSONAL, username: "mock.user", password: "old-pass", totp: "JBSWY3DPEHPK3PXP" });
  fill?.(data);
};

// --- 4.6 ---------------------------------------------------------------------------------------------

// A key defined as own data, as JSON.parse does: "__proto__" stays a plain key.
const withKey = (record, name, value) => Object.defineProperty({ ...record }, name, { value, enumerable: true, configurable: true, writable: true });
const NAMES = ["toString", "__proto__", "constructor", "hasOwnProperty", "valueOf"];

test("4.6: Object.prototype member names are dropped from a read sync object, never thrown on", () => {
  const [pc] = pair(bank());
  const raw = JSON.parse(JSON.stringify(pc.data.sync));
  const device = { name: "Test Tablet", platform: "test", addedAt: [2, 0, "dev-c"] };
  const tomb = { vv: { "dev-a": 1 }, at: [3, 0, "dev-a"] };
  for (const name of NAMES) {
    raw.devices = withKey(raw.devices, name, device);
    raw.gone = withKey(raw.gone, name, tomb);
  }
  const clean = validSync(raw);
  for (const name of NAMES) {
    assert.equal(Object.hasOwn(clean.devices, name), false, `devices.${name}`);
    assert.equal(Object.hasOwn(clean.gone, name), false, `gone.${name}`);
  }
  assert.equal(Object.getPrototypeOf(clean.gone), Object.prototype);
  const cleaned = cleanVault({ spaces: pc.data.spaces, entries: NAMES.map((id) => ({ id, kind: "note", spaceId: PERSONAL, title: id, body: "x" })) });
  assert.deepEqual(cleaned.entries, [], "entries with such ids are dropped");
  assert.equal(readSync({ ...pc.data, sync: raw }, "AAAAAAAAAAAAAAAAAAAAAA==").vaultId, raw.vaultId);
});

test("4.6: a merge and an adopted epoch hold own keys only, so a prototype member name never throws", () => {
  const [pc, phone] = pair(bank());
  for (const name of NAMES) {
    const remote = JSON.parse(JSON.stringify(phone.data));
    const meta = { vv: { "dev-b": 1 }, g: { core: { dot: ["dev-b", 1], at: [5, 0, "dev-b"] } } };
    const entry = { id: name, kind: "note", spaceId: PERSONAL, title: `Mock ${name}`, body: "x" };
    remote.entries.push(entry);
    const device = { name: "Mock", platform: "test", addedAt: [1, 0, "x"] };
    remote.sync = {
      ...remote.sync,
      meta: withKey(remote.sync.meta, name, meta),
      gone: withKey(remote.sync.gone, name, { vv: { "dev-b": 1 }, at: [6, 0, "dev-b"] }),
      devices: withKey(remote.sync.devices, name, device),
    };
    const devices = withKey({}, name, device);
    const local = { ...pc.data, sync: { ...pc.data.sync, devices: { ...pc.data.sync.devices, ...devices } } };
    assert.doesNotThrow(() => merge(local, remote, HOST), `merge ${name}`);
    assert.doesNotThrow(() => merge(remote, local, HOST), `merge back ${name}`);
    const epoch = { ...remote, sync: newEpoch(remote.sync, { id: "epoch-2", installId: "dev-b", now: T0 + DAY }) };
    const adopted = adoptEpoch({ ...local, entries: [...local.entries, entry] }, epoch, HOST);
    assert.ok(adopted.data.entries.length >= 1, `adopt ${name}`);
    assert.doesNotThrow(() => openedVault(cleanVault(adopted.data), "AAAAAAAAAAAAAAAAAAAAAA==", { installId: "dev-a", now: T0 + 2 * DAY, sha256 }), `reopen ${name}`);
  }
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getOwnPropertyNames(Object.prototype).includes("polluted"), false);
  assert.equal(typeof Object.prototype.toString, "function");
  assert.equal(Object.getPrototypeOf(Object.prototype), null);
});

// --- 4.3 core ----------------------------------------------------------------------------------------

test("4.3: a title-less entry reads as an empty title and date, and a malformed syncLog is dropped", () => {
  const data = cleanVault({
    spaces: [{ id: PERSONAL, name: "Personal", kind: "personal" }],
    entries: [{ id: "mock-2", kind: "login", spaceId: PERSONAL, title: 5 }],
    syncLog: "not a list",
  });
  assert.equal(Object.hasOwn(data, "syncLog"), false);
  const [view] = publicView(data, new Map()).entries;
  assert.equal(view.title, "");
  assert.equal(view.updatedAt, "");
  assert.deepEqual(cleanVault({ spaces: data.spaces, entries: [], syncLog: [{ at: 1 }] }).syncLog, [{ at: 1 }]);
});

test("4.3: a history row without changedAt does not make a merge throw", () => {
  const [pc, phone] = pair(bank());
  edit(pc, "Mock Bank", { password: "second-pass" });
  pull(phone, pc);
  wall += 2 * DAY;
  change(pc, wall, (data) => clearHistory(data, find(pc, "Mock Bank").id));
  change(phone, later(), (data) => {
    const login = data.entries.find((e) => e.title === "Mock Bank");
    data.entries = data.entries.map((e) => (e === login ? { ...e, history: [{ password: "dateless" }, ...login.history], username: "phone.user" } : e));
  });
  assert.doesNotThrow(() => merge(pc.data, phone.data, HOST));
  assert.doesNotThrow(() => merge(phone.data, pc.data, HOST));
});

// --- 4.4 ---------------------------------------------------------------------------------------------

test("4.4: cleared password history does not return inside a conflict copy", () => {
  const [pc, phone] = pair(bank());
  edit(pc, "Mock Bank", { password: "second-pass" });
  pull(phone, pc);
  wall += 2 * DAY;
  edit(phone, "Mock Bank", { title: "Phone title" });
  change(pc, later(), (data) => clearHistory(data, find(pc, "Mock Bank").id));
  edit(pc, "Mock Bank", { title: "PC title" });
  const onPc = merge(pc.data, phone.data, HOST).data;
  const onPhone = merge(phone.data, pc.data, HOST).data;
  for (const data of [onPc, onPhone]) {
    assert.ok(data.entries.some((e) => COPY.test(e.title)), "the title conflict still makes a copy");
    for (const entry of data.entries) assert.equal(JSON.stringify(entry).includes("old-pass"), false, `${entry.title} lists the cleared password`);
  }
});

test("4.4: an epoch adopted over a cleared history keeps no cleared password in its copy", () => {
  const [pc, phone] = pair(bank());
  edit(pc, "Mock Bank", { password: "second-pass" });
  pull(phone, pc);
  wall += 2 * DAY;
  change(pc, later(), (data) => clearHistory(data, find(pc, "Mock Bank").id));
  edit(phone, "Mock Bank", { title: "Phone title" });
  mock.timers.setTime(later());
  const everywhere = { ...pc.data, sync: newEpoch(pc.data.sync, { id: "epoch-2", installId: "dev-a", now: Date.now() }) };
  const { data } = adoptEpoch(phone.data, everywhere, HOST);
  assert.ok(data.entries.some((e) => COPY.test(e.title)));
  for (const entry of data.entries) assert.equal(JSON.stringify(entry).includes("old-pass"), false, entry.title);
});

// --- 4.2 ---------------------------------------------------------------------------------------------

function closing(lagging) {
  const [pc, phone] = pair((data) => {
    data.spaces.push({ id: "space-other", name: "Other", kind: "client" });
    bank()(data);
  });
  const id = find(pc, "Mock Bank").id;
  change(pc, later(), (data) => confirmGone(data, id, false));
  lagging(phone);
  const results = [merge(pc.data, phone.data, HOST).data, merge(phone.data, pc.data, HOST).data];
  for (const data of results) assert.equal(data.entries.find((e) => e.id === id).lifecycle.state, "gone");
  return results;
}

test("4.2: a title edit or a move on a lagging device makes no 'changed after closing' copy", () => {
  const edits = [
    (phone) => edit(phone, "Mock Bank", { title: "Mock Bank renamed" }),
    (phone) => change(phone, later(), (data) => upsertEntry(data, { ...data.entries.find((e) => e.title === "Mock Bank"), spaceId: "space-other" })),
    (phone) => edit(phone, "Mock Bank", { favorite: true }),
  ];
  for (const lag of edits) for (const data of closing(lag)) assert.equal(data.entries.filter((e) => COPY.test(e.title)).length, 0);
});

test("4.2: a concurrent password change after closing makes a copy that holds only that password", () => {
  const [onPc] = closing((phone) => edit(phone, "Mock Bank", { password: "phone-pass" }));
  const [copy] = onPc.entries.filter((e) => COPY.test(e.title));
  assert.equal(copy.password, "phone-pass");
  assert.equal(copy.totp, undefined, "the wiped 2FA key stays wiped");
  assert.equal(copy.history, undefined);
  assert.match(copy.title, /^Mock Bank \(changed after closing, Test Phone, /);
  assert.equal(copy.username, "mock.user");
});

// --- review gate: trash moves --------------------------------------------------------------------------

test("a mass trash move counts toward the review gate the way removals do", () => {
  const [pc, phone] = pair((data) => {
    for (let i = 0; i < 8; i++) upsertEntry(data, { kind: "note", title: `Mock ${i}`, spaceId: PERSONAL, body: "x" });
  });
  change(phone, later(), (data) => {
    for (const e of data.entries.slice()) trashEntry(data, e.id, Date.now());
  });
  const before = pc.data;
  const { data } = merge(before, phone.data, HOST);
  const changes = syncChanges(before, data);
  assert.equal(changes.trashed.length, 8);
  assert.deepEqual(changes.deleted, []);
  assert.deepEqual(reviewReasons(changes, before.entries.length), ["deletes"]);
  const few = { ...changes, trashed: changes.trashed.slice(0, 2) };
  assert.deepEqual(reviewReasons(few, 500), []);
  assert.deepEqual(reviewReasons({ ...few, deleted: ["a", "b", "c", "d"] }, 500), ["deletes"], "removals and trash moves add up");
});
