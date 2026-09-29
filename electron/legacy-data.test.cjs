const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migrateLegacyData, oldCopyInfo, removeOldCopy, oldInstallPath } = require("./legacy-data.cjs");
const { createVaultSession } = require("./vault-session.cjs");

const MASTER = "correct horse battery staple 42";
const dirs = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-legacy-"));
  const legacy = path.join(root, "BOVault");
  const data = path.join(root, "KAPEVault");
  fs.mkdirSync(legacy);
  fs.mkdirSync(data);
  return { legacy, data };
};

test("a BOVault vault is copied in and opens with its master password; the old folder is untouched", async () => {
  const { legacy, data } = dirs();
  const old = createVaultSession(path.join(legacy, "vault.bovault"));
  await old.create(MASTER);
  old.lock();
  // Rewrite the header the way BOVault wrote it, to prove the old format still opens.
  const file = JSON.parse(fs.readFileSync(path.join(legacy, "vault.bovault"), "utf8"));
  fs.writeFileSync(path.join(legacy, "vault.bovault"), JSON.stringify({ ...file, format: "bovault" }));
  fs.writeFileSync(path.join(legacy, "settings.json"), JSON.stringify({ installId: "0f8f5a0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b" }));
  fs.writeFileSync(path.join(legacy, "hello.json"), "{}");
  const before = fs.readFileSync(path.join(legacy, "vault.bovault"));

  assert.equal(migrateLegacyData(data, legacy), true);
  assert.deepEqual(fs.readFileSync(path.join(data, "vault.kapevault")), before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, "settings.json"), "utf8")).installId, "0f8f5a0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b");
  assert.equal(fs.existsSync(path.join(data, "hello.json")), false, "Hello keys are named after the app, so they are not carried over");
  assert.equal(fs.existsSync(path.join(data, "vault.kapevault.tmp")), false);
  assert.deepEqual(fs.readFileSync(path.join(legacy, "vault.bovault")), before, "old vault left as it was");

  const moved = createVaultSession(path.join(data, "vault.kapevault"));
  assert.equal((await moved.unlock(MASTER)).ok, true);
});

test("an existing KAPEVault vault is never replaced, and no old vault means nothing to do", async () => {
  const { legacy, data } = dirs();
  fs.writeFileSync(path.join(legacy, "vault.bovault"), "old");
  fs.writeFileSync(path.join(data, "vault.kapevault"), "new");
  assert.equal(migrateLegacyData(data, legacy), false);
  assert.equal(fs.readFileSync(path.join(data, "vault.kapevault"), "utf8"), "new");

  const empty = dirs();
  assert.equal(migrateLegacyData(empty.data, empty.legacy), false);
  assert.equal(migrateLegacyData(empty.data, path.join(empty.legacy, "missing")), false);
  assert.deepEqual(fs.readdirSync(empty.data), ["bovault-carried-over"], "only the first-start marker");
});

test("the carry-over runs on the first start only: a vault missing later is a new vault, never the old one back", () => {
  const { legacy, data } = dirs();
  fs.writeFileSync(path.join(legacy, "vault.bovault"), "mock old vault");
  assert.equal(migrateLegacyData(data, legacy), true);
  fs.rmSync(path.join(data, "vault.kapevault")); // deleted, or never saved again after a reset
  assert.equal(migrateLegacyData(data, legacy), false);
  assert.equal(fs.existsSync(path.join(data, "vault.kapevault")), false, "an old copy that opens with an old password must not come back");

  // An install that already had its KAPEVault vault before the marker existed is marked on its next start.
  const existing = dirs();
  fs.writeFileSync(path.join(existing.legacy, "vault.bovault"), "mock old vault");
  fs.writeFileSync(path.join(existing.data, "vault.kapevault"), "mock new vault");
  assert.equal(migrateLegacyData(existing.data, existing.legacy), false);
  fs.rmSync(path.join(existing.data, "vault.kapevault"));
  assert.equal(migrateLegacyData(existing.data, existing.legacy), false);
  assert.equal(fs.existsSync(path.join(existing.data, "vault.kapevault")), false);
});

test("the old BOVault copy: shown with its date, deleted only on request with the files BOVault wrote", () => {
  const { legacy } = dirs();
  assert.equal(oldCopyInfo(legacy), null);
  for (const name of ["vault.bovault", "vault.bovault.tmp", "settings.json", "hello.json"]) fs.writeFileSync(path.join(legacy, name), "mock");
  const info = oldCopyInfo(legacy);
  assert.equal(info.path, path.join(legacy, "vault.bovault"));
  assert.equal(info.modifiedAt, fs.statSync(info.path).mtimeMs);

  fs.mkdirSync(path.join(legacy, "Local Storage")); // Electron's own browser data lives there too
  removeOldCopy(legacy);
  assert.equal(oldCopyInfo(legacy), null);
  assert.deepEqual(fs.readdirSync(legacy), ["Local Storage"], "anything else is left, and so is the folder");
  fs.rmdirSync(path.join(legacy, "Local Storage"));
  fs.writeFileSync(path.join(legacy, "vault.bovault"), "mock");
  removeOldCopy(legacy);
  assert.equal(fs.existsSync(legacy), false, "an emptied folder goes too");
});

test("the old copy is 'not there' only when it is missing: a stat antivirus refuses is an error, so a delete never skips its password", (t) => {
  const { legacy } = dirs();
  const file = path.join(legacy, "vault.bovault");
  fs.writeFileSync(file, "mock");
  const stat = fs.statSync;
  t.mock.method(fs, "statSync", (p, ...rest) => {
    if (p === file) throw Object.assign(new Error("EPERM: mock file locked"), { code: "EPERM" });
    return stat(p, ...rest);
  });
  assert.throws(() => oldCopyInfo(legacy), { message: "The old BOVault vault cannot be read right now. Try again in a moment." });
});

test("a still-installed BOVault is found where its one-click installer put it", { skip: process.platform !== "win32" && "Windows only" }, () => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-local-"));
  assert.equal(oldInstallPath(local), null);
  const exe = path.join(local, "Programs", "bovault", "BOVault.exe");
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, "mock");
  assert.equal(oldInstallPath(local), exe);
});
