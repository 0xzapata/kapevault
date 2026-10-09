// KAPEVault Pro's rule (pro.ts): what it unlocks, what Play's answers do to the kept state, and that a
// phone which never touched Pro never asks Google Play.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { canAddClient, canPlaceIn, createPro, nextEntitlement, shouldQuery, snapshotNote, syncAllowed } from "./pro.ts";
import { createStore } from "./storage.ts";
import { nodeFs, tempDir } from "./test/fixtures.mjs";

const FREE = { owned: false, pending: false };
const OWNED = { owned: true, pending: false };
const VAULT = {
  spaces: [
    { id: "personal", kind: "personal" },
    { id: "acme", kind: "client" },
    { id: "globex", kind: "client" },
  ],
  entries: [{ id: "e-acme", spaceId: "acme" }],
};

test("Pro unlocks sync and client folders; without it a snapshot is backup-only", () => {
  assert.equal(syncAllowed(true), true);
  assert.equal(syncAllowed(false), false);
  assert.equal(snapshotNote(true), "");
  assert.equal(snapshotNote(false), "backup-only");
  assert.equal(canAddClient(true), true);
  assert.equal(canAddClient(false), false);
});

test("without Pro an item goes to Personal or stays in its own client folder", () => {
  assert.equal(canPlaceIn(false, VAULT, { spaceId: "personal" }), true, "a new item in Personal");
  assert.equal(canPlaceIn(false, VAULT, { spaceId: "acme" }), false, "a new item in a client");
  assert.equal(canPlaceIn(false, VAULT, { id: "e-acme", spaceId: "acme" }), true, "an edit that leaves it where it is");
  assert.equal(canPlaceIn(false, VAULT, { id: "e-acme", spaceId: "personal" }), true, "moved out to Personal");
  assert.equal(canPlaceIn(false, VAULT, { id: "e-acme", spaceId: "globex" }), false, "moved to another client");
  assert.equal(canPlaceIn(false, VAULT, { id: "e-new", spaceId: "acme" }), false, "an id that is not there yet is a new item");
  assert.equal(canPlaceIn(true, VAULT, { spaceId: "globex" }), true);
});

test("Play's answer decides; no answer keeps what was kept", () => {
  assert.deepEqual(nextEntitlement(FREE, { ok: true, owned: true, pending: false }), OWNED);
  assert.deepEqual(nextEntitlement(OWNED, { ok: true, owned: false, pending: false }), FREE, "a refund clears Pro");
  assert.deepEqual(nextEntitlement(OWNED, { ok: false }), OWNED, "offline keeps Pro");
  assert.deepEqual(nextEntitlement(FREE, { ok: false }), FREE);
  assert.deepEqual(nextEntitlement(FREE, { ok: true, owned: false, pending: true }), { owned: false, pending: true });
  assert.deepEqual(nextEntitlement(FREE, { ok: true, owned: true, pending: true }), OWNED, "owned wins over pending");
});

test("Play is asked by itself only after this install bought Pro or waits on a payment", () => {
  assert.equal(shouldQuery(FREE), false);
  assert.equal(shouldQuery(OWNED), true);
  assert.equal(shouldQuery({ owned: false, pending: true }), true);
});

// A fake Play: answers from `play`, counts the calls, rejects with a code when `fail` is set.
function fakeBilling(play = { owned: false, pending: false, price: "US$9.99" }) {
  const b = { play, calls: 0, fail: null };
  const reject = () => Promise.reject(Object.assign(new Error(b.fail), { code: b.fail }));
  return Object.assign(b, {
    async status() {
      b.calls++;
      return b.fail ? reject() : { ...b.play };
    },
    async buy() {
      b.calls++;
      if (b.fail) return reject();
      b.play = { ...b.play, owned: true };
      return { owned: true, pending: false };
    },
  });
}

const settle = () => new Promise((r) => setTimeout(r, 10));

test("a fresh install never contacts Play on start or resume; looking at the sheet writes nothing", async () => {
  const dir = tempDir();
  const billing = fakeBilling();
  const pro = createPro({ store: createStore(nodeFs(dir)), billing, onChange: () => {} });
  await pro.load();
  pro.resumed();
  await settle();
  assert.equal(billing.calls, 0);
  assert.deepEqual(await pro.ask(), { ok: true, owned: false, pending: false, price: "US$9.99" });
  assert.equal(billing.calls, 1);
  assert.ok(!fs.existsSync(path.join(dir, "pro.json")), "nothing kept, so the next start asks nothing");
});

test("a purchase is kept in pro.json, works offline, and a refund clears it on the next answer", async () => {
  const dir = tempDir();
  const billing = fakeBilling();
  const flips = [];
  const first = createPro({ store: createStore(nodeFs(dir)), billing, onChange: (flipped) => flips.push(flipped) });
  await first.load();
  assert.deepEqual(await first.buy(), { ok: true, owned: true, pending: false, price: undefined });
  assert.deepEqual(flips, [true], "Pro came");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "pro.json"), "utf8")), OWNED);

  billing.fail = "failed"; // offline
  const again = createPro({ store: createStore(nodeFs(dir)), billing, onChange: () => {} });
  await again.load();
  await settle();
  assert.equal(again.owned, true, "no answer keeps Pro");
  assert.equal(billing.calls, 2, "an owner's start asks Play");

  billing.fail = null;
  billing.play = { owned: false, pending: false };
  again.resumed();
  await settle();
  assert.equal(again.owned, false, "refunded");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "pro.json"), "utf8")), FREE);
});

test("a pending payment is asked about until it comes through", async () => {
  const dir = tempDir();
  const billing = fakeBilling({ owned: false, pending: true });
  const flips = [];
  const pro = createPro({ store: createStore(nodeFs(dir)), billing, onChange: (flipped) => flips.push(flipped) });
  await pro.load();
  assert.deepEqual(await pro.ask(), { ok: true, owned: false, pending: true, price: undefined });
  billing.play = { owned: true, pending: false };
  pro.resumed();
  await settle();
  assert.equal(pro.owned, true);
  assert.deepEqual(flips, [false, true], "a pending payment is not Pro; its coming through is");
});

test("a status asked before a buy answered never takes Pro away again; it only brings the price", async () => {
  const billing = fakeBilling();
  let answer;
  billing.status = () => new Promise((r) => (answer = r));
  const pro = createPro({ store: createStore(nodeFs(tempDir())), billing, onChange: () => {} });
  const asking = pro.ask();
  assert.equal((await pro.buy()).owned, true);
  answer({ owned: false, pending: false, price: "US$9.99" });
  assert.deepEqual(await asking, { ok: true, owned: true, pending: false, price: "US$9.99" });
  assert.equal(pro.owned, true);
});

test("Buy: closed says nothing, no Play Store and a failure say so; no billing at all is unavailable", async () => {
  const store = createStore(nodeFs(tempDir()));
  const billing = fakeBilling();
  const pro = createPro({ store, billing, onChange: () => {} });
  billing.fail = "canceled";
  assert.deepEqual(await pro.buy(), { ok: false, canceled: true, error: "" });
  billing.fail = "unavailable";
  assert.match((await pro.buy()).error, /Google Play is not on this phone/);
  billing.fail = "failed";
  assert.match((await pro.ask()).error, /did not answer/);
  assert.equal(pro.owned, false);
  const none = createPro({ store, onChange: () => {} });
  assert.match((await none.buy()).error, /Google Play is not on this phone/);
});

test("a build without Google Play Billing (the foss flavor) says Pro is not available in it", async () => {
  // Capacitor's answer for a plugin that has no such method (mobile/android/app/src/foss BillingPlugin.kt).
  const billing = fakeBilling();
  billing.fail = "UNIMPLEMENTED";
  const pro = createPro({ store: createStore(nodeFs(tempDir())), billing, onChange: () => {} });
  assert.match((await pro.ask()).error, /Pro is not available in this build/);
  assert.match((await pro.buy()).error, /Pro is not available in this build/);
  assert.equal(pro.owned, false);
});

test("a damaged pro.json reads as no Pro, and asks nothing", async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "pro.json"), "{owned");
  const billing = fakeBilling();
  const pro = createPro({ store: createStore(nodeFs(dir)), billing, onChange: () => {} });
  await pro.load();
  assert.equal(pro.owned, false);
  assert.equal(billing.calls, 0);
});
