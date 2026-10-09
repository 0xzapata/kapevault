const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createVaultSession } = require("./vault-session.cjs");
const { openFile, encryptWithKey } = require("./vault-crypto.cjs");
const { tempVault, seeded } = require("./fixtures/vault-session-helpers.cjs");

const MOCK_CLOUD = (bucket) => ({ endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket, accessKeyId: `mock-key-${bucket}`, secretAccessKey: "mock-secret", auto: true });

// Audit finding M2 (SECURITY-AUDIT-2026-09-28.md): a restored backup is someone else's data. It used to go in unchecked.
test("a hostile backup restores without its malformed fields: the view works and no bad photo is served", async () => {
  const { file: backupFile } = await seeded();
  const opened = await openFile("correct horse battery orbit gazelle", JSON.parse(fs.readFileSync(backupFile, "utf8")));
  const spaceId = opened.data.spaces[0].id;
  const hostile = {
    ...opened.data,
    entries: [
      ...opened.data.entries.map((e) => ({ ...e, questions: "boom", recoveryCodes: { codes: 5 } })),
      { id: "dev1", kind: "device", spaceId, title: "Mock router", photo: "file://attacker.invalid/share/x.jpg" },
    ],
  };
  const text = JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, hostile));
  const vault = createVaultSession(tempVault());
  await vault.create("Another-Mock-Master-91 orbit gazelle");
  const check = await vault.verifyBackup(text, "correct horse battery orbit gazelle");
  assert.equal(check.ok, true);
  const result = vault.commitRestore(text, check.opened);
  assert.equal(result.ok, true);
  const view = vault.publicView();
  assert.equal(view.entries.find((e) => e.title === "GitHub").questions.length, 0);
  assert.equal(view.entries.find((e) => e.id === "dev1").hasPhoto, false);
  assert.equal(vault.getSecret("dev1", "photo"), "");
});

test("a file restore proves the backup's password before replacing anything", async () => {
  const { file: backupFile } = await seeded();
  const backup = fs.readFileSync(backupFile, "utf8");
  const file = tempVault();
  const vault = createVaultSession(file);
  const { vault: view } = await vault.create("current mock lantern phrase orbit gazelle");
  vault.saveEntry({ kind: "login", spaceId: view.spaces[0].id, title: "Keep me" });
  const current = fs.readFileSync(file, "utf8");

  assert.equal((await vault.verifyBackup(backup, "wrong password")).ok, false);
  assert.equal((await vault.verifyBackup("not json", "x")).ok, false);
  const checked = await vault.verifyBackup(backup, "correct horse battery orbit gazelle");
  assert.equal(checked.ok, true);
  assert.equal(fs.readFileSync(file, "utf8"), current, "verifying never touches the vault");
  assert.equal(vault.publicView().entries[0].title, "Keep me", "the open vault is untouched too");

  const restored = vault.commitRestore(backup, checked.opened);
  assert.equal(restored.ok, true);
  assert.equal(restored.vault.entries[0].title, "GitHub");
  assert.equal((await createVaultSession(file).unlock("correct horse battery orbit gazelle")).ok, true);
});

test("an unlocked restore keeps this device's cloud backup setup; a locked one takes the backup's", async () => {
  const { file, vault, spaceId } = await seeded();
  vault.setCloud(MOCK_CLOUD("backup-bucket"));
  const backup = fs.readFileSync(file, "utf8"); // made on another device, with its own R2 setup
  vault.setCloud(MOCK_CLOUD("this-device"));
  vault.saveEntry({ kind: "note", spaceId, title: "Mock later", body: "b" });

  const result = vault.commitRestore(backup, (await vault.verifyBackup(backup, "correct horse battery orbit gazelle")).opened, { cloud: vault.cloudConfig() });
  assert.equal(result.keptCloud, true);
  assert.deepEqual(result.vault.entries.map((e) => e.title), ["GitHub"], "the vault content is the backup's");
  assert.equal(vault.cloudConfig().bucket, "this-device");
  const reopened = createVaultSession(file);
  await reopened.unlock("correct horse battery orbit gazelle");
  assert.equal(reopened.cloudConfig().bucket, "this-device", "and it is on disk, not only in memory");

  reopened.lock(); // locked: there is no setup of this device's to keep
  const locked = reopened.commitRestore(backup, (await reopened.verifyBackup(backup, "correct horse battery orbit gazelle")).opened);
  assert.equal(locked.keptCloud, false);
  assert.equal(reopened.cloudConfig().bucket, "backup-bucket");
});

test("the R2 setup a restore keeps is the one read before the upload, even if the vault locked meanwhile", async () => {
  const { file, vault } = await seeded();
  vault.setCloud(MOCK_CLOUD("backup-bucket"));
  const backup = fs.readFileSync(file, "utf8");
  vault.setCloud(MOCK_CLOUD("this-device"));
  const cloud = vault.cloudConfig(); // read before keepBeforeRestore uploads the current vault
  const opened = (await vault.verifyBackup(backup, "correct horse battery orbit gazelle")).opened;
  vault.lock(); // idle or session limit, while the upload ran
  const result = vault.commitRestore(backup, opened, { cloud });
  assert.equal(result.keptCloud, true, "said as it happened: the replaced vault went to this bucket, which stays set up");
  assert.equal(vault.cloudConfig().bucket, "this-device");
});
