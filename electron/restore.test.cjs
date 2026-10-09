const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createVaultSession } = require("./vault-session.cjs");
const { createRestores } = require("./restore.cjs");

const MASTER = "correct horse battery orbit gazelle";

// A vault on disk (mock items only), a saved copy of it made before the last change, and restores
// wired as main.cjs wires them, minus Electron. guesses: every password tried through the throttle.
async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-restore-"));
  const file = path.join(dir, "vault.kapevault");
  const vault = createVaultSession(file);
  const spaceId = (await vault.create(MASTER)).vault.spaces[0].id;
  vault.saveEntry({ kind: "note", spaceId, title: "Mock backup note", body: "b" });
  const backup = fs.readFileSync(file, "utf8");
  vault.saveEntry({ kind: "note", spaceId, title: "Mock current note", body: "b" });
  const cloud = { saveBeforeRestore: async () => {} };
  const guesses = [];
  const locals = []; // whether each check was on this vault (local) or on another file
  const throttledUnlock = async (attempt, { local = true } = {}) => {
    const result = await attempt();
    guesses.push(result.ok);
    locals.push(local);
    return result;
  };
  const restores = createRestores({ vault, cloud, throttledUnlock, device: "PC" });
  const restored = [];
  const run = (args = {}) => restores.restore({ load: () => backup, master: MASTER, ...args }, (r) => restored.push(r));
  return { dir, file, vault, spaceId, backup, cloud, restores, run, restored, guesses, locals, slot: path.join(dir, "replaced.kapevault") };
}

const titles = (result) => result.vault.entries.map((e) => e.title);

test("a restore keeps the vault it replaces in the slot, then opens the backup", async () => {
  const { file, vault, run, restored, slot } = await setup();
  const current = fs.readFileSync(file);
  vault.lock();
  const result = await run();
  assert.equal(result.ok, true);
  assert.equal(result.keptCopy, true);
  assert.deepEqual(titles(result), ["Mock backup note"]);
  assert.ok(fs.readFileSync(slot).equals(current), "the replaced vault, byte for byte");
  assert.equal(restored.length, 1, "main hears of it once, straight after the write");
});

test("a wrong backup password changes nothing", async () => {
  const { file, run, restored, slot } = await setup();
  const current = fs.readFileSync(file);
  const result = await run({ master: "mock wrong passphrase" });
  assert.deepEqual(result, { ok: false, error: "Wrong master password for that backup." });
  assert.ok(fs.readFileSync(file).equals(current));
  assert.equal(fs.existsSync(slot), false);
  assert.equal(restored.length, 0);
});

test("unlocked with the slot taken, a restore asks first, then replaces with no copy and the slot stays", async () => {
  const { file, vault, run, slot } = await setup();
  vault.keepReplacedCopy();
  const kept = fs.readFileSync(slot);
  const asked = await run();
  assert.equal(asked.ok, false);
  assert.equal(asked.needsConfirm, true);
  assert.match(asked.error, /already kept on this PC, and it stays as it is/);
  const result = await run({ confirmed: true });
  assert.equal(result.ok, true);
  assert.equal(result.keptCopy, false);
  assert.deepEqual(titles(result), ["Mock backup note"]);
  assert.ok(fs.readFileSync(slot).equals(kept));
  assert.ok(fs.existsSync(file));
});

test("one restore at a time: a second one while the first uploads is refused, not raced", async () => {
  const { file, vault, cloud, run, restores, backup, slot } = await setup();
  vault.setCloud({ endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "mock-bucket", accessKeyId: "mock-key", secretAccessKey: "mock-secret", auto: false });
  let finishUpload;
  const uploading = new Promise((started) => {
    cloud.saveBeforeRestore = () => new Promise((resolve) => started((finishUpload = resolve)));
  });
  const first = run();
  await uploading; // the first is uploading the vault it replaces
  const current = fs.readFileSync(file);
  vault.lock(); // auto-lock while it uploads
  assert.deepEqual(await run({ confirmed: true }), { ok: false, error: "A restore is already running." }, "a file or slot restore");
  assert.deepEqual(await restores.restore({ load: async () => backup, master: MASTER }, () => {}), { ok: false, error: "A restore is already running." }, "a cloud restore");
  assert.ok(fs.readFileSync(file).equals(current), "nothing replaced meanwhile");
  assert.equal(fs.existsSync(slot), false, "and nothing kept in the slot");
  finishUpload();
  const result = await first;
  assert.equal(result.ok, true);
  assert.equal(result.keptCloud, true);
  vault.lock();
  assert.equal((await run()).ok, true, "the next one runs once the first is done");
});

test("a restore that fails still lets the next one run", async () => {
  const { run } = await setup();
  await assert.rejects(run({ load: async () => Promise.reject(new Error("mock download failed")) }), /mock download failed/);
  assert.equal((await run({ master: "mock wrong passphrase" })).ok, false);
  assert.equal((await run()).ok, true);
});

test("restoring the slot when the vault here cannot be staged: after the confirm the slot stays, as the page said", async (t) => {
  const { file, vault, spaceId, run, slot } = await setup();
  vault.keepReplacedCopy();
  vault.saveEntry({ kind: "note", spaceId, title: "Mock newer note", body: "b" });
  const kept = fs.readFileSync(slot);
  const open = fs.openSync;
  t.mock.method(fs, "openSync", (p, ...rest) => {
    if (path.basename(p).startsWith(".replaced-next.kapevault")) throw Object.assign(new Error("ENOSPC: mock disk full"), { code: "ENOSPC" });
    return open(p, ...rest);
  });
  const restoreSlot = (args) => run({ load: () => kept.toString("utf8"), fromReplaced: true, ...args });
  const asked = await restoreSlot();
  assert.equal(asked.needsConfirm, true);
  assert.match(asked.error, /could not be kept/);
  const result = await restoreSlot({ confirmed: true });
  assert.equal(result.ok, true);
  assert.equal(result.keptCopy, false);
  assert.ok(fs.existsSync(file));
  assert.ok(fs.readFileSync(slot).equals(kept), "nothing was kept, so nothing is cleared: the slot is left alone");
});

// Locked, a copy-less replace would let anyone at the keyboard wipe the vault here with a backup of
// their own: it needs the CURRENT vault's own master password too, tried through the throttle.
test("locked with the slot taken, replacing without a copy needs the current vault's own master password", async () => {
  const { file, vault, run, guesses, locals, slot } = await setup();
  vault.keepReplacedCopy();
  const kept = fs.readFileSync(slot);
  vault.lock();
  const live = fs.readFileSync(file);
  const intruder = await otherVault("mock intruder passphrase");
  const asIntruder = (args) => run({ load: () => intruder, master: "mock intruder passphrase", ...args });

  const asked = await asIntruder();
  assert.equal(asked.needsConfirm, true);
  const noPassword = await asIntruder({ confirmed: true });
  assert.equal(noPassword.ok, false, "a confirm alone replaces nothing");
  assert.ok(fs.readFileSync(file).equals(live));
  assert.equal(asked.needsMaster, true, "the page asks for the password of the vault here");
  assert.equal(noPassword.needsMaster, true);
  const tries = guesses.length;
  const wrong = await asIntruder({ confirmed: true, current: "mock wrong passphrase" });
  assert.deepEqual(wrong, { ok: false, needsConfirm: true, needsMaster: true, error: "Wrong master password for that vault." });
  assert.deepEqual(guesses.slice(tries), [true, false], "the backup's password, then the wrong guess at the vault here, both through the throttle");
  // Audit finding L1 (SECURITY-AUDIT-2026-09-28.md): the backup's own password proving right must never
  // clear the miss count, or an intruder restores their own backup between guesses at the vault here.
  assert.deepEqual(locals.slice(tries), [false, true], "the backup is another file; only the vault here is local");
  assert.ok(fs.readFileSync(file).equals(live), "the vault here is unchanged, byte for byte");
  assert.ok(fs.readFileSync(slot).equals(kept));

  const result = await asIntruder({ confirmed: true, current: MASTER });
  assert.equal(result.ok, true);
  assert.equal(result.keptCopy, false);
  assert.ok(fs.readFileSync(slot).equals(kept), "the slot still stays as it is");
});

test("unlocked, replacing without a copy keeps its one confirm: the open session is the proof", async () => {
  const { vault, run } = await setup();
  vault.keepReplacedCopy();
  const asked = await run();
  assert.equal(asked.needsMaster, undefined);
  assert.equal((await run({ confirmed: true })).ok, true);
});

// Someone else's vault, made with its own master password: the file's text.
async function otherVault(master) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-restore-other-")), "vault.kapevault");
  await createVaultSession(file).create(master);
  return fs.readFileSync(file, "utf8");
}
