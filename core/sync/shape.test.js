import { test } from "node:test";
import assert from "node:assert/strict";
import { newSync, readSync, validSync, addKey, registerDevice, newEpoch, revokeDevice, SHARED_FIELDS } from "./shape.js";
import { ZERO } from "./hlc.js";

const SALT = "AAAAAAAAAAAAAAAAAAAAAA==";
const PC = "0b8c8e52-1b7e-4d8e-9a53-6f0c1d2e3f40";
const PHONE = "7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const oldVault = () => ({
  spaces: [{ id: "space-client", name: "Mock Client", kind: "client" }, { id: "space-personal", name: "Personal", kind: "personal" }],
  entries: [{ id: "e1", kind: "login", spaceId: "space-personal", title: "Mock Portal", password: "mock-pw" }],
  cloud: { bucket: "mock-bucket" },
});

test("a vault saved before sync gets a fresh sync object that stamps nothing", () => {
  const sync = readSync(oldVault(), SALT);
  assert.deepEqual(sync, { v: 1, vaultId: "space-personal", epoch: { id: "space-personal", at: ZERO }, keys: [{ salt: SALT, n: 1, at: ZERO, by: "" }], clock: ZERO, meta: {}, gone: {}, histFloor: {}, devices: {} });
  assert.deepEqual(readSync(oldVault(), SALT), sync, "two devices opening the same old vault agree on it");
});

test("only spaces, entries and sync are shared; cloud and the rest stay on their device", () => {
  assert.deepEqual(SHARED_FIELDS, ["spaces", "entries", "sync"]);
});

test("a valid sync object reads back as it was", () => {
  const sync = {
    ...newSync(oldVault(), SALT),
    clock: [500, 2, PC],
    meta: { e1: { vv: { [PC]: 2, [PHONE]: 1 }, g: { core: { dot: [PC, 2], at: [500, 2, PC] }, pw: { dot: [PHONE, 1], at: [400, 0, PHONE] } }, h: "a".repeat(64) } },
    gone: { e9: { vv: { [PC]: 1 }, at: [300, 0, PC] } },
    histFloor: { e1: [450, 0, PC] },
    devices: { [PC]: { name: "Mock PC", platform: "win32", addedAt: [100, 0, PC] }, [PHONE]: { name: "Mock Phone", platform: "android", addedAt: [200, 0, PHONE], revokedAt: [450, 1, PC] } },
  };
  assert.deepEqual(validSync(JSON.parse(JSON.stringify(sync))), sync);
});

test("a peer's malformed fields are dropped one by one, never thrown on", () => {
  const peer = JSON.parse(`{
    "v": 1, "vaultId": "space-personal", "epoch": { "id": "space-personal", "at": [0, 0, ""] }, "clock": "soon",
    "keys": [{ "salt": "${SALT}", "n": 1, "at": [0, 0, ""], "by": "" }, { "salt": "short", "n": 2, "at": [1, 0, "x"], "by": "x" }, null],
    "meta": {
      "e1": { "vv": { "${PC}": 2, "${PHONE}": 0, "": 4, "bad": 1.5 }, "g": { "core": { "dot": ["${PC}", 2], "at": [900, 0, "${PC}"] }, "pw": { "dot": ["${PHONE}", 1], "at": [1, 0, "${PHONE}"] }, "fav": { "dot": ["${PC}", 3], "at": [1, 0, "${PC}"] }, "life": { "dot": ["${PC}", 1], "at": "yesterday" } }, "h": "not-a-hash" },
      "e2": "garbage",
      "__proto__": { "vv": {}, "g": {} }
    },
    "gone": { "e3": { "vv": { "${PC}": 1 }, "at": [5, 0, "${PC}"] }, "e4": { "vv": {} } },
    "histFloor": { "e1": [7, 0, "${PC}"], "e2": [1, 2] },
    "devices": { "${PC}": { "name": "Mock PC", "platform": "win32", "addedAt": [1, 0, "${PC}"], "revokedAt": "never" }, "${PHONE}": { "name": 5 } }
  }`);
  const sync = validSync(peer);
  assert.deepEqual(sync.keys, [{ salt: SALT, n: 1, at: [0, 0, ""], by: "" }]);
  assert.deepEqual(sync.meta.e1, { vv: { [PC]: 2 }, g: { core: { dot: [PC, 2], at: [900, 0, PC] } } }, "uncovered dots, bad counters, bad times and a bad hash go");
  assert.equal(sync.meta.e2, undefined);
  assert.ok(Object.hasOwn(sync.meta, "__proto__") && Object.getPrototypeOf(sync.meta) === Object.prototype, "a __proto__ id stays a plain key");
  assert.deepEqual(Object.keys(sync.gone), ["e3"]);
  assert.deepEqual(sync.histFloor, { e1: [7, 0, PC] });
  assert.deepEqual(sync.devices, { [PC]: { name: "Mock PC", platform: "win32", addedAt: [1, 0, PC] } });
  assert.deepEqual(sync.clock, [900, 0, PC], "a bad clock becomes the highest time the object holds");
});

test("a sync object with no readable identity is refused whole", () => {
  const good = newSync(oldVault(), SALT);
  for (const bad of [null, undefined, [], "sync", 7, {}, { ...good, v: 2 }, { ...good, vaultId: "" }, { ...good, vaultId: 5 }, { ...good, epoch: null }, { ...good, epoch: { id: "x", at: [1] } }]) {
    assert.equal(validSync(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(readSync({ ...oldVault(), sync: { v: 2 } }, SALT), newSync(oldVault(), SALT), "an unreadable one is replaced like a vault saved before sync");
});

test("the clock is never behind a time the object holds", () => {
  const sync = { ...newSync(oldVault(), SALT), clock: [10, 0, PC], gone: { e1: { vv: { [PC]: 1 }, at: [20, 3, PC] } } };
  assert.deepEqual(validSync(sync).clock, [20, 3, PC]);
});

test("a master password change adds the new salt as the newest key", () => {
  const next = "BBBBBBBBBBBBBBBBBBBBBB==";
  const sync = newSync(oldVault(), SALT);
  const rekeyed = addKey(sync, { salt: next, installId: PC, now: 1000 });
  assert.deepEqual(rekeyed.keys.at(-1), { salt: next, n: 2, at: [1000, 0, PC], by: PC });
  assert.deepEqual(rekeyed.clock, [1000, 0, PC]);
  assert.equal(sync.keys.length, 1, "the old object is not edited");
});

test("a restore made the vault everywhere gets a new epoch, after everything the vault has seen", () => {
  const sync = { ...newSync(oldVault(), SALT), clock: [5000, 2, PHONE] };
  const next = newEpoch(sync, { id: "epoch-2", installId: PC, now: 1000 });
  assert.deepEqual(next.epoch, { id: "epoch-2", at: [5000, 3, PC] });
  assert.deepEqual(next.clock, [5000, 3, PC]);
  assert.equal(sync.epoch.id, sync.vaultId, "the old object is not edited");
});

test("removing a device from sync: known or not, and the first removal stands", () => {
  const sync = registerDevice(newSync(oldVault(), SALT), { installId: PHONE, name: "Mock Phone", platform: "android", now: 1000 });
  const revoked = revokeDevice(sync, { id: PHONE, installId: PC, now: 2000 });
  assert.deepEqual(revoked.devices[PHONE], { name: "Mock Phone", platform: "android", addedAt: [1000, 0, PHONE], revokedAt: [2000, 0, PC] });
  assert.deepEqual(revoked.clock, [2000, 0, PC]);
  assert.equal(revokeDevice(revoked, { id: PHONE, installId: PC, now: 3000 }), revoked);
  const stranger = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
  assert.deepEqual(revokeDevice(sync, { id: stranger, installId: PC, now: 2000 }).devices[stranger], { name: "Another device", platform: "", addedAt: ZERO, revokedAt: [2000, 0, PC] });
  assert.equal(validSync(revoked).devices[PHONE].revokedAt[0], 2000, "it reads back");
  assert.equal(sync.devices[PHONE].revokedAt, undefined, "the old object is not edited");
});

test("an install registers once; a new name is a newer record; a revoked one stays revoked", () => {
  const sync = newSync(oldVault(), SALT);
  const me = { installId: PC, name: "Mock PC", platform: "win32", now: 1000 };
  const registered = registerDevice(sync, me);
  assert.deepEqual(registered.devices[PC], { name: "Mock PC", platform: "win32", addedAt: [1000, 0, PC] });
  assert.deepEqual(registered.clock, [1000, 0, PC]);
  assert.equal(registerDevice(registered, { ...me, now: 2000 }), registered, "nothing to write the second time");
  assert.deepEqual(registerDevice(registered, { ...me, name: "Mock PC renamed", now: 900 }).devices[PC].addedAt, [1000, 1, PC], "after the first, even on a clock behind it");
  const revoked = { ...registered, devices: { [PC]: { ...registered.devices[PC], revokedAt: [1500, 0, PHONE] } } };
  assert.equal(registerDevice(revoked, { ...me, name: "Mock PC renamed" }), revoked);
  assert.deepEqual(sync.devices, {}, "the old object is not edited");
});
