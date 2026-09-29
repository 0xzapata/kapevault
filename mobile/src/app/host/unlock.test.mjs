// The files a crash must not break, the wrong-password throttle, and fingerprint unlock's 14-day rule
// with the PC's v2 seal.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createStore } from "./storage.ts";
import { createThrottle } from "./throttle.ts";
import { MASTER_DUE, MASTER_EVERY_MS, SEALED, createBiometric, sealOf } from "./biometric.ts";
import { fakeKeystore, nodeFs, pc, tempDir } from "./test/fixtures.mjs";

const DAY = 86_400_000;
const open = async (key) => ({ key }); // the vault opened with that key

test("a crash inside the plugin's delete-then-rename leaves the new file, and reading finishes the swap", async () => {
  const dir = tempDir();
  let crash = false;
  const store = createStore(nodeFs(dir, { crash: () => crash }));
  await store.write("vault.kapevault", "old");
  crash = true;
  await assert.rejects(store.write("vault.kapevault", "new"));
  assert.ok(!fs.existsSync(path.join(dir, "vault.kapevault")), "the gap: only the .next file is left");
  crash = false;
  assert.equal(await store.read("vault.kapevault"), "new");
  assert.deepEqual(fs.readdirSync(dir), ["vault.kapevault"]);
});

test("a half-made file never replaces the real one, and a leftover that is not valid is never swapped in", async () => {
  const dir = tempDir();
  const store = createStore(nodeFs(dir, { write: (name) => name === "a.json.next" && (fs.writeFileSync(path.join(dir, name), "{hal"), true) }));
  await createStore(nodeFs(dir)).write("b.json", "{}");
  fs.writeFileSync(path.join(dir, "b.json.next"), "{half");
  assert.equal(await store.read("b.json"), "{}", "the swap never started: the file is as it was");
  assert.ok(!fs.existsSync(path.join(dir, "b.json.next")));
  await assert.rejects(store.write("a.json", "{}"), /disk full/);
  assert.equal(await store.read("a.json", (t) => t.startsWith("{}")), null, "no finished a.json, and the half one is not taken for it");
});

test("throttle: five misses in a row, then a growing pause; kept across a restart; a success clears it", async () => {
  const dir = tempDir();
  let t = 1_000_000;
  const slept = [];
  const make = () => createThrottle(createStore(nodeFs(dir)), () => t, async (ms) => (slept.push(ms), (t += ms)));
  let throttled = make();
  const miss = () => throttled(async () => ({ ok: false }));
  for (let i = 0; i < 5; i++) await miss();
  assert.deepEqual(slept, [], "no pause for the first five");
  await miss();
  assert.deepEqual(slept, [1000]);
  throttled = make(); // the app was closed and opened again
  await miss();
  assert.deepEqual(slept, [1000, 2000]);
  await throttled(async () => ({ ok: false, rule: true })); // waits its turn, but is not a guess
  await miss();
  await miss();
  assert.deepEqual(slept, [1000, 2000, 4000, 8000], "8 misses, not 9");
  for (let i = 0; i < 6; i++) await miss();
  assert.equal(slept.at(-1), 30_000, "capped at 30 s");
  await throttled(async () => ({ ok: true }));
  assert.ok(!fs.existsSync(path.join(dir, "unlock-throttle.json")), "a success deletes the count");
  const before = slept.length;
  await miss();
  assert.equal(slept.length, before);
});

test("the phone's seal is the PC's sealOf over the same fields", async () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const record = { version: 2, masterAt: 1_700_000_000_000, highWater: 1_700_000_500_000 };
  assert.equal(await sealOf(key, record), pc.biometric.sealOf(Buffer.from(key), record, [...SEALED]).toString("base64"));
});

function biometricAt(dir) {
  const clock = { t: Date.UTC(2026, 8, 27) };
  const keystore = fakeKeystore();
  const bio = createBiometric({ keystore, store: createStore(nodeFs(dir)), now: () => clock.t });
  return { clock, keystore, bio, file: path.join(dir, "fingerprint.json") };
}

test("fingerprint unlock: the master password every 14 days, and a clock set back", async () => {
  const { clock, bio } = biometricAt(tempDir());
  const key = crypto.getRandomValues(new Uint8Array(32));
  assert.deepEqual(await bio.enable(key, clock.t - 2 * DAY), { ok: true });
  assert.deepEqual(await bio.status(), { available: true, enabled: true, needsMaster: false });
  const unlocked = await bio.unlock(open);
  assert.equal(unlocked.ok, true);
  assert.deepEqual([...unlocked.opened.key], [...key]);
  assert.equal(unlocked.masterAt, clock.t - 2 * DAY, "the session carries the date the master was last typed");

  clock.t += MASTER_EVERY_MS - 2 * DAY + 1;
  assert.equal((await bio.status()).needsMaster, true, "14 days after the master password was TYPED, not enabled");
  assert.deepEqual(await bio.unlock(open), { ok: false, code: "failed", error: MASTER_DUE });
  await bio.touchMaster(key);
  assert.equal((await bio.status()).needsMaster, false, "typing it starts the 14 days again");

  clock.t -= 2 * DAY;
  assert.equal((await bio.status()).needsMaster, true, "a clock set back more than a day behind the latest time seen");
  clock.t += 2 * DAY;
  assert.equal((await bio.status()).needsMaster, false);
});

test("fingerprint unlock: edited dates fail the seal and ask for the master password, which seals them again", async () => {
  const dir = tempDir();
  const { clock, bio, file } = biometricAt(dir);
  const key = crypto.getRandomValues(new Uint8Array(32));
  await bio.enable(key, clock.t - 13 * DAY);
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...record, masterAt: clock.t })); // "I typed it just now"
  assert.equal((await bio.status()).needsMaster, false, "the dates alone look fine");
  assert.deepEqual(await bio.unlock(open), { ok: false, code: "failed", error: MASTER_DUE });
  assert.equal((await bio.status()).needsMaster, true, "and now it asks, instead of failing on every try");
  await bio.touchMaster(key);
  assert.equal((await bio.unlock(open)).ok, true);
});

test("fingerprint unlock: a wrap whose key no longer opens the vault is 'changed' and turned off", async () => {
  const { clock, bio } = biometricAt(tempDir());
  await bio.enable(crypto.getRandomValues(new Uint8Array(32)), clock.t);
  const result = await bio.unlock(async () => null);
  assert.equal(result.code, "changed");
  assert.equal((await bio.status()).enabled, false);
});

test("fingerprint unlock: new fingerprints, a stale wrap after a key change, and cancel", async () => {
  const { clock, keystore, bio, file } = biometricAt(tempDir());
  const key = crypto.getRandomValues(new Uint8Array(32));
  await bio.enable(key, clock.t);
  keystore.next = "canceled";
  assert.equal((await bio.unlock(open)).code, "canceled");
  assert.equal((await bio.status()).enabled, true, "cancel keeps it on");
  keystore.next = "changed";
  assert.equal((await bio.unlock(open)).code, "changed");
  assert.deepEqual(await bio.status(), { available: true, enabled: false, needsMaster: false });
  assert.ok(!fs.existsSync(file), "the dates go with the wrap");

  keystore.next = "approve";
  await bio.enable(key, clock.t);
  await bio.touchMaster(crypto.getRandomValues(new Uint8Array(32))); // the vault was re-keyed and the disable failed
  assert.equal((await bio.status()).enabled, false, "a wrap of another key is turned off");
});
