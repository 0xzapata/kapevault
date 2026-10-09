// A vault a newer KAPEVault saved: this app refuses to open it and writes nothing (FORMAT.md, Newer
// files). The file is checked byte for byte after every attempt.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createVaultSession } = require("./vault-session.cjs");
const { encryptWithKey, openFile } = require("./vault-crypto.cjs");
const { createUnlockThrottle } = require("./unlock-throttle.cjs");
const { createRestores } = require("./restore.cjs");

const MASTER = "mock kettle harbor pass orbit gazelle";
const MESSAGE = "This vault was saved by a newer KAPEVault. Update this app to open it.";

// A vault file this app wrote, then rewritten the way a newer app would: edit(data, header) changes the
// decrypted JSON and the file header, and the result is sealed under the same key.
async function newerFile(edit) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-newer-")), "vault.kapevault");
  const session = createVaultSession(file);
  await session.create(MASTER);
  session.lock();
  const opened = await openFile(MASTER, JSON.parse(fs.readFileSync(file, "utf8")));
  const header = {};
  const data = structuredClone(opened.data);
  edit(data, header);
  fs.writeFileSync(file, JSON.stringify({ ...encryptWithKey(opened.key, opened.kdf, opened.salt, data), ...header }));
  return { file, key: opened.key };
}

const CASES = {
  "a file header at version 2": (_data, header) => {
    header.version = 2;
  },
  "a stronger KDF under header version 2": (_data, header) => {
    header.version = 2;
    header.kdf = { name: "scrypt", N: 2 ** 20, r: 8, p: 1, salt: "AAAAAAAAAAAAAAAAAAAAAA==" };
  },
  "a minReader of 2": (data) => {
    data.minReader = 2;
  },
  "a sync object at v 2": (data) => {
    data.sync = { ...data.sync, v: 2 };
  },
};

for (const [what, edit] of Object.entries(CASES)) {
  test(`unlock refuses ${what}: the newer message, and the file is not touched`, async () => {
    const { file } = await newerFile(edit);
    const before = fs.readFileSync(file);
    const session = createVaultSession(file);
    assert.deepEqual(await session.unlock(MASTER), { ok: false, newer: true, error: MESSAGE });
    assert.equal(session.status().unlocked, false);
    assert.ok(fs.readFileSync(file).equals(before), "byte for byte as it was");
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["vault.kapevault"], "no temp file left beside it");
  });
}

test("a key unlock (Windows Hello) of a newer vault is refused with the newer message and wipes the key", async () => {
  for (const edit of [CASES["a file header at version 2"], CASES["a minReader of 2"], CASES["a sync object at v 2"]]) {
    const { file, key } = await newerFile(edit);
    const before = fs.readFileSync(file);
    const session = createVaultSession(file);
    const copy = Buffer.from(key);
    assert.deepEqual(session.unlockWithKey(copy), { ok: false, newer: true, error: MESSAGE });
    assert.ok(copy.every((b) => b === 0), "the key does not outlive the refusal");
    assert.equal(session.status().unlocked, false);
    assert.ok(fs.readFileSync(file).equals(before));
  }
});

test("a newer vault is not a wrong-password miss: six tries leave the throttle empty", async () => {
  const { file } = await newerFile(CASES["a minReader of 2"]);
  const throttleFile = path.join(path.dirname(file), "unlock-throttle.json");
  const throttled = createUnlockThrottle({ file: throttleFile });
  const session = createVaultSession(file);
  for (let i = 0; i < 6; i++) assert.equal((await throttled(() => session.unlock(MASTER))).newer, true);
  assert.equal(fs.existsSync(throttleFile), false, "no miss was counted");
});

// Restoring from a file: the backup is checked before the vault here is touched.
for (const [what, edit] of Object.entries(CASES)) {
  test(`verifyBackup refuses ${what} with the newer message (proveCopy too for a header), writing nothing`, async () => {
    const { file: backup } = await newerFile(edit);
    const here = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-newer-")), "vault.kapevault");
    const session = createVaultSession(here);
    await session.create(MASTER);
    const vaultBefore = fs.readFileSync(here);
    const verdict = { ok: false, newer: true, error: MESSAGE };
    assert.deepEqual(await session.verifyBackup(fs.readFileSync(backup, "utf8"), MASTER), verdict);
    // proveCopy only proves the password, so a newer vault body is fine there; a newer header is not readable at all.
    if (JSON.parse(fs.readFileSync(backup, "utf8")).version > 1) assert.deepEqual(await session.proveCopy(backup, MASTER), verdict);
    assert.ok(fs.readFileSync(here).equals(vaultBefore), "the vault here is as it was");
  });
}

test("a damaged file is still damaged, not newer", async () => {
  const { file } = await newerFile(() => {});
  const session = createVaultSession(file);
  const text = JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), iv: "AAAA" });
  assert.deepEqual(await session.verifyBackup(text, MASTER), { ok: false, error: "That file is not a KAPEVault vault." });
});

test("a vault this app saved carries minReader 1", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-newer-")), "vault.kapevault");
  const session = createVaultSession(file);
  await session.create(MASTER);
  session.saveEntry({ kind: "note", spaceId: session.publicView().spaces[0].id, title: "Mock", body: "b" });
  assert.equal((await openFile(MASTER, JSON.parse(fs.readFileSync(file, "utf8")))).data.minReader, 1);
});

for (const [what, edit] of Object.entries(CASES)) {
  test(`restoring ${what} says it is newer, keeps the vault here and counts no miss`, async () => {
    const { file: backup } = await newerFile(edit);
    const here = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-newer-")), "vault.kapevault");
    const vault = createVaultSession(here);
    await vault.create(MASTER);
    const before = fs.readFileSync(here);
    const throttleFile = path.join(path.dirname(here), "unlock-throttle.json");
    const throttledUnlock = createUnlockThrottle({ file: throttleFile });
    const restores = createRestores({ vault, cloud: { saveBeforeRestore: async () => {} }, throttledUnlock, device: "PC" });
    const restored = [];
    for (let i = 0; i < 6; i++) {
      const result = await restores.restore({ load: () => fs.readFileSync(backup, "utf8"), master: MASTER }, (r) => restored.push(r));
      assert.deepEqual(result, { ok: false, newer: true, error: MESSAGE });
    }
    assert.deepEqual(restored, [], "nothing was restored");
    assert.ok(fs.readFileSync(here).equals(before), "the vault here is as it was");
    assert.deepEqual(fs.readdirSync(path.dirname(here)), ["vault.kapevault"], "no kept copy was made for it");
    assert.equal(fs.existsSync(throttleFile), false);
  });
}

test("the Windows Hello unlock IPC says the vault is newer and leaves Hello on", async () => {
  const { file, key } = await newerFile(CASES["a minReader of 2"]);
  const handlers = {};
  let turnedOff = 0;
  require("./ipc/biometric.cjs").register({
    handle: (name, fn) => (handlers[name] = fn),
    vault: createVaultSession(file),
    biometric: { masterAt: () => 0, unlock: async () => Buffer.from(key) },
    biometricName: "Windows Hello",
    biometricKeyChanged: async () => turnedOff++,
    unlocked: (result) => result,
    setPrompting: () => {},
    windows: { quick: () => null },
  });
  assert.deepEqual(await handlers["vault:unlockBiometric"](), { ok: false, code: "failed", error: MESSAGE });
  assert.equal(turnedOff, 0, "the key still fits, so Hello stays on");
});

test("picking a newer file to restore says it is newer, and holds nothing", async () => {
  const { file } = await newerFile(CASES["a file header at version 2"]);
  const handlers = {};
  const attempt = async (run) => run();
  require("./ipc/restore.cjs").register({
    handle: (name, fn) => (handlers[name] = fn),
    attempt,
    vault: { replacedCopyInfo: () => ({ path: file }), isReplacedCopy: () => false },
    cloud: {},
    throttledUnlock: (run) => run(),
  });
  assert.deepEqual(await handlers["restore:pickReplaced"](), { ok: false, error: MESSAGE });
});
