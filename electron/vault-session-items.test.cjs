const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createVaultSession } = require("./vault-session.cjs");
const { openFile, encryptWithKey } = require("./vault-crypto.cjs");
const { tempVault, seeded, localDay, refuseWrites, INSTALL, MASTER, onDisk, writeAsOldBuild } = require("./fixtures/vault-session-helpers.cjs");

const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600)]).toString("base64")}`;

// Due dates (2026-09-26) and payees (2026-10-09) were removed. A vault written before then is planted
// here by rewriting the file while locked, the way an old install or backup would hold them.
async function plantRemoved(file, kind, entries) {
  const { encryptWithKey } = require("./vault-crypto.cjs");
  const opened = await openFile("correct horse battery orbit gazelle", JSON.parse(fs.readFileSync(file, "utf8")));
  opened.data.entries.push(...entries.map((e, i) => ({ id: `mock-${kind}-${i}`, spaceId: opened.data.spaces[0].id, kind, ...e })));
  const text = JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, opened.data));
  fs.writeFileSync(file, text);
  return text;
}

const kindsOnDisk = async (file) => (await openFile("correct horse battery orbit gazelle", JSON.parse(fs.readFileSync(file, "utf8")))).data.entries.map((e) => e.kind).sort();

test("editing without a password keeps the stored one", async () => {
  const { vault, spaceId, id } = await seeded();
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub 2", username: "me", url: "" });
  assert.equal(vault.getPassword(id), "s3cret-pass!");
});

test("OAuth logins keep their provider and linked account; bad values fall back", async () => {
  const { vault, spaceId, id: gmailId } = await seeded();
  const { id } = vault.saveEntry({ kind: "login", spaceId, title: "Canva", username: "me@gmail.com", url: "https://canva.com", signIn: "google", viaEntryId: gmailId });
  let canva = vault.publicView().entries.find((e) => e.id === id);
  assert.equal(canva.signIn, "google");
  assert.equal(canva.viaEntryId, gmailId);
  assert.equal(canva.hasPassword, false);

  vault.saveEntry({ id, kind: "login", spaceId, title: "Canva", signIn: "myspace", viaEntryId: "nope" });
  canva = vault.publicView().entries.find((e) => e.id === id);
  assert.equal(canva.signIn, "password");
  assert.equal(canva.viaEntryId, undefined);

  vault.saveEntry({ id, kind: "login", spaceId, title: "Canva", signIn: "google", viaEntryId: id });
  assert.equal(vault.publicView().entries.find((e) => e.id === id).viaEntryId, undefined, "cannot link to itself");
});

test("deleting the account clears logins that signed in through it", async () => {
  const { vault, spaceId, id: gmailId } = await seeded();
  const { id } = vault.saveEntry({ kind: "login", spaceId, title: "Canva", signIn: "google", viaEntryId: gmailId });
  vault.deleteEntry(gmailId);
  assert.equal(vault.publicView().entries.find((e) => e.id === id).viaEntryId, undefined);
});

// ---- Trash (core/trash.js): Delete moves to the Trash, 30 days, then it is really deleted.
test("delete moves an item to the Trash: out of the list and the health check, in the Trash list; restore brings it back", async () => {
  const { vault, spaceId, id } = await seeded();
  vault.saveEntry({ kind: "login", spaceId, title: "Copy", username: "me", password: "s3cret-pass!" });
  assert.equal(vault.publicView().entries.find((e) => e.id === id).issues.some((i) => i.type === "reused"), true);
  const view = vault.deleteEntry(id);
  assert.equal(view.entries.some((e) => e.id === id), false);
  assert.deepEqual(view.trash.map((e) => e.id), [id]);
  assert.equal(typeof view.trash[0].trashedAt, "string");
  assert.equal(view.entries[0].issues.some((i) => i.type === "reused"), false, "a trashed login is no reuse");
  assert.equal(vault.getPassword(id), "", "a trashed login gives up no password");
  assert.throws(() => vault.getSecret(id, "password"), /in the Trash/);
  assert.throws(() => vault.saveEntry({ id, kind: "login", spaceId, title: "Edited" }), /in the Trash/);
  const back = vault.restoreEntry(id);
  assert.deepEqual(back.trash, []);
  assert.equal(back.entries.some((e) => e.id === id), true);
  assert.equal(vault.getPassword(id), "s3cret-pass!", "nothing was wiped");
});

test("a trashed item survives a lock and unlock, and a trashed link feeds no file browser", async () => {
  const { file, vault, spaceId } = await seeded();
  const { id } = vault.saveEntry({ kind: "link", spaceId, title: "Mock folder", linkType: "folder", location: path.dirname(file) });
  assert.deepEqual(vault.linkedFolders(), [path.dirname(file)]);
  vault.deleteEntry(id);
  assert.deepEqual(vault.linkedFolders(), []);
  vault.lock();
  const reopened = createVaultSession(file);
  const opened = await reopened.unlock("correct horse battery orbit gazelle");
  assert.deepEqual(opened.vault.trash.map((e) => e.id), [id]);
  assert.deepEqual(reopened.linkedFolders(), []);
});

test("delete now and empty Trash delete for good; only a trashed item can be deleted now", async () => {
  const { vault, spaceId, id } = await seeded();
  assert.throws(() => vault.deleteForever(id), /not in the Trash/);
  vault.deleteEntry(id);
  assert.deepEqual(vault.deleteForever(id).trash, []);
  assert.throws(() => vault.getPassword(id) || vault.getSecret(id, "password"), /Item not found/);
  const a = vault.saveEntry({ kind: "note", spaceId, title: "Mock a", body: "x" }).id;
  const b = vault.saveEntry({ kind: "note", spaceId, title: "Mock b", body: "x" }).id;
  vault.deleteEntry(a);
  vault.deleteEntry(b);
  const view = vault.emptyTrash();
  assert.deepEqual([view.trash, view.entries], [[], []]);
});

test("an item 30 days in the Trash is deleted at the next unlock and at the next save, and sync sees a delete", async () => {
  const { file, vault, spaceId, id } = await seeded();
  const keep = vault.saveEntry({ kind: "note", spaceId, title: "Mock keep", body: "x" }).id;
  vault.deleteEntry(id);
  vault.deleteEntry(keep);
  vault.lock();
  const ago = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  await writeAsOldBuild(file, (data) => {
    data.entries.find((e) => e.id === id).trashedAt = ago(31);
    data.entries.find((e) => e.id === keep).trashedAt = ago(29);
  });
  const session = createVaultSession(file, { installId: () => INSTALL });
  const view = (await session.unlock(MASTER)).vault;
  assert.deepEqual(view.trash.map((e) => e.id), [keep], "purged on unlock");
  const disk = await onDisk(file);
  assert.deepEqual(disk.entries.map((e) => e.id), [keep], "and the purge was written");
  assert.ok(disk.sync.gone[id], "the delete is a tombstone, so sync carries it");

  session.lock();
  await writeAsOldBuild(file, (data) => {
    data.entries.find((e) => e.id === keep).trashedAt = ago(40);
  });
  const later = createVaultSession(file, { installId: () => INSTALL });
  const opened = await later.unlock(MASTER);
  assert.deepEqual(opened.vault.trash, []);
  assert.ok((await onDisk(file)).sync.gone[keep]);
});

test("a purge the disk refuses is retried by the next save", async (t) => {
  const { file, vault, spaceId, id } = await seeded();
  vault.deleteEntry(id);
  vault.lock();
  await writeAsOldBuild(file, (data) => {
    data.entries.find((e) => e.id === id).trashedAt = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  });
  const session = createVaultSession(file, { installId: () => INSTALL });
  const refused = refuseWrites(t);
  const opened = await session.unlock(MASTER);
  assert.equal(opened.ok, true, "a refused purge never fails the unlock");
  refused.mock.restore();
  session.saveEntry({ kind: "note", spaceId, title: "Mock next", body: "x" });
  assert.deepEqual((await onDisk(file)).entries.map((e) => e.title), ["Mock next"]);
});

test("a changed password goes to history, newest first, capped at 10", async () => {
  const { vault, spaceId, id } = await seeded();
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", password: "second-pass" });
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", password: "second-pass" }); // unchanged: no new row
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", password: "third-pass" });
  const entry = vault.publicView().entries.find((e) => e.id === id);
  assert.equal(entry.history.length, 2);
  // A UTC timestamp, as sync writes a lost password: a local date sorted a day ahead of it before 08:00 PHT.
  assert.match(entry.history[0].changedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(JSON.stringify(vault.publicView()).includes("s3cret-pass!"), false, "history never reaches the page");
  assert.equal(vault.getSecret(id, "history", 0), "second-pass");
  assert.equal(vault.getSecret(id, "history", 1), "s3cret-pass!");
  for (let i = 0; i < 15; i++) vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", password: `p-${i}` });
  assert.equal(vault.publicView().entries.find((e) => e.id === id).history.length, 10);
  vault.clearHistory(id);
  assert.deepEqual(vault.publicView().entries.find((e) => e.id === id).history, []);
});

test("clients can be renamed, and deleted by moving or removing their items", async () => {
  const { vault, spaceId: personal, id } = await seeded();
  const { id: acme } = vault.addSpace("Acme");
  const { id: beta } = vault.addSpace("Beta");
  vault.moveEntry(id, acme);
  assert.equal(vault.publicView().entries.find((e) => e.id === id).spaceId, acme);
  vault.renameSpace(acme, "  Acme Corp ");
  assert.equal(vault.publicView().spaces.find((s) => s.id === acme).name, "Acme Corp");
  vault.deleteSpace(acme, beta);
  assert.equal(vault.publicView().entries.find((e) => e.id === id).spaceId, beta);
  vault.deleteSpace(beta, null);
  assert.equal(vault.publicView().entries.length, 0);
  assert.throws(() => vault.deleteSpace(personal, null), /cannot be deleted/);
  assert.throws(() => vault.renameSpace(personal, "  "), /required/);
});

test("a space's photo is saved, shown in the page's view, and removed", async () => {
  const { vault, spaceId: personal } = await seeded();
  const photo = `data:image/jpeg;base64,${btoa("\xff\xd8\xff mock photo")}`;
  vault.setSpacePhoto(personal, photo);
  assert.equal(vault.publicView().spaces.find((s) => s.id === personal).photo, photo);
  assert.throws(() => vault.setSpacePhoto(personal, "data:image/png;base64,AAAA"), /could not be saved/);
  vault.setSpacePhoto(personal, "");
  assert.equal(Object.hasOwn(vault.publicView().spaces.find((s) => s.id === personal), "photo"), false);
});

test("touch records use without uploading a backup", async () => {
  let uploads = 0;
  const file = tempVault();
  const vault = createVaultSession(file, { onPersist: () => uploads++ });
  const { vault: view } = await vault.create("correct horse battery orbit gazelle");
  const { id } = vault.saveEntry({ kind: "login", spaceId: view.spaces[0].id, title: "A" });
  const before = uploads;
  vault.touch(id);
  assert.equal(uploads, before);
  assert.ok(vault.publicView().entries[0].lastUsedAt > 0);
  vault.saveEntry({ id, kind: "login", spaceId: view.spaces[0].id, title: "A2" });
  assert.ok(vault.publicView().entries[0].lastUsedAt > 0, "an edit keeps lastUsedAt");
});

test("an old pre-v2 login keeps its password age through edits and moves", async () => {
  const { file, vault, spaceId, id } = await seeded();
  // Simulate a login saved before v2: no passwordChangedAt, last edited two years ago.
  const key = vault.keyCopy();
  const { openFileWithKey, encryptWithKey } = require("./vault-crypto.cjs");
  const disk = JSON.parse(fs.readFileSync(file, "utf8"));
  const opened = openFileWithKey(Buffer.from(key), disk);
  opened.data.entries[0] = { ...opened.data.entries[0], updatedAt: "2024-01-01", passwordChangedAt: undefined };
  fs.writeFileSync(file, JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, opened.data)));
  const legacy = createVaultSession(file);
  await legacy.unlock("correct horse battery orbit gazelle");
  const isOld = () => legacy.publicView().entries.find((e) => e.id === id).issues.some((i) => i.type === "old");
  assert.ok(isOld());
  legacy.saveEntry({ id, kind: "login", spaceId, title: "GitHub renamed" });
  assert.ok(isOld(), "a title edit does not reset the password age");
  const { id: other } = legacy.addSpace("Acme");
  legacy.moveEntry(id, other);
  assert.ok(isOld(), "a move does not reset it either");
  legacy.saveEntry({ id, kind: "login", spaceId: other, title: "GitHub renamed", password: "brand-new-Pass-77" });
  assert.equal(isOld(), false, "a new password does");
});

test("import accepts notes, keys and 2FA; a bad 2FA key stops the whole import", async () => {
  const { vault } = await seeded();
  const result = vault.importEntries([
    { kind: "note", title: "Codes", body: "abc" },
    { kind: "key", space: "Acme", title: "R2", keyId: "id1", secret: "s1" },
    { kind: "login", title: "With 2FA", totp: "JBSWY3DPEHPK3PXP" },
  ]);
  assert.equal(result.added, 3);
  assert.throws(() => vault.importEntries([{ kind: "login", title: "Bad", totp: "!!" }]), /Item 1/);
});

test("held for: any kind keeps a person's name, trimmed; blank clears it; import takes it", async () => {
  const { vault, spaceId, id } = await seeded();
  const entry = (eid) => vault.publicView().entries.find((e) => e.id === eid);
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", heldFor: "  Mock Lola " });
  assert.equal(entry(id).heldFor, "Mock Lola");
  assert.equal(vault.getPassword(id), "s3cret-pass!", "editing the name keeps the password");
  const note = vault.saveEntry({ kind: "note", spaceId, title: "Mock gate", body: "4321", heldFor: "Mock Lola" }).id;
  const thing = vault.saveEntry({ kind: "thing", spaceId, title: "P", spot: "blue folder", heldFor: "Mock Lola" }).id;
  assert.equal(entry(note).heldFor, "Mock Lola");
  assert.equal(entry(thing).heldFor, "Mock Lola");
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", heldFor: " " });
  assert.equal(entry(id).heldFor, undefined);
  assert.equal(vault.importEntries([{ kind: "link", title: "Mock photos", location: "https://photos.example.com", heldFor: "Mock Papa" }]).added, 1);
  assert.ok(vault.publicView().entries.some((e) => e.heldFor === "Mock Papa"));
  assert.throws(() => vault.importEntries([{ kind: "note", title: "X", heldFor: 3 }]), /heldFor must be text/);
});

test("things: a spot is required, grab is 1 to 3 (2 when missing), no logo; import and hand back", async () => {
  const { vault, spaceId } = await seeded();
  const input = { kind: "thing", spaceId, title: "Mock Passport", room: " Bedroom ", spot: " blue folder, top shelf ", grab: 1, brand: "github" };
  const { id } = vault.saveEntry(input);
  const entry = () => vault.publicView().entries.find((e) => e.id === id);
  const { room, spot, grab, brand } = entry();
  assert.deepEqual({ room, spot, grab, brand }, { room: "Bedroom", spot: "blue folder, top shelf", grab: 1, brand: undefined });
  assert.throws(() => vault.saveEntry({ ...input, id, spot: "  " }), /where it is kept/);
  for (const bad of [0, 4, "1", 1.5, null]) assert.throws(() => vault.saveEntry({ ...input, id, grab: bad }), /Grab must be 1, 2 or 3/, String(bad));
  assert.equal(entry().grab, 1, "a refused save changes nothing");
  vault.saveEntry({ ...input, id, room: "", grab: undefined });
  assert.equal(entry().room, "");
  assert.equal(entry().grab, 2);

  const imported = vault.importEntries([{ kind: "thing", title: "Mock Land title", room: "Attic", spot: "tin box", grab: 3, heldFor: "Mock Lola" }, { kind: "thing", title: "Mock YubiKey", spot: "key ring" }]);
  assert.equal(imported.added, 2);
  assert.equal(vault.publicView().entries.find((e) => e.title === "Mock YubiKey").grab, 2);
  assert.throws(() => vault.importEntries([{ kind: "thing", title: "Bad", spot: "x", grab: "1" }]), /grab must be 1, 2 or 3/);
  assert.throws(() => vault.importEntries([{ kind: "thing", title: "Bad", spot: 7 }]), /spot must be text/);
  assert.throws(() => vault.importEntries([{ kind: "note", title: "Fine" }, { kind: "thing", title: "No spot" }]), /Item 2: a thing needs its spot/);

  const rows = vault.handBack("Mock Lola", false).items[0].rows.map((r) => `${r.label}: ${r.value}`);
  assert.deepEqual(rows, ["Room: Attic", "Where: tin box", "In a hurry: Leave it"]);
});

test("backup codes stay in main: the page gets counts, the grid is one fetch, one code copies", async () => {
  const { vault, spaceId, id } = await seeded();
  const codes = ["1234 5678", "2345 6789", "3456 7890", "4567 8901", "5678 9012"];
  const view = vault.setRecoveryCodes(id, codes.map((c) => ` ${c} `));
  const text = JSON.stringify(view);
  for (const c of codes) assert.ok(!text.includes(c), `${c} leaked to the page`);
  const today = new Date().toLocaleDateString("en-CA");
  const entry = () => vault.publicView().entries.find((e) => e.id === id);
  assert.deepEqual(entry().recoveryCodes, { total: 5, left: 5, setAt: today, paper: [] });
  assert.deepEqual(vault.getRecoveryCodes(id), codes.map((code) => ({ code, used: false })), "trimmed, each keeps its own spacing");
  assert.equal(vault.getSecret(id, "code", 2), "3456 7890");
  assert.equal(vault.getSecret(id, "code", 9), "");

  vault.markRecoveryCode(id, 1, true);
  vault.markRecoveryCode(id, 3, true);
  assert.equal(entry().recoveryCodes.left, 3);
  vault.markRecoveryCode(id, 3, false);
  assert.equal(entry().recoveryCodes.left, 4);
  assert.throws(() => vault.markRecoveryCode(id, 7, true), /No such backup code/);

  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub renamed", username: "me" });
  assert.equal(entry().recoveryCodes.left, 4, "editing the login keeps its codes");
  const keyId = vault.saveEntry({ kind: "key", spaceId, title: "K" }).id;
  assert.throws(() => vault.setRecoveryCodes(keyId, codes), /belong to a login/);
  assert.equal(entry().issues.some((i) => i.type === "codes"), false);
  for (const i of [0, 2, 4]) vault.markRecoveryCode(id, i, true);
  assert.deepEqual(entry().issues.find((i) => i.type === "codes"), { type: "codes", left: 1 });
});

test("backup codes: 4 to 20 codes, one line each; bad input changes nothing", async () => {
  const { vault, id } = await seeded();
  const many = (n) => Array.from({ length: n }, (_, i) => `mock-code-${i}`);
  for (const bad of [many(3), many(21), "1234 5678", [...many(4), ""], [...many(4), "a\nb"], [...many(4), "x".repeat(65)], [...many(4), 12345678]]) {
    assert.throws(() => vault.setRecoveryCodes(id, bad), /Backup codes/);
  }
  assert.equal(vault.publicView().entries.find((e) => e.id === id).recoveryCodes, undefined);
  vault.setRecoveryCodes(id, many(20));
  assert.equal(vault.publicView().entries.find((e) => e.id === id).recoveryCodes.total, 20);
});

test("paper copies: recorded with a date; new codes mark every earlier copy out of date", async () => {
  const { vault, id } = await seeded();
  const today = new Date().toLocaleDateString("en-CA");
  const codes = ["aaaa-1111", "bbbb-2222", "cccc-3333", "dddd-4444"];
  assert.throws(() => vault.addPaperCopy(id, "Desk drawer", ""), /Add the backup codes first/);
  vault.setRecoveryCodes(id, codes);
  assert.throws(() => vault.addPaperCopy(id, "  ", ""), /where/);
  assert.throws(() => vault.addPaperCopy(id, "Desk drawer", "last week"), /date/);
  vault.addPaperCopy(id, " Desk drawer ", "2026-09-01");
  vault.addPaperCopy(id, "Mock safe", "");
  const paper = () => vault.publicView().entries.find((e) => e.id === id).recoveryCodes.paper;
  assert.deepEqual(paper(), [{ where: "Desk drawer", printedAt: "2026-09-01", outdatedAt: undefined }, { where: "Mock safe", printedAt: today, outdatedAt: undefined }]);

  vault.setRecoveryCodes(id, ["eeee-5555", "ffff-6666", "gggg-7777", "hhhh-8888"]);
  assert.deepEqual(paper().map((p) => p.outdatedAt), [today, today], "the printed codes stopped working");
  assert.deepEqual(vault.getRecoveryCodes(id).map((c) => c.code), ["eeee-5555", "ffff-6666", "gggg-7777", "hhhh-8888"]);
  vault.addPaperCopy(id, "Wallet", "");
  assert.equal(paper()[2].outdatedAt, undefined, "a copy of the new set is current");
  vault.removePaperCopy(id, 0);
  assert.deepEqual(paper().map((p) => p.where), ["Mock safe", "Wallet"]);
  assert.throws(() => vault.removePaperCopy(id, 5), /No such paper copy/);
});

test("paper copies need a real calendar day; a set saved without paper still shows", async () => {
  const { vault, id } = await seeded();
  vault.setRecoveryCodes(id, ["aaaa-1111", "bbbb-2222", "cccc-3333", "dddd-4444"]);
  for (const bad of ["2026-99-99", "2026-02-30", "2026-13-01"]) assert.throws(() => vault.addPaperCopy(id, "Mock safe", bad), /date/, bad);
  vault.addPaperCopy(id, "Mock safe", "2028-02-29");
  assert.equal(vault.publicView().entries.find((e) => e.id === id).recoveryCodes.paper[0].printedAt, "2028-02-29");
});

test("security questions: an answer the form never loaded follows its own question, not its row", async () => {
  const { vault, spaceId, id } = await seeded();
  const ask = (questions) => vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", questions });
  ask([{ question: "Q one", answer: "mock answer one" }, { question: "Q two", answer: "mock answer two" }]);
  // The form dropped row 0 and kept row 1 unloaded (from: 1), then added a new row.
  ask([{ question: "Q two", from: 1 }, { question: "Q three", answer: "mock answer three" }]);
  assert.deepEqual([0, 1].map((i) => vault.getSecret(id, "answer", i)), ["mock answer two", "mock answer three"]);
  ask([{ question: "Q two, reworded", from: 0 }, { question: "", answer: "" }]);
  assert.equal(vault.getSecret(id, "answer", 0), "mock answer two", "a renamed question keeps its answer; an empty row is dropped");
  assert.equal(vault.publicView().entries.find((e) => e.id === id).questions.length, 1);
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub renamed", username: "me" });
  assert.equal(vault.getSecret(id, "answer", 0), "mock answer two", "a save without questions (import, older caller) keeps them");
  ask([]);
  assert.deepEqual(vault.publicView().entries.find((e) => e.id === id).questions, [], "an empty list removes them");
});

test("security questions: an answer needs its question; too many or too long is refused", async () => {
  const { vault, spaceId, id } = await seeded();
  const ask = (questions) => vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", questions });
  assert.throws(() => ask([{ question: " ", answer: "orphan" }]), /needs its question/);
  assert.throws(() => ask(Array.from({ length: 11 }, (_, i) => ({ question: `Q${i}`, answer: "a" }))), /up to 10/);
  assert.throws(() => ask([{ question: "Q", answer: "x".repeat(201) }]), /too long/);
  assert.throws(() => ask("Q"), /expected a list/);
  assert.throws(() => ask([null]), /each needs a question/);
  assert.throws(() => ask([{ question: "Q", answer: 12 }]), /must be text/);
  ask([...Array.from({ length: 10 }, (_, i) => ({ question: `Q${i}`, answer: "a" })), { question: "", answer: "" }]);
  assert.equal(vault.publicView().entries.find((e) => e.id === id).questions.length, 10, "a blank row does not count toward the limit");
  ask([]);
  assert.deepEqual(vault.publicView().entries.find((e) => e.id === id).questions, [], "nothing saved");
});

test("closing an account: dormant, deletion requested with a 30-day follow-up, back in use", async () => {
  const { vault, spaceId, id } = await seeded();
  const lifecycle = () => vault.publicView().entries.find((e) => e.id === id).lifecycle;
  assert.equal(lifecycle(), undefined, "in use");
  vault.setLifecycle(id, "dormant");
  assert.deepEqual(lifecycle(), { state: "dormant", requestedAt: undefined, followUpAt: undefined, goneAt: undefined });
  vault.setLifecycle(id, "deletion-requested");
  assert.deepEqual(lifecycle(), { state: "deletion-requested", requestedAt: localDay(0), followUpAt: localDay(30), goneAt: undefined });
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub renamed", username: "me" });
  assert.equal(lifecycle().state, "deletion-requested", "an edit carries the state over");
  vault.setLifecycle(id, null);
  assert.equal(lifecycle(), undefined, "back in use");
  for (const bad of ["gone", "active", undefined, 1]) assert.throws(() => vault.setLifecycle(id, bad), /Unknown account state/, String(bad));
  const noteId = vault.saveEntry({ kind: "note", spaceId, title: "N", body: "b" }).id;
  assert.throws(() => vault.setLifecycle(noteId, "dormant"), /Only a login/);
});

test("confirm gone wipes every secret and keeps a tombstone; notes only when asked", async () => {
  const { file, vault, spaceId, id } = await seeded();
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", username: "me", url: "https://github.com", password: "newer-pass-1!", totp: "JBSWY3DPEHPK3PXP", notes: "closed it", heldFor: "Mock Lola", favorite: true, questions: [{ question: "Q", answer: "mock answer" }] });
  vault.setRecoveryCodes(id, ["aaaa-1111", "bbbb-2222", "cccc-3333", "dddd-4444"]);
  const oauth = vault.saveEntry({ kind: "login", spaceId, title: "Canva", signIn: "github", viaEntryId: id }).id;
  vault.setLifecycle(id, "deletion-requested");
  vault.confirmGone(id, false);

  const opened = await openFile("correct horse battery orbit gazelle", JSON.parse(fs.readFileSync(file, "utf8")));
  const stored = opened.data.entries.find((e) => e.id === id);
  assert.deepEqual(stored, {
    id, spaceId, kind: "login", title: "GitHub", url: "https://github.com", username: "me", notes: "closed it", updatedAt: localDay(0),
    lifecycle: { state: "gone", requestedAt: localDay(0), goneAt: localDay(0) },
  }, "only the tombstone is left on disk");
  for (const secret of ["s3cret-pass!", "newer-pass-1!", "JBSWY3DPEHPK3PXP", "aaaa-1111", "mock answer"]) {
    assert.ok(!JSON.stringify(opened.data).includes(secret), `${secret} survived`);
  }
  for (const [field, index] of [["password"], ["history", 0], ["code", 0], ["answer", 0]]) assert.equal(vault.getSecret(id, field, index), "", field);
  assert.equal(vault.publicView().entries.find((e) => e.id === oauth).viaEntryId, undefined, "a login signing in through it loses the link");

  const other = vault.saveEntry({ kind: "login", spaceId, title: "Old forum", password: "p", notes: "why" }).id;
  vault.confirmGone(other, true);
  assert.equal(vault.publicView().entries.find((e) => e.id === other).notes, "", "notes cleared when ticked");
});

test("a tombstone is read only and raises no health issue", async () => {
  const { vault, spaceId, id } = await seeded();
  vault.saveEntry({ kind: "login", spaceId, title: "Twin", password: "s3cret-pass!" });
  vault.confirmGone(id, false);
  assert.throws(() => vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub" }), /read only/);
  assert.throws(() => vault.toggleFavorite(id), /read only/);
  const client = vault.addSpace("Mock Client").id;
  assert.throws(() => vault.moveEntry(id, client), /read only/);
  const before = JSON.stringify(vault.publicView().entries.find((e) => e.id === id));
  vault.touch(id);
  assert.equal(JSON.stringify(vault.publicView().entries.find((e) => e.id === id)), before, "a copy from a tombstone is not a use");
  const oauth = vault.saveEntry({ kind: "login", spaceId, title: "Canva", signIn: "github", viaEntryId: id }).id;
  assert.equal(vault.publicView().entries.find((e) => e.id === oauth).viaEntryId, undefined, "nothing signs in through a closed account");
  assert.equal(vault.importEntries([{ kind: "login", title: "GitHub" }]).added, 1, "signing up there again imports");
  assert.throws(() => vault.setLifecycle(id, "dormant"), /closed/);
  assert.throws(() => vault.confirmGone(id, false), /closed/);
  assert.throws(() => vault.setRecoveryCodes(id, ["aaaa-1111", "bbbb-2222", "cccc-3333", "dddd-4444"]), /closed/);
  assert.deepEqual(vault.publicView().entries.find((e) => e.id === id).issues, []);
  vault.deleteEntry(id);
  assert.equal(vault.publicView().entries.some((e) => e.id === id), false, "deletable for good");
});

test("devices: both passwords and the photo stay in main, one at a time; the page gets has-flags", async () => {
  const { vault, spaceId } = await seeded();
  const input = { kind: "device", spaceId, title: "Mock Router", type: "router", model: " Archer C6 ", adminUrl: "192.168.0.1", adminUser: "admin", adminPassword: "mock-admin-77", ssid: "Mock_Home", wifiPassword: "mockwifi-4821", mac: "50-c7-bf-12-34-56", photo: JPEG };
  const { id } = vault.saveEntry(input);
  const view = vault.publicView();
  const entry = view.entries.find((e) => e.id === id);
  for (const secret of ["mock-admin-77", "mockwifi-4821", JPEG.slice(30, 60)]) assert.ok(!JSON.stringify(view).includes(secret), secret);
  assert.deepEqual(
    { type: entry.type, model: entry.model, mac: entry.mac, adminUrl: entry.adminUrl, ssid: entry.ssid, hasAdminPassword: entry.hasAdminPassword, hasWifiPassword: entry.hasWifiPassword, hasPhoto: entry.hasPhoto },
    { type: "router", model: "Archer C6", mac: "50:C7:BF:12:34:56", adminUrl: "192.168.0.1", ssid: "Mock_Home", hasAdminPassword: true, hasWifiPassword: true, hasPhoto: true },
  );
  assert.equal(vault.getSecret(id, "adminPassword"), "mock-admin-77");
  assert.equal(vault.getSecret(id, "wifiPassword"), "mockwifi-4821");
  assert.equal(vault.getSecret(id, "photo"), JPEG);
  assert.equal(vault.getSecret(id, "password"), "", "a device has no login password");
  assert.deepEqual(vault.openTarget(id), { kind: "url", target: "http://192.168.0.1" }, "a router's bare address opens over http");
});

test("devices: an edit that leaves secrets and photo undefined keeps them; empty removes them", async () => {
  const { vault, spaceId } = await seeded();
  const { id } = vault.saveEntry({ kind: "device", spaceId, title: "Mock Router", type: "router", adminPassword: "mock-admin-77", wifiPassword: "mockwifi-4821", photo: JPEG });
  vault.saveEntry({ id, kind: "device", spaceId, title: "Mock Router 2", type: "router", ssid: "Mock_Home" });
  assert.equal(vault.getSecret(id, "wifiPassword"), "mockwifi-4821");
  assert.equal(vault.getSecret(id, "adminPassword"), "mock-admin-77");
  assert.equal(vault.getSecret(id, "photo"), JPEG);
  vault.saveEntry({ id, kind: "device", spaceId, title: "Mock Router 2", type: "router", wifiPassword: "", photo: "" });
  const entry = vault.publicView().entries.find((e) => e.id === id);
  assert.deepEqual([entry.hasWifiPassword, entry.hasPhoto, entry.hasAdminPassword], [false, false, true]);
});

test("devices: type, IMEI, MAC and photo are checked; a refused save changes nothing", async () => {
  const { vault, spaceId } = await seeded();
  const input = { kind: "device", spaceId, title: "Mock Phone", type: "phone", imei: "35-678910-123456-3" };
  const { id } = vault.saveEntry(input);
  assert.equal(vault.publicView().entries.find((e) => e.id === id).imei, "356789101234563");
  assert.equal(vault.saveEntry({ kind: "device", spaceId, title: "No type" }).id && vault.publicView().entries.find((e) => e.title === "No type").type, "other");
  assert.throws(() => vault.saveEntry({ ...input, id, type: "toaster" }), /Unknown device type/);
  assert.throws(() => vault.saveEntry({ ...input, id, imei: "356789101234564" }), /IMEI has a mistyped digit/);
  assert.throws(() => vault.saveEntry({ ...input, id, imei: "12345" }), /IMEI must be 15 digits/);
  assert.throws(() => vault.saveEntry({ ...input, id, mac: "50-C7-BF" }), /MAC address/);
  assert.throws(() => vault.saveEntry({ ...input, id, photo: "data:image/png;base64,iVBORw0KGgo=" }), /Photo could not be saved/);
  assert.equal(vault.publicView().entries.find((e) => e.id === id).imei, "356789101234563");
});

test("label photos have one shared cap; a device keeps its photo through an edit", async () => {
  const { MAX_PHOTOS_BYTES, MAX_PHOTO_BYTES } = require("../core/index.js");
  const { vault, spaceId } = await seeded();
  const photo = (n) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, n]), Buffer.alloc(MAX_PHOTO_BYTES - 4)]).toString("base64")}`;
  const fits = Math.floor(MAX_PHOTOS_BYTES / photo(0).length);
  const devices = (count) => Array.from({ length: count }, (_, i) => ({ kind: "device", title: `Mock Router ${i}`, photo: photo(i % 256) }));
  assert.throws(() => vault.importEntries(devices(fits + 1)), /no room for more photos/);
  assert.equal(vault.publicView().entries.length, 1, "a refused import adds nothing");
  assert.equal(vault.importEntries(devices(fits)).added, fits);
  assert.throws(() => vault.saveEntry({ kind: "device", spaceId, title: "Mock one more", photo: photo(1) }), /Remove a photo from another item first/);
  const kept = vault.publicView().entries.find((e) => e.title === "Mock Router 0");
  vault.saveEntry({ id: kept.id, kind: "device", spaceId: kept.spaceId, title: "Mock Router 0 renamed" });
  assert.equal(vault.getSecret(kept.id, "photo"), photo(0));
});

test("devices: import takes the sticker fields; hand back marks both passwords secret", async () => {
  const { vault } = await seeded();
  const imported = vault.importEntries([{ kind: "device", title: "Mock CCTV", type: "cctv", serial: "DS-MOCK1", adminUser: "admin", adminPassword: "mock-nvr-9", ssid: "", heldFor: "Mock Lola" }]);
  assert.equal(imported.added, 1);
  assert.throws(() => vault.importEntries([{ kind: "device", title: "Bad", type: "fridge" }]), /type must be "router"/);
  assert.throws(() => vault.importEntries([{ kind: "device", title: "Bad", wifiPassword: 1234 }]), /wifiPassword must be text/);
  assert.throws(() => vault.importEntries([{ kind: "note", title: "Fine" }, { kind: "device", title: "Bad", imei: "12345" }]), /Item 2: IMEI must be 15 digits/);
  const rows = (secrets) => vault.handBack("Mock Lola", secrets).items[0].rows;
  assert.deepEqual(rows(false).map((r) => `${r.label}: ${r.value}`), ["Type: CCTV / NVR", "Serial number: DS-MOCK1", "Admin username: admin"]);
  assert.deepEqual(rows(true).find((r) => r.label === "Admin password"), { label: "Admin password", value: "mock-nvr-9", secret: true });
});

test("IDs: the number and photo stay in main; hand back prints the number only when ticked", async () => {
  const { vault, spaceId } = await seeded();
  const { id } = vault.saveEntry({ kind: "id", spaceId, title: "Mock SSS", idType: "SSS", idNumber: "34-1234567-8", photo: JPEG, heldFor: "Mock Lola" });
  const view = JSON.stringify(vault.publicView());
  assert.ok(!view.includes("34-1234567-8") && !view.includes(JPEG.slice(30, 60)));
  assert.equal(vault.getSecret(id, "idNumber"), "34-1234567-8");
  assert.equal(vault.getSecret(id, "photo"), JPEG);
  assert.throws(() => vault.openTarget(id), /no link/);
  const rows = (secrets) => vault.handBack("Mock Lola", secrets).items[0].rows;
  assert.deepEqual(rows(false).map((r) => `${r.label}: ${r.value}`), ["ID: SSS"]);
  assert.deepEqual(rows(true).find((r) => r.label === "ID number"), { label: "ID number", value: "34-1234567-8", secret: true });
});

test("things: an ID's expiry is optional, checked like a key's, and reaches the page, issues and hand back", async () => {
  const { vault, spaceId } = await seeded();
  const input = { kind: "thing", spaceId, title: "Mock Passport", spot: "blue folder", heldFor: "Mock Lola", expires: " 2031-04-30 " };
  const { id } = vault.saveEntry(input);
  const entry = () => vault.publicView().entries.find((e) => e.id === id);
  assert.equal(entry().expires, "2031-04-30");
  assert.throws(() => vault.saveEntry({ ...input, id, expires: "next year" }), /Expiry must be a date/);
  assert.equal(entry().expires, "2031-04-30", "a refused save changes nothing");
  const rows = vault.handBack("Mock Lola", false).items[0].rows.map((r) => `${r.label}: ${r.value}`);
  assert.deepEqual(rows, ["Where: blue folder", "In a hurry: If there is time", "Expires: 2031-04-30"]);
  vault.saveEntry({ ...input, id, expires: "" });
  assert.equal(entry().expires, undefined);

  vault.saveEntry({ ...input, id, expires: localDay(5) });
  assert.deepEqual(entry().issues, [{ type: "expiring", days: 5 }], "held for someone, the expiry still counts");

  vault.importEntries([{ kind: "thing", title: "Mock Driver's license", spot: "wallet", expires: "2027-01-31" }]);
  assert.equal(vault.publicView().entries.find((e) => e.title === "Mock Driver's license").expires, "2027-01-31");
  assert.throws(() => vault.importEntries([{ kind: "thing", title: "Bad", spot: "x", expires: "31/01/2027" }]), /expires must be YYYY-MM-DD/);
});

test("a due date from before the removal opens as a note; the file keeps it until the next save", async () => {
  const { file, vault, spaceId, id: loginId } = await seeded();
  vault.lock();
  await plantRemoved(file, "due", [{ title: "Mock SSS contribution", agency: "sss", schedule: { every: "month", day: 31 }, nextDue: "2026-10-31", amount: "1,500", viaEntryId: loginId, favorite: true, tags: ["gov"], heldFor: "Mock Lola", receipts: [{ paidAt: "2026-09-28", dueDate: "2026-09-30", reference: "PRN-MOCK-1" }] }]);
  const { vault: view } = await vault.unlock("correct horse battery orbit gazelle");
  const note = view.entries.find((e) => e.title === "Mock SSS contribution");
  assert.deepEqual([note.kind, note.hasBody, note.favorite, note.tags, note.heldFor, note.spaceId], ["note", true, true, ["gov"], "Mock Lola", spaceId]);
  assert.equal(JSON.stringify(view).includes("PRN-MOCK-1"), false, "the body is a secret like every note body");
  assert.equal(vault.getSecret(note.id, "body"), "For: SSS\nSchedule: Every month, by the last day\nNext due: 2026-10-31\nAmount: 1,500\nWebsite login: GitHub\nPaid 2026-09-28: for 2026-09-30, ref PRN-MOCK-1");
  assert.deepEqual(await kindsOnDisk(file), ["due", "login"], "opening alone writes nothing");
  vault.toggleFavorite(loginId);
  assert.deepEqual(await kindsOnDisk(file), ["login", "note"], "the next save writes the note");
});

test("a payee from before the removal opens as a note with every field in its secret body; the file keeps it until the next save", async () => {
  const { file, vault, spaceId, id: loginId } = await seeded();
  vault.lock();
  await plantRemoved(file, "payee", [{ title: "Mock Tita Rosa GCash", who: "Mock Tita Rosa", relation: "Aunt", provider: "GCash", number: "09171234567", accountName: "MO** T*** R.", confirmedAt: "2026-09-12", notes: "Sends rent", favorite: true, tags: ["family"], heldFor: "Mock Lola" }]);
  const { vault: view } = await vault.unlock("correct horse battery orbit gazelle");
  const note = view.entries.find((e) => e.title === "Mock Tita Rosa GCash");
  assert.deepEqual([note.kind, note.hasBody, note.favorite, note.tags, note.heldFor, note.spaceId], ["note", true, true, ["family"], "Mock Lola", spaceId]);
  assert.equal(JSON.stringify(view).includes("09171234567"), false, "the number is part of the secret body now");
  assert.equal(vault.getSecret(note.id, "body"), "Name: Mock Tita Rosa\nRelation: Aunt\nWallet or bank: GCash\nNumber: 09171234567\nAccount name: MO** T*** R.\nConfirmed: 2026-09-12\n\nSends rent");
  assert.deepEqual(await kindsOnDisk(file), ["login", "payee"], "opening alone writes nothing");
  vault.toggleFavorite(loginId);
  assert.deepEqual(await kindsOnDisk(file), ["login", "note"], "the next save writes the note");
});

test("a payee can no longer be saved; an import or restore brings one in as a note", async () => {
  const { file, vault, spaceId } = await seeded();
  assert.throws(() => vault.saveEntry({ kind: "payee", spaceId, title: "Mock Tita", who: "Mock Tita", provider: "GCash", number: "09171234567" }), /Unknown item type/);
  const imported = vault.importEntries([{ kind: "payee", title: "Mock Lola", who: "Mock Lola", provider: "Maya", number: "+639181112222" }]);
  const note = imported.vault.entries.find((e) => e.title === "Mock Lola");
  assert.equal(note.kind, "note");
  assert.equal(vault.getSecret(note.id, "body"), "Name: Mock Lola\nWallet or bank: Maya\nNumber: +639181112222");

  vault.lock();
  const backup = await plantRemoved(file, "payee", [{ title: "Mock Tito", who: "Mock Tito", provider: "BDO", number: "001234567890" }]);
  const restored = vault.commitRestore(backup, (await vault.verifyBackup(backup, "correct horse battery orbit gazelle")).opened);
  assert.equal(restored.vault.entries.find((e) => e.title === "Mock Tito").kind, "note");
});

test("a due date can no longer be saved; an import or restore brings one in as a note", async () => {
  const { file, vault, spaceId } = await seeded();
  assert.throws(() => vault.saveEntry({ kind: "due", spaceId, title: "Mock permit", schedule: { every: "once" }, nextDue: "2026-12-01" }), /Unknown item type/);
  const imported = vault.importEntries([{ kind: "due", title: "Mock PhilHealth", agency: "philhealth", schedule: { every: "year", date: "12-31" }, nextDue: "2026-12-31", via: "Mock PhilHealth portal" }]);
  const note = imported.vault.entries.find((e) => e.title === "Mock PhilHealth");
  assert.equal(note.kind, "note");
  assert.equal(vault.getSecret(note.id, "body"), "For: PhilHealth\nSchedule: Every year, by Dec 31\nNext due: 2026-12-31\nWebsite login: Mock PhilHealth portal");

  vault.lock();
  const backup = await plantRemoved(file, "due", [{ title: "Mock 1701Q", agency: "bir-1701q", schedule: { every: "quarter", dates: ["05-15", "08-15", "11-15"] }, nextDue: "2026-11-15" }]);
  const restored = vault.commitRestore(backup, (await vault.verifyBackup(backup, "correct horse battery orbit gazelle")).opened);
  assert.equal(restored.vault.entries.find((e) => e.title === "Mock 1701Q").kind, "note");
});

// Generated passwords (core/generated.js): the value reaches main at copy/apply time, so a lock that
// throws the open item form away cannot lose a password already pasted into a site.
test("a generated password is kept in the file, listed by time only, and read back one at a time", async () => {
  const { file, vault } = await seeded();
  const view = vault.recordGenerated("mock-generated-Pass-1!");
  assert.equal(view.length, 1);
  assert.deepEqual(Object.keys(view[0]), ["at"]);
  assert.equal(JSON.stringify(vault.publicView()).includes("mock-generated"), false, "the vault view never carries it");
  assert.equal(vault.getGenerated(0), "mock-generated-Pass-1!");
  assert.equal(vault.getGenerated(1), "");
  assert.deepEqual(vault.generatedList().map((row) => Object.keys(row)), [["at"]], "the list call returns times only too");
  assert.deepEqual(vault.clearGenerated(), []);
  vault.recordGenerated("mock-generated-Pass-1!");
  assert.equal(fs.readFileSync(file, "utf8").includes("mock-generated"), false, "encrypted on disk with everything else");
  assert.equal((await openFile("correct horse battery orbit gazelle", JSON.parse(fs.readFileSync(file, "utf8")))).data.genHistory[0].value, "mock-generated-Pass-1!");
});

test("the list survives a lock and a restart, recorded while an item form could be open and unsaved", async () => {
  const { file, vault } = await seeded();
  vault.recordGenerated("mock-before-lock-Pass-1");
  vault.lock();
  assert.throws(() => vault.getGenerated(0), /locked/);
  assert.throws(() => vault.recordGenerated("x"), /locked/);
  const again = createVaultSession(file);
  await again.unlock("correct horse battery orbit gazelle");
  assert.equal(again.getGenerated(0), "mock-before-lock-Pass-1");
  again.lock();
  const restarted = createVaultSession(file);
  assert.equal((await restarted.unlock("correct horse battery orbit gazelle")).ok, true);
  assert.equal(restarted.getGenerated(0), "mock-before-lock-Pass-1");
});

test("main refuses a generated value that is not text, empty or too long, and saves nothing", async () => {
  const { file, vault } = await seeded();
  const disk = fs.readFileSync(file, "utf8");
  for (const bad of [undefined, null, 5, {}, "", "x".repeat(257)]) assert.throws(() => vault.recordGenerated(bad), /Nothing to keep/);
  assert.equal(fs.readFileSync(file, "utf8"), disk);
});

test("recording the same value twice saves once; Clear empties the list and the file", async () => {
  const { file, vault } = await seeded();
  vault.recordGenerated("mock-same-Pass-1");
  const written = fs.readFileSync(file, "utf8");
  vault.recordGenerated("mock-same-Pass-1");
  assert.equal(fs.readFileSync(file, "utf8"), written, "nothing changed, nothing written");
  assert.deepEqual(vault.clearGenerated(), []);
  assert.equal("genHistory" in (await openFile("correct horse battery orbit gazelle", JSON.parse(fs.readFileSync(file, "utf8")))).data, false);
});

test("a failed save leaves the list as it was", async () => {
  const { file, vault } = await seeded();
  vault.recordGenerated("mock-kept-Pass-1");
  fs.rmSync(file);
  fs.mkdirSync(file); // the vault path is now a folder, so the atomic rename onto it fails
  assert.throws(() => vault.recordGenerated("mock-lost-Pass-2"));
  assert.equal(vault.getGenerated(0), "mock-kept-Pass-1");
  assert.equal(vault.getGenerated(1), "");
});

test("a restore brings the backup's own list, and the replaced vault keeps its own", async () => {
  const { file: backupFile, vault: source } = await seeded();
  source.recordGenerated("mock-in-the-backup-Pass-1");
  const backup = fs.readFileSync(backupFile, "utf8");
  const vault = createVaultSession(tempVault());
  await vault.create("current mock lantern phrase orbit gazelle");
  vault.recordGenerated("mock-replaced-Pass-2");
  const checked = await vault.verifyBackup(backup, "correct horse battery orbit gazelle");
  assert.equal(vault.commitRestore(backup, checked.opened).ok, true);
  assert.equal(vault.getGenerated(0), "mock-in-the-backup-Pass-1");
  assert.equal(vault.getGenerated(1), "");
});

test("a hostile backup's list is cleaned: wrong types dropped, text rows kept", async () => {
  const { file: backupFile } = await seeded();
  const opened = await openFile("correct horse battery orbit gazelle", JSON.parse(fs.readFileSync(backupFile, "utf8")));
  const hostile = { ...opened.data, genHistory: [{ value: 5, at: "2026-10-09T00:00:00.000Z" }, { value: "mock-ok-Pass-1", at: new Date().toISOString() }] };
  const text = JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, hostile));
  const vault = createVaultSession(tempVault());
  await vault.create("Another-Mock-Master-91 orbit gazelle");
  const check = await vault.verifyBackup(text, "correct horse battery orbit gazelle");
  vault.commitRestore(text, check.opened);
  assert.equal(vault.getGenerated(0), "mock-ok-Pass-1");
  assert.equal(vault.getGenerated(1), "");
});

test("a save lets go of generated passwords older than 90 days", async () => {
  const { file, vault } = await seeded();
  vault.recordGenerated("mock-old-Pass-1");
  const opened = await openFile("correct horse battery orbit gazelle", JSON.parse(fs.readFileSync(file, "utf8")));
  opened.data.genHistory[0].at = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, opened.data)));
  const again = createVaultSession(file);
  await again.unlock("correct horse battery orbit gazelle");
  assert.equal(again.getGenerated(0), "", "not listed");
  again.saveEntry({ kind: "note", spaceId: again.publicView().spaces[0].id, title: "Mock note", body: "x" });
  assert.equal("genHistory" in (await openFile("correct horse battery orbit gazelle", JSON.parse(fs.readFileSync(file, "utf8")))).data, false, "gone from the file at the next save");
});
