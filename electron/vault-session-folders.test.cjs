const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createVaultSession } = require("./vault-session.cjs");
const { tempVault, seeded } = require("./fixtures/vault-session-helpers.cjs");

// Audit finding L5 (SECURITY-AUDIT-2026-09-28.md): a folder link typed by hand accepted a drive root or the home
// folder, and then every text file on it was readable through the file browser. The import already
// refused them.
test("a folder link is never a whole drive or the home folder; a folder inside is fine", async () => {
  const { vault } = await seeded();
  const spaceId = vault.publicView().spaces[0].id;
  const folder = (location, id) => vault.saveEntry({ id, kind: "link", linkType: "folder", spaceId, title: "Mock folder", location });
  for (const location of [path.parse(os.homedir()).root, os.homedir(), path.dirname(os.homedir())]) {
    assert.throws(() => folder(location), /whole drive or your home folder/, location);
  }
  const inside = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-link-"));
  const { id } = folder(inside);
  assert.ok(vault.linkedFolders().includes(inside));
  assert.doesNotThrow(() => folder(String.raw`\\nas.invalid\share`, id), "a network folder stays allowed (it lists only after a click)");
  // This PC's disk behind a network-looking prefix, and admin shares, are refused by name.
  for (const location of [String.raw`\\?\C:\Users`, String.raw`\\.\C:`, String.raw`\\?\UNC\localhost\C$`, String.raw`\\localhost\C$\Users`, String.raw`\\127.0.0.1\share`, String.raw`\\nas.invalid\D$`]) {
    assert.throws(() => folder(location, id), /normal folder path/, location);
  }
});

test("linkedFolders leaves out a whole drive, the home folder and refused network names that arrived by sync or restore", async () => {
  const vault = createVaultSession(tempVault());
  const spaceId = (await vault.create("Xq7!vR2#mLp9$wZk4")).vault.spaces[0].id;
  const ok = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-linked-"));
  const wide = [path.parse(ok).root, os.homedir(), "\\\\server\\share", "\\\\?\\C:\\Users", "//localhost/C$"];
  const base = vault.syncBase();
  const links = [ok, ...wide].map((location, i) => ({ id: `l${i}`, kind: "link", linkType: "folder", spaceId, title: `Mock ${i}`, location }));
  assert.ok(vault.commitSync({ ...base.data, entries: [...base.data.entries, ...links] }, base.revision));
  // A plain network folder stays on Windows (it lists only after a click); elsewhere \\server\share is
  // not an absolute path at all, so it is no folder there.
  const network = process.platform === "win32" ? [wide[2]] : [];
  assert.deepEqual(vault.linkedFolders(), [ok, ...network], "a plain network folder stays: it lists only after a click");
});
