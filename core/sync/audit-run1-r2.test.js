// Regression tests for the audit run-1 round-2 sync findings (4.2 adoptEpoch + closeOver rule, lead 4).
// Real stamp/merge/clean code, a faked clock and ids, mock names only.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { adoptEpoch, merge } from "./merge.js";
import { newEpoch } from "./shape.js";
import { stamp } from "./stamp.js";
import { DEVICES, firstSync } from "./test-helpers.js";
import { moveEntry, toggleFavorite, upsertEntry } from "../entries.js";
import { confirmGone } from "../lifecycle.js";
import { setRecoveryCodes } from "../recovery-codes.js";

const T0 = Date.UTC(2026, 8, 1, 2);
let uuids = 0;
mock.timers.enable({ apis: ["Date"], now: T0 });
mock.method(globalThis.crypto, "randomUUID", () => `id-${++uuids}`);

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const HOST = { sha256 };
const PERSONAL = "space-personal";
const OTHER = "space-other";
let wall = T0;
const later = () => (wall += 60 * 60 * 1000);
const COPY = / \((conflict copy|changed after closing), /;
const AFTER_CLOSING = / \(changed after closing, /;

function devices(count, fill) {
  mock.timers.setTime(T0);
  uuids = 0;
  const vault = { spaces: [{ id: PERSONAL, name: "Personal", kind: "personal" }, { id: OTHER, name: "Other", kind: "client" }], entries: [] };
  fill(vault);
  const base = { ...vault, sync: firstSync(vault) };
  wall = T0;
  return DEVICES.slice(0, count).map((spec) => ({ ...spec, data: { ...base } }));
}
function change(dev, at, edit) {
  mock.timers.setTime(at);
  const data = { ...dev.data };
  edit(data);
  data.sync = stamp(dev.data, data, { installId: dev.id, now: at, sha256 });
  dev.data = data;
}
const find = (dev, title) => dev.data.entries.find((e) => e.title === title);
const edit = (dev, title, fields) => change(dev, later(), (data) => upsertEntry(data, { ...find(dev, title), ...fields }));
const pull = (dev, other) => {
  dev.data = merge(dev.data, other.data, HOST).data;
};
const bank = (data) => {
  upsertEntry(data, { kind: "login", title: "Mock Bank", spaceId: PERSONAL, username: "mock.user", url: "https://bank.example", notes: "mock notes", password: "old-pass", totp: "JBSWY3DPEHPK3PXP", questions: [{ question: "Mock pet?", answer: "dummy-answer" }] });
};
const dump = (entry) => JSON.stringify(entry);
const WIPED = ["old-pass", "JBSWY3DPEHPK3PXP", "dummy-answer", "aaaa-1111"];

// PC closes the account; the phone, which never saw the closing, then makes `lag`.
function closed(lag) {
  const [pc, phone] = devices(2, bank);
  const id = find(pc, "Mock Bank").id;
  change(pc, later(), (data) => setRecoveryCodes(data, id, ["aaaa-1111", "bbbb-2222", "cccc-3333", "dddd-4444"]));
  pull(phone, pc);
  change(pc, later(), (data) => confirmGone(data, id, false));
  lag(phone);
  return { pc, phone, id };
}
const noWipedSecret = (entry, except = []) => {
  for (const secret of WIPED.filter((s) => !except.includes(s))) assert.equal(dump(entry).includes(secret), false, `${entry.title} holds ${secret}`);
};

// --- closeOver: the core group -------------------------------------------------------------------------

test("4.2: a lagging device's notes, username or url edit makes a 'changed after closing' copy without the wiped secrets", () => {
  const cases = [
    ["notes", { notes: "phone notes" }],
    ["username", { username: "phone.user" }],
    ["url", { url: "https://phone.example" }],
    ["title and notes", { title: "Renamed Bank", notes: "phone notes" }],
  ];
  for (const [label, fields] of cases) {
    const { pc, phone, id } = closed((p) => edit(p, "Mock Bank", fields));
    for (const data of [merge(pc.data, phone.data, HOST).data, merge(phone.data, pc.data, HOST).data]) {
      assert.equal(data.entries.find((e) => e.id === id).lifecycle.state, "gone", label);
      const copies = data.entries.filter((e) => COPY.test(e.title));
      assert.equal(copies.length, 1, `${label}: one copy`);
      const [copy] = copies;
      assert.match(copy.title, AFTER_CLOSING, label);
      for (const [field, value] of Object.entries(fields)) if (field !== "title") assert.equal(copy[field], value, `${label}: ${field}`);
      assert.equal(copy.password, undefined, label);
      assert.equal(copy.history, undefined, label);
      noWipedSecret(copy);
    }
  }
});

test("4.2: a title, move or favorite edit on a lagging device still makes no copy", () => {
  const lags = [
    (p) => edit(p, "Mock Bank", { title: "Renamed Bank" }),
    (p) => change(p, later(), (data) => moveEntry(data, find(p, "Mock Bank").id, OTHER)),
    (p) => change(p, later(), (data) => toggleFavorite(data, find(p, "Mock Bank").id)),
    (p) => edit(p, "Mock Bank", { title: "Renamed Bank", tags: ["x"], favorite: true }),
  ];
  for (const lag of lags) {
    const { pc, phone } = closed(lag);
    for (const data of [merge(pc.data, phone.data, HOST).data, merge(phone.data, pc.data, HOST).data]) assert.equal(data.entries.filter((e) => COPY.test(e.title)).length, 0);
  }
});

test("4.2: a copy holds only the unseen secret, never a secret the closing wiped that the lagging device did not change", () => {
  const { pc, phone } = closed((p) => edit(p, "Mock Bank", { title: "Renamed Bank", totp: "KRSXG5CTMVRXEZLU", notes: "phone notes" }));
  for (const data of [merge(pc.data, phone.data, HOST).data, merge(phone.data, pc.data, HOST).data]) {
    const [copy] = data.entries.filter((e) => COPY.test(e.title));
    assert.ok(copy.totp.includes("KRSXG5CTMVRXEZLU"));
    assert.equal(copy.notes, "phone notes");
    noWipedSecret(copy);
    assert.equal(copy.questions, undefined);
    assert.equal(copy.recoveryCodes, undefined);
    assert.equal(copy.password, undefined);
  }
});

// --- adoptEpoch: an item the restored vault holds as closed ------------------------------------------

function adopted(lag) {
  const { pc, phone } = closed(lag);
  mock.timers.setTime(later());
  const everywhere = { ...pc.data, sync: newEpoch(pc.data.sync, { id: "epoch-2", installId: "dev-a", now: Date.now() }) };
  return adoptEpoch(phone.data, everywhere, HOST).data;
}

test("4.2: an epoch adopted over a closed account makes no copy for a title, move or favorite edit", () => {
  const lags = [
    (p) => edit(p, "Mock Bank", { title: "Renamed Bank" }),
    (p) => change(p, later(), (data) => moveEntry(data, find(p, "Mock Bank").id, OTHER)),
    (p) => change(p, later(), (data) => toggleFavorite(data, find(p, "Mock Bank").id)),
  ];
  for (const lag of lags) {
    const data = adopted(lag);
    assert.equal(data.entries.filter((e) => COPY.test(e.title)).length, 0);
    for (const entry of data.entries) noWipedSecret(entry);
  }
});

test("4.2: an epoch adopted over a closed account copies only what the lagging device changed", () => {
  for (const fields of [{ title: "Renamed Bank", totp: "KRSXG5CTMVRXEZLU" }, { notes: "phone notes" }, { password: "phone-pass", title: "Renamed Bank" }]) {
    const data = adopted((p) => edit(p, "Mock Bank", fields));
    const copies = data.entries.filter((e) => COPY.test(e.title));
    assert.equal(copies.length, 1, JSON.stringify(fields));
    assert.match(copies[0].title, AFTER_CLOSING);
    for (const [field, value] of Object.entries(fields)) if (field !== "title") assert.ok(String(copies[0][field]).includes(value), field);
    noWipedSecret(copies[0]);
    for (const entry of data.entries.filter((e) => !COPY.test(e.title))) noWipedSecret(entry);
  }
});

// --- the three-device case -----------------------------------------------------------------------------

// OPEN: reproduces (the copy is a whole-item copy of a live item, unlinked to its original, so the later closing
// cannot reach it). A narrower copy breaks the intended "a lost password goes to the copy" rule; the real fix
// needs a link from a copy to its original (a format change), so this stays a todo for the orchestrator to decide.
test("4.2: a live-vs-live conflict copy made before either device saw the closing", { todo: "needs a copy-to-original link" }, () => {
  const [pc, phone, tablet] = devices(3, bank);
  const id = find(pc, "Mock Bank").id;
  edit(phone, "Mock Bank", { title: "Phone Title" });
  edit(tablet, "Mock Bank", { title: "Tablet Title", notes: "tablet notes" });
  change(pc, later(), (data) => confirmGone(data, id, true));
  pull(phone, tablet);
  for (const [a, b] of [[pc, phone], [phone, pc], [pc, tablet], [tablet, pc], [phone, tablet], [tablet, phone], [pc, phone]]) pull(a, b);
  const leaked = pc.data.entries.filter((e) => e.id !== id && WIPED.slice(0, 3).some((s) => dump(e).includes(s)));
  assert.deepEqual(leaked.map((e) => e.title), [], "an entry that holds the wiped secrets");
});
