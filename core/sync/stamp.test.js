import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { stamp, repair, canonical } from "./stamp.js";
import { newSync, validSync } from "./shape.js";
import { splitGroups } from "./groups.js";
import { addSpace, renameSpace, deleteSpace } from "../spaces.js";
import { removeEntries, touchEntry, clearHistory } from "../entries.js";

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const PC = "0b8c8e52-1b7e-4d8e-9a53-6f0c1d2e3f40";
const PHONE = "7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const at = (now, installId = PC) => ({ installId, now, sha256 });
const SALT = "AAAAAAAAAAAAAAAAAAAAAA==";

const login = { id: "l1", kind: "login", spaceId: "p", title: "Mock Portal", tags: [], favorite: false, notes: "", updatedAt: "2026-09-26", username: "mock.user", password: "mock-pw-1", history: [{ password: "mock-pw-0", changedAt: "2026-01-01" }] };

function vault(entries = [login]) {
  const data = { spaces: [{ id: "p", name: "Personal", kind: "personal" }], entries };
  return { ...data, sync: newSync(data, SALT) };
}

// One save: `change` edits `data` the way core does (replacing fields), then the host stamps.
function save(data, change, context = at(1000)) {
  const saved = { ...data };
  change(data);
  data.sync = stamp(saved, data, context);
  return data.sync;
}

const withEntry = (id, fields) => (data) => (data.entries = data.entries.map((e) => (e.id === id ? { ...e, ...fields } : e)));

test("a change stamps only the field group it touched", () => {
  const cases = [
    [login, { title: "Mock Portal 2" }, "core"],
    [login, { favorite: true }, "fav"],
    [login, { spaceId: "c" }, "space"],
    [login, { password: "mock-pw-2", passwordChangedAt: "2026-09-26" }, "pw"],
    [login, { history: [] }, "history"],
    [login, { totp: "otpauth://totp/Mock?secret=JBSWY3DPEHPK3PXP" }, "totp"],
    [login, { questions: [{ question: "Mock pet?", answer: "mock otter" }] }, "qa"],
    [login, { recoveryCodes: { codes: [{ code: "mock-1111", used: true }] } }, "codes"],
    [login, { lifecycle: { state: "dormant" } }, "life"],
    [{ id: "n1", kind: "note", spaceId: "p", title: "Mock note", body: "a" }, { body: "b" }, "body"],
    [{ id: "k1", kind: "key", spaceId: "p", title: "Mock key", secret: "a" }, { secret: "b" }, "secret"],
    [{ id: "y1", kind: "payee", spaceId: "p", title: "Mock payee", number: "09170000000" }, { number: "09171111111", confirmedAt: undefined }, "pay"],
    [{ id: "d1", kind: "device", spaceId: "p", title: "Mock router", adminPassword: "a" }, { adminPassword: "b" }, "dpw"],
    [{ id: "d1", kind: "device", spaceId: "p", title: "Mock router", wifiPassword: "a" }, { wifiPassword: "b" }, "wifi"],
    [{ id: "d1", kind: "device", spaceId: "p", title: "Mock router" }, { photo: "data:image/jpeg;base64,AAAA" }, "photo"],
  ];
  for (const [entry, fields, group] of cases) {
    const data = vault([entry]);
    const sync = save(data, withEntry(entry.id, fields));
    assert.deepEqual(sync.meta[entry.id].vv, { [PC]: 1 }, group);
    assert.deepEqual(sync.meta[entry.id].g, { [group]: { dot: [PC, 1], at: [1000, 0, PC] } }, group);
    assert.equal(sync.meta[entry.id].h, sha256(canonical(splitGroups({ ...entry, ...fields }))), group);
  }
});

test("a second edit on the same device moves the counter and only that group's dot", () => {
  const data = vault();
  save(data, withEntry("l1", { title: "Mock 2" }), at(1000));
  const sync = save(data, withEntry("l1", { favorite: true }), at(2000));
  assert.deepEqual(sync.meta.l1.vv, { [PC]: 2 });
  assert.deepEqual(sync.meta.l1.g, { core: { dot: [PC, 1], at: [1000, 0, PC] }, fav: { dot: [PC, 2], at: [2000, 0, PC] } });
  assert.deepEqual(sync.clock, [2000, 0, PC]);
});

test("an item that is still the same object is never compared or hashed", () => {
  let hashed = 0;
  const counting = { installId: PC, now: 1000, sha256: (t) => (hashed++, sha256(t)) };
  const data = vault([login, { id: "n1", kind: "note", spaceId: "p", title: "Mock note", body: "a" }]);
  const same = save(data, () => {}, counting);
  assert.equal(same, data.sync, "nothing replaced: the same sync object");
  save(data, withEntry("n1", { body: "b" }), counting);
  assert.equal(hashed, 1, "only the replaced note");
});

test("a new item stamps every group it has, with its content hash", () => {
  const data = vault([]);
  const sync = save(data, (d) => (d.entries = [login]));
  assert.deepEqual(Object.keys(sync.meta.l1.g).sort(), ["core", "history", "pw", "space", "fav"].sort());
  assert.match(sync.meta.l1.h, /^[0-9a-f]{64}$/);
});

test("a delete leaves a content-free tombstone that has seen every change to the item", () => {
  const data = vault();
  save(data, withEntry("l1", { title: "Mock 2" }), at(1000));
  const sync = save(data, (d) => removeEntries(d, new Set(["l1"])), at(2000));
  assert.deepEqual(sync.gone, { l1: { vv: { [PC]: 2 }, at: [2000, 0, PC] } });
  assert.equal(sync.meta.l1, undefined);
  assert.equal(JSON.stringify(sync).includes("mock-pw"), false, "no content in the tombstone");
});

test("an item never stamped before (from before sync) starts its vector at this change", () => {
  const data = vault();
  assert.deepEqual(save(data, (d) => removeEntries(d, new Set(["l1"]))).gone.l1.vv, { [PC]: 1 });
});

test("dropping a sign-in link because its account was deleted is not an edit of the login", () => {
  const google = { ...login, id: "g1", title: "Mock Google" };
  const data = vault([google, { ...login, viaEntryId: "g1", signIn: "google" }]);
  const sync = save(data, (d) => removeEntries(d, new Set(["g1"])));
  assert.equal(sync.meta.l1, undefined, "the login is not stamped");
  assert.ok(sync.gone.g1);
});

test("spaces are stamped as s:<id>: added, renamed, deleted", () => {
  const data = vault();
  let id;
  save(data, (d) => (id = addSpace(d, "Mock Client")), at(1000));
  assert.deepEqual(data.sync.meta[`s:${id}`].g, { core: { dot: [PC, 1], at: [1000, 0, PC] } });
  save(data, (d) => renameSpace(d, id, "Mock Client 2"), at(2000));
  assert.deepEqual(data.sync.meta[`s:${id}`].vv, { [PC]: 2 });
  const sync = save(data, (d) => deleteSpace(d, id), at(3000));
  assert.deepEqual(sync.gone[`s:${id}`], { vv: { [PC]: 3 }, at: [3000, 0, PC] });
});

test("using an item (lastUsedAt) never stamps and never moves the clock", () => {
  const data = vault();
  save(data, withEntry("l1", { title: "Mock 2" }), at(1000));
  const before = data.sync;
  const sync = save(data, (d) => touchEntry(d, "l1"), at(5000));
  assert.deepEqual(sync.meta, before.meta);
  assert.deepEqual(sync.clock, before.clock);
});

test("clearing a login's history sets its floor, so older passwords do not merge back", () => {
  const data = vault();
  const sync = save(data, (d) => clearHistory(d, "l1"), at(1000));
  assert.deepEqual(sync.histFloor, { l1: [1000, 0, PC] });
  assert.deepEqual(sync.meta.l1.g, { history: { dot: [PC, 1], at: [1000, 0, PC] } });
});

test("a clock ahead of the wall clock keeps counting up, never back", () => {
  const data = vault();
  save(data, withEntry("l1", { title: "Mock 2" }), at(5000));
  assert.deepEqual(save(data, withEntry("l1", { title: "Mock 3" }), at(1000)).meta.l1.g.core.at, [5000, 1, PC]);
});

test("the same inputs give the same output, and the sync object given is never edited", () => {
  const run = () => {
    const data = vault();
    Object.freeze(data.sync.meta);
    Object.freeze(data.sync);
    save(data, withEntry("l1", { title: "Mock 2", favorite: true }), at(1000));
    return save(data, (d) => removeEntries(d, new Set(["l1"])), at(2000));
  };
  assert.deepEqual(run(), run());
});

test("no install id this run: nothing is stamped", () => {
  const data = vault();
  const before = data.sync;
  assert.equal(save(data, withEntry("l1", { title: "Mock 2" }), at(1000, "")), before);
});

test("repair: an edit by an app without sync is stamped as this device's, every group", () => {
  const data = vault();
  save(data, withEntry("l1", { title: "Mock 2" }), at(1000));
  withEntry("l1", { password: "changed-by-old-build" })(data); // written by a build that does not stamp
  const sync = repair(data, at(2000));
  assert.deepEqual(sync.meta.l1.vv, { [PC]: 2 });
  assert.deepEqual(Object.keys(sync.meta.l1.g).sort(), ["core", "fav", "history", "pw", "space"]);
  assert.ok(Object.values(sync.meta.l1.g).every((s) => s.dot[1] === 2));
  assert.equal(repair({ ...data, sync }, at(3000)), sync, "a repaired vault needs no second repair");
});

test("repair: a delete by an app without sync becomes a tombstone; legacy items are left alone", () => {
  const legacy = { ...login, id: "l2" };
  const data = vault([login, legacy]);
  save(data, withEntry("l1", { title: "Mock 2" }), at(1000));
  data.entries = data.entries.filter((e) => e.id !== "l1"); // removed by a build that does not stamp
  withEntry("l2", { title: "edited by old build" })(data);
  const sync = repair(data, at(2000));
  assert.deepEqual(sync.gone.l1, { vv: { [PC]: 2 }, at: [2000, 0, PC] });
  assert.equal(sync.meta.l2, undefined, "no metadata, nothing to compare: it stays a legacy item");
});

test("repair on an untouched vault changes nothing", () => {
  const data = vault();
  save(data, withEntry("l1", { title: "Mock 2" }), at(1000));
  assert.equal(repair(data, at(2000)), data.sync);
});

// Random vaults and random edits, deletes and odd values: stamping never throws, and what it writes
// always reads back through validSync unchanged.
test("stamp and repair never throw, and always write a sync object that validates", () => {
  let seed = 7;
  const rand = (n) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
  const kinds = ["login", "note", "key", "payee", "thing", "device", "link", "fromTheFuture", undefined];
  const values = [undefined, null, "", "x", 0, -1.5, true, [], ["a"], [{ password: "p", changedAt: "2026-01-01" }], { state: "gone" }, { nested: [null, { deep: 1 }] }];
  const fields = ["title", "password", "history", "totp", "body", "secret", "number", "photo", "lifecycle", "spaceId", "favorite", "viaEntryId", "lastUsedAt", "someNewField"];
  const randomEntry = (id) => Object.fromEntries([["id", id], ["kind", kinds[rand(kinds.length)]], ...fields.filter(() => rand(2)).map((f) => [f, values[rand(values.length)]])]);
  for (let run = 0; run < 300; run++) {
    const data = vault(Array.from({ length: rand(6) }, (_, i) => randomEntry(`e${i}`)));
    for (let step = 0; step < 5; step++) {
      const device = rand(2) ? PC : PHONE;
      save(data, (d) => {
        d.entries = d.entries.filter(() => rand(5)).map((e) => (rand(2) ? { ...e, ...randomEntry(e.id) } : e));
        if (rand(2)) d.entries = [...d.entries, randomEntry(`n${run}-${step}`)];
        if (rand(3) === 0) d.spaces = [...d.spaces, { id: `s${step}`, name: "Mock", kind: "client" }];
      }, at(1000 + rand(3000), device));
      if (rand(3) === 0) data.entries = data.entries.slice(1); // an old build's delete
      data.sync = repair(data, at(1000 + rand(3000), device));
      assert.deepEqual(validSync(JSON.parse(JSON.stringify(data.sync))), JSON.parse(JSON.stringify(data.sync)));
    }
  }
});
