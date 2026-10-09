// Helpers shared by the vault-session*.test.cjs files. Here, not beside them: the installer and the test glob skip this folder.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createVaultSession } = require("../vault-session.cjs");
const { openFile, encryptWithKey } = require("../vault-crypto.cjs");

function tempVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-test-"));
  return path.join(dir, "vault.kapevault");
}

async function seeded() {
  const file = tempVault();
  const vault = createVaultSession(file);
  const created = await vault.create("correct horse battery orbit gazelle");
  const spaceId = created.vault.spaces[0].id;
  const { id } = vault.saveEntry({ kind: "login", spaceId, title: "GitHub", username: "me", password: "s3cret-pass!", url: "https://github.com", tags: ["dev"] });
  return { file, vault, spaceId, id };
}

const localDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA");
};

// The disk refuses the next write (full, antivirus, a sync lock) - once, or until restored.
function refuseWrites(t) {
  return t.mock.method(fs, "renameSync", () => {
    throw Object.assign(new Error("EPERM: mock disk refused"), { code: "EPERM" });
  });
}

// ---- Sync-ready data (SYNC.md 3.1, 3.2): stamped in persist(), migrated and repaired in start()
const INSTALL = "0b8c8e52-1b7e-4d8e-9a53-6f0c1d2e3f40";

const MASTER = "correct horse battery orbit gazelle";

const onDisk = async (file) => (await openFile(MASTER, JSON.parse(fs.readFileSync(file, "utf8")))).data;

// The file's plaintext rewritten as an app version without sync would leave it.
async function writeAsOldBuild(file, change) {
  const opened = await openFile(MASTER, JSON.parse(fs.readFileSync(file, "utf8")));
  change(opened.data);
  fs.writeFileSync(file, JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, opened.data)));
}

async function syncing() {
  const file = tempVault();
  const vault = createVaultSession(file, { installId: () => INSTALL });
  const spaceId = (await vault.create(MASTER)).vault.spaces[0].id;
  const { id } = vault.saveEntry({ kind: "login", spaceId, title: "Mock Portal", username: "mock.user", password: "mock-Pass-1" });
  return { file, vault, spaceId, id };
}

module.exports = { tempVault, seeded, localDay, refuseWrites, INSTALL, MASTER, onDisk, writeAsOldBuild, syncing };
