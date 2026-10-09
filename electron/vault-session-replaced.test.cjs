const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createVaultSession } = require("./vault-session.cjs");
const { tempVault, seeded, refuseWrites } = require("./fixtures/vault-session-helpers.cjs");

// The last step of a slot restore (the staged vault into the slot) failed, or the app died before it.
// saveAfter: the restored vault is saved while that move still fails.
async function slotRestoreLeftStaged(t, { saveAfter = false } = {}) {
  const { file, vault, spaceId } = await seeded();
  const dir = path.dirname(file);
  vault.keepReplacedCopy();
  const slot = fs.readFileSync(path.join(dir, "replaced.kapevault"), "utf8");
  vault.saveEntry({ kind: "note", spaceId, title: "Mock current", body: "b" });
  const current = fs.readFileSync(file);
  const rename = fs.renameSync;
  const refused = t.mock.method(fs, "renameSync", (from, to) => {
    if (from === path.join(dir, "replaced-next.kapevault")) throw Object.assign(new Error("EPERM: mock file locked"), { code: "EPERM" });
    return rename(from, to);
  });
  vault.stageReplacedCopy();
  const result = vault.commitRestore(slot, (await vault.verifyBackup(slot, "correct horse battery orbit gazelle")).opened, { slot: "staged" });
  if (saveAfter) vault.saveEntry({ kind: "note", spaceId, title: "Mock after restore", body: "b" });
  refused.mock.restore();
  return { file, dir, vault, spaceId, current, result };
}

test("restoring the replaced copy itself: the slot is never overwritten before the restore is written, then it swaps", async (t) => {
  const { file, vault, spaceId } = await seeded();
  const dir = path.dirname(file);
  const replaced = path.join(dir, "replaced.kapevault");
  vault.keepReplacedCopy(); // an earlier restore kept "GitHub" only
  const slot = fs.readFileSync(replaced, "utf8");
  vault.saveEntry({ kind: "note", spaceId, title: "Mock current", body: "b" });
  const current = fs.readFileSync(file, "utf8");
  assert.equal(vault.isReplacedCopy(replaced), true);
  assert.equal(vault.isReplacedCopy(file), false);

  // The write fails (and the app could die right after): both vaults are still on disk.
  const opened = (await vault.verifyBackup(slot, "correct horse battery orbit gazelle")).opened;
  vault.stageReplacedCopy();
  const refused = refuseWrites(t);
  assert.throws(() => vault.commitRestore(slot, opened, { slot: "staged" }), /mock disk refused/);
  refused.mock.restore();
  assert.equal(fs.readFileSync(replaced, "utf8"), slot, "the slot was never overwritten");
  assert.equal(fs.readFileSync(file, "utf8"), current);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["replaced.kapevault", "vault.kapevault"], "the staged copy is cleaned up");

  vault.stageReplacedCopy();
  const result = vault.commitRestore(slot, (await vault.verifyBackup(slot, "correct horse battery orbit gazelle")).opened, { slot: "staged" });
  assert.equal(result.slotOk, true);
  assert.deepEqual(result.vault.entries.map((e) => e.title), ["GitHub"]);
  assert.equal(fs.readFileSync(replaced, "utf8"), current, "the slot now holds the vault it replaced - never the same vault twice");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["replaced.kapevault", "vault.kapevault"]);
});

test("a staged vault whose move failed still takes the slot after the restored vault is saved - never stuck", async (t) => {
  const { file, dir, current, result } = await slotRestoreLeftStaged(t, { saveAfter: true });
  assert.equal(result.slotOk, false);
  assert.ok(!fs.readFileSync(file).equals(fs.readFileSync(path.join(dir, "replaced.kapevault"))), "the save moved the vault off the slot's bytes");
  createVaultSession(file).settleStagedCopy();
  assert.ok(fs.readFileSync(path.join(dir, "replaced.kapevault")).equals(current), "the slot holds the vault that restore replaced");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["replaced.kapevault", "vault.kapevault"]);
});

test("a staged vault is settled in the session too: the next save moves it into the slot", async (t) => {
  const { dir, vault, spaceId, current } = await slotRestoreLeftStaged(t);
  vault.saveEntry({ kind: "note", spaceId, title: "Mock after restore", body: "b" });
  assert.ok(fs.readFileSync(path.join(dir, "replaced.kapevault")).equals(current));
  assert.deepEqual(fs.readdirSync(dir).sort(), ["replaced.kapevault", "vault.kapevault"]);
});

test("while a staged vault cannot move yet, it blocks keeping another copy even with the slot emptied", async (t) => {
  const { file, dir, vault } = await slotRestoreLeftStaged(t);
  vault.deleteReplacedCopy();
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (from === path.join(dir, "replaced-next.kapevault")) throw Object.assign(new Error("EPERM: mock file locked"), { code: "EPERM" });
    return rename(from, to);
  });
  assert.throws(() => vault.keepReplacedCopy(), (e) => e.code === "slot-taken");
  assert.throws(() => vault.stageReplacedCopy(), (e) => e.code === "slot-taken");
  assert.equal(fs.existsSync(path.join(dir, "replaced.kapevault")), false, "nothing took the slot in its place");
  assert.ok(fs.existsSync(file));
});

test("a restore whose write failed, and whose unused staged copy could not be dropped, never later reads as written", async (t) => {
  const { file, vault, spaceId } = await seeded();
  const dir = path.dirname(file);
  vault.keepReplacedCopy();
  const slotBefore = fs.readFileSync(path.join(dir, "replaced.kapevault"));
  const slot = slotBefore.toString("utf8");
  vault.saveEntry({ kind: "note", spaceId, title: "Mock current", body: "b" });
  const opened = (await vault.verifyBackup(slot, "correct horse battery orbit gazelle")).opened;
  vault.stageReplacedCopy();
  const writes = refuseWrites(t);
  const rm = fs.rmSync;
  const drops = t.mock.method(fs, "rmSync", (p, ...rest) => {
    if (p === path.join(dir, "replaced-next.kapevault")) throw Object.assign(new Error("EPERM: mock file locked"), { code: "EPERM" });
    return rm(p, ...rest);
  });
  assert.throws(() => vault.commitRestore(slot, opened, { slot: "staged" }), /mock disk refused/, "the write's own error, not the cleanup's");
  writes.mock.restore();
  const live = fs.readFileSync(file);
  // Saved now, the vault would no longer equal the copy, and the copy would take the slot as if the
  // restore had happened. So the save waits until the copy can be dropped.
  assert.throws(() => vault.saveEntry({ kind: "note", spaceId, title: "Mock later", body: "b" }), /holding a file in the KAPEVault folder/);
  assert.ok(fs.readFileSync(file).equals(live), "nothing written");
  drops.mock.restore();
  vault.saveEntry({ kind: "note", spaceId, title: "Mock later", body: "b" });
  createVaultSession(file).settleStagedCopy();
  assert.ok(fs.readFileSync(path.join(dir, "replaced.kapevault")).equals(slotBefore), "the slot keeps the vault it had");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["replaced.kapevault", "vault.kapevault"]);
});

test("a slot restore is written only while its staged copy is still the vault: a save in between stops it", async () => {
  const { file, vault, spaceId } = await seeded();
  const dir = path.dirname(file);
  vault.keepReplacedCopy();
  const slot = fs.readFileSync(path.join(dir, "replaced.kapevault"), "utf8");
  const opened = (await vault.verifyBackup(slot, "correct horse battery orbit gazelle")).opened;
  vault.stageReplacedCopy();
  vault.saveEntry({ kind: "note", spaceId, title: "Mock saved meanwhile", body: "b" });
  const live = fs.readFileSync(file);
  assert.throws(() => vault.commitRestore(slot, opened, { slot: "staged" }), /changed while it was being restored/);
  assert.ok(fs.readFileSync(file).equals(live), "the vault with the new save stays");
  assert.equal(fs.readFileSync(path.join(dir, "replaced.kapevault"), "utf8"), slot);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["replaced.kapevault", "vault.kapevault"]);
});

test("a replaced vault left staged by a failed last move goes into the slot on the next start - never lost", async (t) => {
  const { file, dir, current, result } = await slotRestoreLeftStaged(t);
  assert.equal(result.slotOk, false);
  assert.ok(fs.readFileSync(path.join(dir, "replaced-next.kapevault")).equals(current), "still on disk");
  const next = createVaultSession(file);
  next.settleStagedCopy();
  assert.ok(fs.readFileSync(path.join(dir, "replaced.kapevault")).equals(current), "the slot holds the vault that restore replaced");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["replaced.kapevault", "vault.kapevault"]);
});

test("a leftover staged vault is settled before any slot is written, so a later restore cannot overwrite it", async (t) => {
  const { dir, vault, current } = await slotRestoreLeftStaged(t);
  assert.throws(() => vault.keepReplacedCopy(), (e) => e.code === "slot-taken");
  assert.ok(fs.readFileSync(path.join(dir, "replaced.kapevault")).equals(current));
  assert.equal(fs.existsSync(path.join(dir, "replaced-next.kapevault")), false);
});

test("a staged copy the restore never used (the write failed, then the app died) is dropped: it only repeats the vault", async () => {
  const { file, vault } = await seeded();
  const dir = path.dirname(file);
  vault.keepReplacedCopy();
  const slot = fs.readFileSync(path.join(dir, "replaced.kapevault"));
  vault.stageReplacedCopy();
  createVaultSession(file).settleStagedCopy();
  assert.ok(fs.readFileSync(path.join(dir, "replaced.kapevault")).equals(slot), "the slot is untouched");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["replaced.kapevault", "vault.kapevault"]);
});

test("restoring the replaced copy with the current vault sent to R2 clears the slot: it would repeat the live vault", async () => {
  const { file, vault, spaceId } = await seeded();
  vault.keepReplacedCopy();
  const replaced = path.join(path.dirname(file), "replaced.kapevault");
  const slot = fs.readFileSync(replaced, "utf8");
  vault.saveEntry({ kind: "note", spaceId, title: "Mock current", body: "b" });
  const result = vault.commitRestore(slot, (await vault.verifyBackup(slot, "correct horse battery orbit gazelle")).opened, { slot: "clear" });
  assert.equal(result.slotOk, true);
  assert.equal(vault.replacedCopyInfo(), null);
});

test("clearing the slot after a restore deletes only the copy that was restored, never a vault that took the slot meanwhile", async () => {
  const { file, vault, spaceId } = await seeded();
  const replaced = path.join(path.dirname(file), "replaced.kapevault");
  vault.keepReplacedCopy();
  const slot = fs.readFileSync(replaced, "utf8");
  const opened = (await vault.verifyBackup(slot, "correct horse battery orbit gazelle")).opened;
  // While the vault it replaces went up to R2, a second restore put another vault in the slot.
  vault.saveEntry({ kind: "note", spaceId, title: "Mock other vault", body: "b" });
  fs.writeFileSync(replaced, fs.readFileSync(file));
  const other = fs.readFileSync(replaced);
  vault.commitRestore(slot, opened, { slot: "clear" });
  assert.ok(fs.readFileSync(replaced).equals(other), "the vault now in the slot stays");
});

test("a kept copy is deleted only with its own master password: proveCopy opens it and keeps nothing", async () => {
  const { file, vault } = await seeded();
  const other = tempVault(); // someone's own vault, restored over this one at the lock screen
  await createVaultSession(other).create("mock intruder passphrase");
  assert.deepEqual(await vault.proveCopy(file, "mock intruder passphrase"), { ok: false, error: "Wrong master password for that vault." });
  assert.deepEqual(await vault.proveCopy(file, "correct horse battery orbit gazelle"), { ok: true });
  assert.equal((await vault.proveCopy(path.join(path.dirname(file), "missing.kapevault"), "x")).ok, false);
  const planted = path.join(path.dirname(file), "planted.kapevault");
  fs.writeFileSync(planted, "not a vault");
  assert.deepEqual(await vault.proveCopy(planted, "correct horse battery orbit gazelle"), { ok: false, error: "That file is not a KAPEVault vault." });
  assert.equal(vault.publicView().entries[0].title, "GitHub", "the open vault is untouched");
});

test("the replaced copy: one slot beside the vault, the file as it was (its own password), and deletable", async () => {
  const { file, vault, spaceId } = await seeded();
  const replaced = path.join(path.dirname(file), "replaced.kapevault");
  assert.equal(vault.replacedCopyInfo(), null);
  vault.lock(); // a locked restore keeps it before replacing the vault
  const first = fs.readFileSync(file);
  assert.equal(vault.keepReplacedCopy(), undefined, "nothing to hand back: replacedCopyInfo says where and when");
  assert.ok(fs.readFileSync(replaced).equals(first), "byte for byte, still encrypted");
  assert.deepEqual(vault.replacedCopyInfo(), { path: replaced, at: fs.statSync(replaced).mtimeMs, size: first.length });

  await vault.unlock("correct horse battery orbit gazelle");
  vault.saveEntry({ kind: "note", spaceId, title: "Mock later", body: "b" });
  // A second restore never overwrites it: after a lock-screen restore of someone's own file, the slot
  // holds the real vault, and a second restore would otherwise wipe it without any password.
  assert.throws(() => vault.keepReplacedCopy(), (e) => e.code === "slot-taken");
  assert.ok(fs.readFileSync(replaced).equals(first), "the slot keeps the vault it had");
  assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), ["replaced.kapevault", "vault.kapevault"]);
  assert.equal((await createVaultSession(replaced).unlock("correct horse battery orbit gazelle")).ok, true);

  vault.deleteReplacedCopy();
  assert.equal(vault.replacedCopyInfo(), null);
  assert.equal(fs.existsSync(replaced), false);
  const empty = tempVault();
  createVaultSession(empty).keepReplacedCopy();
  assert.deepEqual(fs.readdirSync(path.dirname(empty)), [], "no vault, nothing to keep");
});

test("the replaced copy is 'not there' only when it is missing: a stat antivirus refuses is an error, so a delete never skips its password", async (t) => {
  const { file, vault } = await seeded();
  vault.keepReplacedCopy();
  const replaced = path.join(path.dirname(file), "replaced.kapevault");
  const stat = fs.statSync;
  t.mock.method(fs, "statSync", (p, ...rest) => {
    if (p === replaced) throw Object.assign(new Error("EPERM: mock file locked"), { code: "EPERM" });
    return stat(p, ...rest);
  });
  assert.throws(() => vault.replacedCopyInfo(), { message: "The replaced vault cannot be read right now. Try again in a moment." });
});
