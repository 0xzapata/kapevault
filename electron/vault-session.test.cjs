const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createVaultSession } = require("./vault-session.cjs");
const { openFile, encryptWithKey } = require("./vault-crypto.cjs");

function tempVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-test-"));
  return path.join(dir, "vault.kapevault");
}

async function seeded() {
  const file = tempVault();
  const vault = createVaultSession(file);
  const created = await vault.create("correct horse battery");
  const spaceId = created.vault.spaces[0].id;
  const { id } = vault.saveEntry({ kind: "login", spaceId, title: "GitHub", username: "me", password: "s3cret-pass!", url: "https://github.com", tags: ["dev"] });
  return { file, vault, spaceId, id };
}

test("file on disk holds no plaintext", async () => {
  const { file } = await seeded();
  const raw = fs.readFileSync(file, "utf8");
  for (const secret of ["s3cret-pass!", "GitHub", "https://github.com", "Personal"]) {
    assert.equal(raw.includes(secret), false, `${secret} leaked to disk`);
  }
});

test("right password reopens, wrong password does not", async () => {
  const { file } = await seeded();
  const again = createVaultSession(file);
  assert.equal((await again.unlock("wrong password")).ok, false);
  const opened = await again.unlock("correct horse battery");
  assert.equal(opened.ok, true);
  assert.equal(opened.vault.entries[0].title, "GitHub");
});

test("tampered file is rejected", async () => {
  const { file } = await seeded();
  const disk = JSON.parse(fs.readFileSync(file, "utf8"));
  const bytes = Buffer.from(disk.data, "base64");
  bytes[0] ^= 1;
  disk.data = bytes.toString("base64");
  fs.writeFileSync(file, JSON.stringify(disk));
  assert.equal((await createVaultSession(file).unlock("correct horse battery")).ok, false);
});

test("public view never carries passwords; getPassword does", async () => {
  const { vault, id } = await seeded();
  const view = JSON.stringify(vault.publicView());
  assert.equal(view.includes("s3cret-pass!"), false);
  assert.equal(vault.getPassword(id), "s3cret-pass!");
});

test("editing without a password keeps the stored one", async () => {
  const { vault, spaceId, id } = await seeded();
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub 2", username: "me", url: "" });
  assert.equal(vault.getPassword(id), "s3cret-pass!");
});

test("lock wipes access", async () => {
  const { vault } = await seeded();
  vault.lock();
  assert.throws(() => vault.publicView(), /locked/);
});

test("change master password re-keys the file", async () => {
  const { file, vault } = await seeded();
  assert.equal((await vault.changeMaster("nope nope nope", "brand new mock lantern")).ok, false);
  assert.equal((await vault.changeMaster("correct horse battery", "brand new mock lantern")).ok, true);
  assert.equal((await createVaultSession(file).unlock("correct horse battery")).ok, false);
  assert.equal((await createVaultSession(file).unlock("brand new mock lantern")).ok, true);
});

test("no backup copy is left that the old master password could open", async () => {
  const { file, vault } = await seeded();
  await vault.changeMaster("correct horse battery", "brand new mock lantern");
  const leftovers = fs.readdirSync(path.dirname(file)).filter((f) => f !== path.basename(file));
  assert.deepEqual(leftovers, []);
});

test("missing vault file is a clean error, not a crash", async () => {
  const result = await createVaultSession(tempVault()).unlock("anything at all");
  assert.equal(result.ok, false);
});

test("unlocking twice keeps working", async () => {
  const { file } = await seeded();
  const again = createVaultSession(file);
  assert.equal((await again.unlock("correct horse battery")).ok, true);
  assert.equal((await again.unlock("correct horse battery")).ok, true);
  assert.equal(again.publicView().entries.length, 1);
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

test("2FA keys are normalized, hidden from the page, and give codes", async () => {
  const { vault, spaceId, id } = await seeded();
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", totp: "jbsw y3dp ehpk 3pxp" });
  const entry = vault.publicView().entries.find((e) => e.id === id);
  assert.equal(entry.hasTotp, true);
  assert.equal(JSON.stringify(vault.publicView()).includes("JBSWY3DPEHPK3PXP"), false);
  const { code, expiresAt } = vault.getTotpCode(id);
  assert.match(code, /^\d{6}$/);
  assert.ok(expiresAt > Date.now());
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub" }); // undefined keeps it
  assert.equal(vault.publicView().entries.find((e) => e.id === id).hasTotp, true);
  assert.throws(() => vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", totp: "not base32 !!" }), /not a valid 2FA/);
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", totp: "" });
  assert.equal(vault.publicView().entries.find((e) => e.id === id).hasTotp, false);
});

test("secure notes and API keys keep their secrets in main", async () => {
  const { vault, spaceId } = await seeded();
  const note = vault.saveEntry({ kind: "note", spaceId, title: "Recovery codes", body: "1111-2222 3333-4444" }).id;
  const key = vault.saveEntry({ kind: "key", spaceId, title: "Stripe", keyId: "pk_live_abc", secret: "sk_live_xyz", url: "https://stripe.com", expires: "2030-01-01" }).id;
  const view = vault.publicView();
  assert.equal(JSON.stringify(view).includes("1111-2222"), false);
  assert.equal(JSON.stringify(view).includes("sk_live_xyz"), false);
  assert.equal(view.entries.find((e) => e.id === note).hasBody, true);
  const k = view.entries.find((e) => e.id === key);
  assert.equal(k.hasSecret, true);
  assert.equal(k.keyId, "pk_live_abc");
  assert.equal(vault.getSecret(note, "body"), "1111-2222 3333-4444");
  assert.equal(vault.getSecret(key, "secret"), "sk_live_xyz");
  assert.equal(vault.getSecret(key, "password"), "", "fields never cross kinds");
  vault.saveEntry({ id: key, kind: "key", spaceId, title: "Stripe live" });
  assert.equal(vault.getSecret(key, "secret"), "sk_live_xyz", "undefined keeps the secret");
  assert.throws(() => vault.saveEntry({ kind: "key", spaceId, title: "Bad", expires: "next week" }), /date/);
});

test("payees: numbers are cleaned and must be digits; who and provider are required", async () => {
  const { vault, spaceId } = await seeded();
  const save = (fields) => vault.saveEntry({ kind: "payee", spaceId, title: "Mock Tita Rosa GCash", who: "Mock Tita Rosa", provider: "GCash", ...fields });
  const number = (id) => vault.publicView().entries.find((e) => e.id === id).number;
  assert.equal(number(save({ number: "0917 123-4567" }).id), "09171234567");
  assert.equal(number(save({ number: "+63 (917) 123.4567" }).id), "09171234567", "+63 becomes the 0 dialled here");
  assert.equal(number(save({ number: "63 917 123 4567" }).id), "09171234567", "so does 63 without the +");
  assert.equal(number(save({ number: "917 123 4567" }).id), "9171234567", "a bare 9... may be a bank account, kept as typed");
  const branded = save({ number: "09171234567", brand: "bdo" }).id;
  assert.equal(vault.publicView().entries.find((e) => e.id === branded).brand, undefined, "the logo is always the provider's");
  assert.equal(number(save({ number: "0012 3456 7890" }).id), "001234567890");
  for (const bad of ["", "123456", "0917 123 4567 8901 234567", "0917-CALL-ME", "+1 917 123 4567", "12e5678"]) {
    assert.throws(() => save({ number: bad }), /7 to 20 digits/, bad);
  }
  assert.throws(() => save({ number: "09171234567", who: " " }), /name/);
  assert.throws(() => save({ number: "09171234567", provider: "" }), /provider/);
  const p = vault.publicView().entries.find((e) => e.kind === "payee");
  assert.deepEqual(Object.keys(p).filter((k) => ["who", "relation", "provider", "number", "accountName"].includes(k)).sort(), ["accountName", "number", "provider", "relation", "who"]);
});

test("payees: Mark confirmed dates the call; a changed number starts unconfirmed", async () => {
  const { vault, spaceId, id: loginId } = await seeded();
  const input = { kind: "payee", spaceId, title: "Mock Tito Lito BDO", who: "Mock Tito Lito", provider: "BDO", number: "001234567890", accountName: "MO** T*** L." };
  const { id } = vault.saveEntry(input);
  const entry = () => vault.publicView().entries.find((e) => e.id === id);
  assert.equal(entry().confirmedAt, undefined);
  assert.throws(() => vault.confirmPayee(id, "001234567899"), /number changed/, "only the number that was called");
  vault.confirmPayee(id, "001234567890");
  assert.equal(entry().confirmedAt, new Date().toLocaleDateString("en-CA"));
  vault.saveEntry({ ...input, id, notes: "calls on Sundays", number: "0012-3456-7890" });
  assert.ok(entry().confirmedAt, "same number, other edits: still confirmed");
  vault.saveEntry({ ...input, id, number: "001234567899" });
  assert.equal(entry().confirmedAt, undefined);
  assert.throws(() => vault.confirmPayee(loginId, ""), /Not a payee/);
  const imported = vault.importEntries([{ kind: "payee", title: "Mock Lola", who: "Mock Lola", provider: "Maya", number: "+639181112222" }]);
  assert.equal(imported.added, 1);
  assert.throws(() => vault.importEntries([{ kind: "payee", title: "Bad", who: "X", provider: "GCash", number: 9181112222 }]), /number must be text/);
});

test("health issues reach the page without the passwords", async () => {
  const { vault, spaceId, id } = await seeded();
  const other = vault.saveEntry({ kind: "login", spaceId, title: "Twin", password: "s3cret-pass!" }).id;
  const issues = (eid) => vault.publicView().entries.find((e) => e.id === eid).issues.map((i) => i.type);
  assert.ok(issues(id).includes("reused"));
  assert.ok(issues(other).includes("reused"));
  const weak = vault.saveEntry({ kind: "login", spaceId, title: "Weak", password: "password1" }).id;
  assert.ok(issues(weak).includes("weak"));
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

test("touch records use without uploading a backup", async () => {
  let uploads = 0;
  const file = tempVault();
  const vault = createVaultSession(file, { onPersist: () => uploads++ });
  const { vault: view } = await vault.create("correct horse battery");
  const { id } = vault.saveEntry({ kind: "login", spaceId: view.spaces[0].id, title: "A" });
  const before = uploads;
  vault.touch(id);
  assert.equal(uploads, before);
  assert.ok(vault.publicView().entries[0].lastUsedAt > 0);
  vault.saveEntry({ id, kind: "login", spaceId: view.spaces[0].id, title: "A2" });
  assert.ok(vault.publicView().entries[0].lastUsedAt > 0, "an edit keeps lastUsedAt");
});

test("unlockWithKey opens with the live key and refuses a wrong one", async () => {
  const { file, vault } = await seeded();
  const key = vault.keyCopy();
  assert.equal(createVaultSession(file).unlockWithKey(Buffer.from(key)).ok, true);
  assert.equal(createVaultSession(file).unlockWithKey(Buffer.alloc(32, 7)).ok, false);
});

// Audit finding M3 (SECURITY-AUDIT-2026-09-28.md): the header is not covered by the tag. An edited salt used
// to open by key (Windows Hello), be saved back, and lock the master password out of the vault and
// every copy.
test("a key unlock refuses an edited header salt and asks for the master password; nothing is written", async () => {
  const { file, vault } = await seeded();
  const key = vault.keyCopy();
  vault.lock();
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const planted = JSON.stringify({ ...raw, kdf: { ...raw.kdf, salt: Buffer.alloc(16, 9).toString("base64") } });
  fs.writeFileSync(file, planted);
  const result = createVaultSession(file).unlockWithKey(Buffer.from(key));
  assert.equal(result.ok, false);
  assert.equal(result.masterRequired, true, "Hello stays on: the key still fits");
  assert.equal(fs.readFileSync(file, "utf8"), planted, "nothing was saved over it");
  // The real header back: the key opens it, and the master password still does too.
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.equal(createVaultSession(file).unlockWithKey(Buffer.from(key)).ok, true);
  assert.equal((await createVaultSession(file).unlock("correct horse battery")).ok, true);
});

test("a vault from before keySalt asks for the master once, which marks it for the next key unlock", async () => {
  const { file, vault } = await seeded();
  const key = vault.keyCopy();
  const opened = await openFile("correct horse battery", JSON.parse(fs.readFileSync(file, "utf8")));
  const { keySalt, ...before } = opened.data;
  assert.equal(keySalt, opened.salt.toString("base64"), "a saved vault carries it");
  fs.writeFileSync(file, JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, before)));
  assert.equal(createVaultSession(file).unlockWithKey(Buffer.from(key)).masterRequired, true);
  assert.equal((await createVaultSession(file).unlock("correct horse battery")).ok, true);
  assert.equal(createVaultSession(file).unlockWithKey(Buffer.from(key)).ok, true, "marked by the master unlock");
});

// Audit finding M2 (SECURITY-AUDIT-2026-09-28.md): a restored backup is someone else's data. It used to go in unchecked.
test("a hostile backup restores without its malformed fields: the view works and no bad photo is served", async () => {
  const { file: backupFile } = await seeded();
  const opened = await openFile("correct horse battery", JSON.parse(fs.readFileSync(backupFile, "utf8")));
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
  await vault.create("Another-Mock-Master-91");
  const check = await vault.verifyBackup(text, "correct horse battery");
  assert.equal(check.ok, true);
  const result = vault.commitRestore(text, check.opened);
  assert.equal(result.ok, true);
  const view = vault.publicView();
  assert.equal(view.entries.find((e) => e.title === "GitHub").questions.length, 0);
  assert.equal(view.entries.find((e) => e.id === "dev1").hasPhoto, false);
  assert.equal(vault.getSecret("dev1", "photo"), "");
});

test("a master password change marks the new salt in the file it writes", async () => {
  const { file, vault } = await seeded();
  assert.equal((await vault.changeMaster("correct horse battery", "Lantern-Mango-Quiet-47x")).ok, true);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const opened = await openFile("Lantern-Mango-Quiet-47x", raw);
  assert.equal(opened.data.keySalt, raw.kdf.salt);
  assert.equal(createVaultSession(file).unlockWithKey(Buffer.from(opened.key)).ok, true);
});

test("a file restore proves the backup's password before replacing anything", async () => {
  const { file: backupFile } = await seeded();
  const backup = fs.readFileSync(backupFile, "utf8");
  const file = tempVault();
  const vault = createVaultSession(file);
  const { vault: view } = await vault.create("current mock lantern phrase");
  vault.saveEntry({ kind: "login", spaceId: view.spaces[0].id, title: "Keep me" });
  const current = fs.readFileSync(file, "utf8");

  assert.equal((await vault.verifyBackup(backup, "wrong password")).ok, false);
  assert.equal((await vault.verifyBackup("not json", "x")).ok, false);
  const checked = await vault.verifyBackup(backup, "correct horse battery");
  assert.equal(checked.ok, true);
  assert.equal(fs.readFileSync(file, "utf8"), current, "verifying never touches the vault");
  assert.equal(vault.publicView().entries[0].title, "Keep me", "the open vault is untouched too");

  const restored = vault.commitRestore(backup, checked.opened);
  assert.equal(restored.ok, true);
  assert.equal(restored.vault.entries[0].title, "GitHub");
  assert.equal((await createVaultSession(file).unlock("correct horse battery")).ok, true);
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
  await legacy.unlock("correct horse battery");
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

test("a new or changed master password must be long and strong", async () => {
  const vault = createVaultSession(tempVault());
  assert.match((await vault.create("short")).error, /at least 12/);
  assert.match((await vault.create("Summer2024!!")).error, /Too easy to guess/);
  assert.ok((await vault.create("correct horse battery")).ok);
  assert.match((await vault.changeMaster("correct horse battery", "password1234")).error, /Too easy to guess/);
});

test("the page view carries only known safe fields - a new secret field never leaks", async () => {
  const { vault } = await seeded();
  const spaceId = vault.publicView().spaces[0].id;
  vault.saveEntry({ kind: "login", spaceId, title: "Leaky", username: "me", password: "s3cret-pass!", url: "https://x.test" });
  const view = vault.publicView();
  assert.ok(!JSON.stringify(view).includes("s3cret-pass!"));
  const keys = new Set(view.entries.flatMap((e) => Object.keys(e)));
  for (const field of ["password", "totp", "body", "secret", "passwordChangedAt"]) assert.ok(!keys.has(field), field);
});

test("a vault file whose settings would never finish opening is refused before any work", async () => {
  const file = tempVault();
  const vault = createVaultSession(file);
  await vault.create("correct horse battery");
  vault.lock();
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...saved, kdf: { ...saved.kdf, p: 2 ** 20 } }));
  const started = Date.now();
  await assert.rejects(vault.unlock("correct horse battery"), /Not a KAPEVault file/);
  assert.ok(Date.now() - started < 2000);
});

test("held for: any kind keeps a person's name, trimmed; blank clears it; import takes it", async () => {
  const { vault, spaceId, id } = await seeded();
  const entry = (eid) => vault.publicView().entries.find((e) => e.id === eid);
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", heldFor: "  Mock Lola " });
  assert.equal(entry(id).heldFor, "Mock Lola");
  assert.equal(vault.getPassword(id), "s3cret-pass!", "editing the name keeps the password");
  const note = vault.saveEntry({ kind: "note", spaceId, title: "Mock gate", body: "4321", heldFor: "Mock Lola" }).id;
  const payee = vault.saveEntry({ kind: "payee", spaceId, title: "P", who: "Mock Lola", provider: "GCash", number: "09171234567", heldFor: "Mock Lola" }).id;
  assert.equal(entry(note).heldFor, "Mock Lola");
  assert.equal(entry(payee).heldFor, "Mock Lola");
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", heldFor: " " });
  assert.equal(entry(id).heldFor, undefined);
  assert.equal(vault.importEntries([{ kind: "link", title: "Mock photos", location: "https://photos.example.com", heldFor: "Mock Papa" }]).added, 1);
  assert.ok(vault.publicView().entries.some((e) => e.heldFor === "Mock Papa"));
  assert.throws(() => vault.importEntries([{ kind: "note", title: "X", heldFor: 3 }]), /heldFor must be text/);
});

test("hand back lists one person's items, any case; secrets only when asked for", async () => {
  const { vault, spaceId } = await seeded();
  const base = { spaceId, heldFor: "Mock Lola" };
  vault.saveEntry({ ...base, kind: "login", title: "Mock Bank", username: "lola", password: "mock-bank-pass", url: "https://bank.example.com", totp: "JBSWY3DPEHPK3PXP", notes: "Branch: Mock Town" });
  vault.saveEntry({ ...base, kind: "note", title: "Mock gate", body: "Gate 4321", heldFor: "mock lola" });
  vault.saveEntry({ ...base, kind: "key", title: "Mock API", keyId: "kid-1", secret: "mock-key-secret" });
  vault.saveEntry({ ...base, kind: "payee", title: "Lola GCash", who: "Mock Lola", provider: "GCash", number: "09171234567" });
  vault.saveEntry({ spaceId, kind: "login", title: "Not hers", password: "other-pass", heldFor: "Mock Papa" });

  const plain = vault.handBack("MOCK LOLA ", false);
  assert.equal(plain.person, "Mock Lola");
  assert.deepEqual(plain.items.map((i) => i.title), ["Lola GCash", "Mock API", "Mock Bank", "Mock gate"]);
  const text = JSON.stringify(plain);
  for (const secret of ["mock-bank-pass", "JBSWY3DPEHPK3PXP", "Gate 4321", "mock-key-secret", "other-pass"]) assert.ok(!text.includes(secret), secret);
  const bank = plain.items.find((i) => i.title === "Mock Bank");
  assert.deepEqual(bank.rows.map((r) => r.label), ["Website", "Username", "Notes"]);
  assert.equal(bank.space, "Personal");
  assert.deepEqual(plain.items.find((i) => i.title === "Lola GCash").rows.map((r) => `${r.label}: ${r.value}`), ["Provider: GCash", "Number: 09171234567"]);

  const full = vault.handBack("Mock Lola", true);
  const rows = full.items.flatMap((i) => i.rows);
  for (const [label, value] of [["Password", "mock-bank-pass"], ["2FA setup key", "JBSWY3DPEHPK3PXP"], ["Note", "Gate 4321"], ["Secret", "mock-key-secret"]]) {
    assert.ok(rows.some((r) => r.label === label && r.value === value && r.secret), label);
  }
  assert.ok(!JSON.stringify(full).includes("other-pass"), "another person's items never come along");
  assert.throws(() => vault.handBack("Mock Nobody", true), /Nothing is held/);
  assert.throws(() => vault.handBack("", true), /Nothing is held/);
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

test("hand back prints only the unused backup codes, and only when ticked", async () => {
  const { vault, spaceId, id } = await seeded();
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", heldFor: "Mock Lola" });
  vault.setRecoveryCodes(id, ["aaaa-1111", "bbbb-2222", "cccc-3333", "dddd-4444"]);
  vault.markRecoveryCode(id, 0, true);
  assert.ok(!JSON.stringify(vault.handBack("Mock Lola", false)).includes("bbbb-2222"));
  const row = vault.handBack("Mock Lola", true).items[0].rows.find((r) => r.label === "Backup codes");
  assert.deepEqual(row, { label: "Backup codes", value: "bbbb-2222\ncccc-3333\ndddd-4444", secret: true });
});

test("paper copies need a real calendar day; a set saved without paper still shows", async () => {
  const { vault, id } = await seeded();
  vault.setRecoveryCodes(id, ["aaaa-1111", "bbbb-2222", "cccc-3333", "dddd-4444"]);
  for (const bad of ["2026-99-99", "2026-02-30", "2026-13-01"]) assert.throws(() => vault.addPaperCopy(id, "Mock safe", bad), /date/, bad);
  vault.addPaperCopy(id, "Mock safe", "2028-02-29");
  assert.equal(vault.publicView().entries.find((e) => e.id === id).recoveryCodes.paper[0].printedAt, "2028-02-29");
});

test("security questions: the page gets questions and hasAnswer, never an answer; one answer at a time", async () => {
  const { vault, spaceId, id } = await seeded();
  const view = vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", questions: [{ question: " First pet? ", answer: " velvet harbor 38 " }, { question: "Street you grew up on?", answer: "" }] }).vault;
  assert.ok(!JSON.stringify(view).includes("velvet harbor"), "an answer leaked to the page");
  assert.deepEqual(view.entries.find((e) => e.id === id).questions, [{ question: "First pet?", hasAnswer: true }, { question: "Street you grew up on?", hasAnswer: false }]);
  assert.equal(vault.getSecret(id, "answer", 0), "velvet harbor 38", "trimmed");
  assert.equal(vault.getSecret(id, "answer", 5), "");
  const noteId = vault.saveEntry({ kind: "note", spaceId, title: "N", body: "b" }).id;
  assert.equal(vault.getSecret(noteId, "answer", 0), "");
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

const localDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA");
};

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

  const opened = await openFile("correct horse battery", JSON.parse(fs.readFileSync(file, "utf8")));
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

test("follow-ups due counts only deletion requests past their day", async () => {
  const { file, vault, spaceId, id } = await seeded();
  const other = vault.saveEntry({ kind: "login", spaceId, title: "Shop" }).id;
  const third = vault.saveEntry({ kind: "login", spaceId, title: "Forum" }).id;
  vault.setLifecycle(id, "deletion-requested");
  vault.setLifecycle(other, "deletion-requested");
  vault.setLifecycle(third, "dormant");
  assert.equal(vault.followUpsDue(), 0, "a month away");
  // Move one follow-up into the past in the file itself, then reopen.
  vault.lock();
  assert.equal(vault.followUpsDue(), 0, "locked: nothing to count");
  const { encryptWithKey } = require("./vault-crypto.cjs");
  const opened = await openFile("correct horse battery", JSON.parse(fs.readFileSync(file, "utf8")));
  opened.data.entries.find((e) => e.id === id).lifecycle.followUpAt = localDay(-1);
  opened.data.entries.find((e) => e.id === other).lifecycle.followUpAt = localDay(0);
  fs.writeFileSync(file, JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, opened.data)));
  await vault.unlock("correct horse battery");
  assert.equal(vault.followUpsDue(), 2, "due on the day and after; dormant never counts");
});

test("hand back prints questions always and answers only when ticked", async () => {
  const { vault, spaceId, id } = await seeded();
  vault.saveEntry({ id, kind: "login", spaceId, title: "GitHub", heldFor: "Mock Lola", questions: [{ question: "First pet?", answer: "mock cobalt otter 12" }] });
  const rows = (secrets) => vault.handBack("Mock Lola", secrets).items[0].rows;
  assert.ok(rows(false).some((r) => r.label === "Security question" && r.value === "First pet?" && !r.secret));
  assert.ok(!JSON.stringify(rows(false)).includes("mock cobalt otter"));
  assert.deepEqual(rows(true).find((r) => r.label === "Answer"), { label: "Answer", value: "mock cobalt otter 12", secret: true });
});

const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600)]).toString("base64")}`;

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

test("a save that would make the vault bigger than any restore reads is refused, and nothing changes", async () => {
  const { file, vault, spaceId } = await seeded();
  const before = fs.readFileSync(file);
  assert.throws(() => vault.saveEntry({ kind: "note", spaceId, title: "Mock huge note", body: "x".repeat(50 * 1024 * 1024) }), /too big to back up \(over 64 MB\), so this was not saved/);
  assert.ok(fs.readFileSync(file).equals(before), "nothing written");
  assert.ok(!vault.publicView().entries.some((e) => e.title === "Mock huge note"), "and not kept in memory for the next save");
  vault.saveEntry({ kind: "note", spaceId, title: "Mock small note", body: "fine" });
  assert.deepEqual(vault.publicView().entries.map((e) => e.title).sort(), ["GitHub", "Mock small note"]);
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

// Due dates were removed (2026-09-26). A vault written before then is planted here by rewriting the
// file while locked, the way an old install or backup would hold them.
async function plantDue(file, entries) {
  const { encryptWithKey } = require("./vault-crypto.cjs");
  const opened = await openFile("correct horse battery", JSON.parse(fs.readFileSync(file, "utf8")));
  opened.data.entries.push(...entries.map((e, i) => ({ id: `mock-due-${i}`, spaceId: opened.data.spaces[0].id, kind: "due", ...e })));
  const text = JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, opened.data));
  fs.writeFileSync(file, text);
  return text;
}
const kindsOnDisk = async (file) => (await openFile("correct horse battery", JSON.parse(fs.readFileSync(file, "utf8")))).data.entries.map((e) => e.kind).sort();

test("a due date from before the removal opens as a note; the file keeps it until the next save", async () => {
  const { file, vault, spaceId, id: loginId } = await seeded();
  vault.lock();
  await plantDue(file, [{ title: "Mock SSS contribution", agency: "sss", schedule: { every: "month", day: 31 }, nextDue: "2026-10-31", amount: "1,500", viaEntryId: loginId, favorite: true, tags: ["gov"], heldFor: "Mock Lola", receipts: [{ paidAt: "2026-09-28", dueDate: "2026-09-30", reference: "PRN-MOCK-1" }] }]);
  const { vault: view } = await vault.unlock("correct horse battery");
  const note = view.entries.find((e) => e.title === "Mock SSS contribution");
  assert.deepEqual([note.kind, note.hasBody, note.favorite, note.tags, note.heldFor, note.spaceId], ["note", true, true, ["gov"], "Mock Lola", spaceId]);
  assert.equal(JSON.stringify(view).includes("PRN-MOCK-1"), false, "the body is a secret like every note body");
  assert.equal(vault.getSecret(note.id, "body"), "For: SSS\nSchedule: Every month, by the last day\nNext due: 2026-10-31\nAmount: 1,500\nWebsite login: GitHub\nPaid 2026-09-28: for 2026-09-30, ref PRN-MOCK-1");
  assert.deepEqual(await kindsOnDisk(file), ["due", "login"], "opening alone writes nothing");
  vault.toggleFavorite(loginId);
  assert.deepEqual(await kindsOnDisk(file), ["login", "note"], "the next save writes the note");
});

test("a due date can no longer be saved; an import or restore brings one in as a note", async () => {
  const { file, vault, spaceId } = await seeded();
  assert.throws(() => vault.saveEntry({ kind: "due", spaceId, title: "Mock permit", schedule: { every: "once" }, nextDue: "2026-12-01" }), /Unknown item type/);
  const imported = vault.importEntries([{ kind: "due", title: "Mock PhilHealth", agency: "philhealth", schedule: { every: "year", date: "12-31" }, nextDue: "2026-12-31", via: "Mock PhilHealth portal" }]);
  const note = imported.vault.entries.find((e) => e.title === "Mock PhilHealth");
  assert.equal(note.kind, "note");
  assert.equal(vault.getSecret(note.id, "body"), "For: PhilHealth\nSchedule: Every year, by Dec 31\nNext due: 2026-12-31\nWebsite login: Mock PhilHealth portal");

  vault.lock();
  const backup = await plantDue(file, [{ title: "Mock 1701Q", agency: "bir-1701q", schedule: { every: "quarter", dates: ["05-15", "08-15", "11-15"] }, nextDue: "2026-11-15" }]);
  const restored = vault.commitRestore(backup, (await vault.verifyBackup(backup, "correct horse battery")).opened);
  assert.equal(restored.vault.entries.find((e) => e.title === "Mock 1701Q").kind, "note");
});

// The disk refuses the next write (full, antivirus, a sync lock) - once, or until restored.
function refuseWrites(t) {
  return t.mock.method(fs, "renameSync", () => {
    throw Object.assign(new Error("EPERM: mock disk refused"), { code: "EPERM" });
  });
}

test("a save the disk refuses is not kept in memory: a retry adds it once, a failed delete never happens later", async (t) => {
  const { file, vault, spaceId, id } = await seeded();
  const refused = refuseWrites(t);
  assert.throws(() => vault.saveEntry({ kind: "note", spaceId, title: "Mock note", body: "b" }), /mock disk refused/);
  assert.throws(() => vault.deleteEntry(id), /mock disk refused/);
  assert.throws(() => vault.addSpace("Mock Client"), /mock disk refused/);
  assert.throws(() => vault.setRecoveryCodes(id, ["aaaa-1111", "bbbb-2222", "cccc-3333", "dddd-4444"]), /mock disk refused/);
  const view = vault.publicView();
  assert.deepEqual(view.entries.map((e) => e.title), ["GitHub"], "the failed add is gone and the failed delete did not happen");
  assert.equal(view.spaces.length, 1);
  assert.equal(view.entries[0].recoveryCodes, undefined);

  refused.mock.restore();
  vault.saveEntry({ kind: "note", spaceId, title: "Mock note", body: "b" });
  vault.renameSpace(spaceId, "Mine"); // any later save must not carry the failed delete
  const again = createVaultSession(file);
  await again.unlock("correct horse battery");
  assert.deepEqual(again.publicView().entries.map((e) => e.title).sort(), ["GitHub", "Mock note"]);
});

test("a failed master password change keeps the old password and does not flag older backups", async (t) => {
  const { file, vault, spaceId } = await seeded();
  vault.setCloud({ endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "mock-bucket", accessKeyId: "mock-key", secretAccessKey: "mock-secret", auto: false });
  const refused = refuseWrites(t);
  await assert.rejects(vault.changeMaster("correct horse battery", "brand new master phrase"), /mock disk refused/);
  refused.mock.restore();
  assert.equal(vault.cloudView().olderBackups, false, "nothing changed, so no older backups to delete");
  vault.saveEntry({ kind: "note", spaceId, title: "Mock after", body: "b" }); // still saved with the old key
  assert.equal((await createVaultSession(file).unlock("correct horse battery")).ok, true);
});

test("a vault whose first write fails is not left open", async (t) => {
  const vault = createVaultSession(tempVault());
  refuseWrites(t);
  await assert.rejects(vault.create("correct horse battery"), /mock disk refused/);
  assert.equal(vault.status().unlocked, false);
});

const MOCK_CLOUD = (bucket) => ({ endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket, accessKeyId: `mock-key-${bucket}`, secretAccessKey: "mock-secret", auto: true });

test("an unlocked restore keeps this device's cloud backup setup; a locked one takes the backup's", async () => {
  const { file, vault, spaceId } = await seeded();
  vault.setCloud(MOCK_CLOUD("backup-bucket"));
  const backup = fs.readFileSync(file, "utf8"); // made on another device, with its own R2 setup
  vault.setCloud(MOCK_CLOUD("this-device"));
  vault.saveEntry({ kind: "note", spaceId, title: "Mock later", body: "b" });

  const result = vault.commitRestore(backup, (await vault.verifyBackup(backup, "correct horse battery")).opened, { cloud: vault.cloudConfig() });
  assert.equal(result.keptCloud, true);
  assert.deepEqual(result.vault.entries.map((e) => e.title), ["GitHub"], "the vault content is the backup's");
  assert.equal(vault.cloudConfig().bucket, "this-device");
  const reopened = createVaultSession(file);
  await reopened.unlock("correct horse battery");
  assert.equal(reopened.cloudConfig().bucket, "this-device", "and it is on disk, not only in memory");

  reopened.lock(); // locked: there is no setup of this device's to keep
  const locked = reopened.commitRestore(backup, (await reopened.verifyBackup(backup, "correct horse battery")).opened);
  assert.equal(locked.keptCloud, false);
  assert.equal(reopened.cloudConfig().bucket, "backup-bucket");
});

test("the R2 setup a restore keeps is the one read before the upload, even if the vault locked meanwhile", async () => {
  const { file, vault } = await seeded();
  vault.setCloud(MOCK_CLOUD("backup-bucket"));
  const backup = fs.readFileSync(file, "utf8");
  vault.setCloud(MOCK_CLOUD("this-device"));
  const cloud = vault.cloudConfig(); // read before keepBeforeRestore uploads the current vault
  const opened = (await vault.verifyBackup(backup, "correct horse battery")).opened;
  vault.lock(); // idle or session limit, while the upload ran
  const result = vault.commitRestore(backup, opened, { cloud });
  assert.equal(result.keptCloud, true, "said as it happened: the replaced vault went to this bucket, which stays set up");
  assert.equal(vault.cloudConfig().bucket, "this-device");
});

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
  const opened = (await vault.verifyBackup(slot, "correct horse battery")).opened;
  vault.stageReplacedCopy();
  const refused = refuseWrites(t);
  assert.throws(() => vault.commitRestore(slot, opened, { slot: "staged" }), /mock disk refused/);
  refused.mock.restore();
  assert.equal(fs.readFileSync(replaced, "utf8"), slot, "the slot was never overwritten");
  assert.equal(fs.readFileSync(file, "utf8"), current);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["replaced.kapevault", "vault.kapevault"], "the staged copy is cleaned up");

  vault.stageReplacedCopy();
  const result = vault.commitRestore(slot, (await vault.verifyBackup(slot, "correct horse battery")).opened, { slot: "staged" });
  assert.equal(result.slotOk, true);
  assert.deepEqual(result.vault.entries.map((e) => e.title), ["GitHub"]);
  assert.equal(fs.readFileSync(replaced, "utf8"), current, "the slot now holds the vault it replaced - never the same vault twice");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["replaced.kapevault", "vault.kapevault"]);
});

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
  const result = vault.commitRestore(slot, (await vault.verifyBackup(slot, "correct horse battery")).opened, { slot: "staged" });
  if (saveAfter) vault.saveEntry({ kind: "note", spaceId, title: "Mock after restore", body: "b" });
  refused.mock.restore();
  return { file, dir, vault, spaceId, current, result };
}

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
  const opened = (await vault.verifyBackup(slot, "correct horse battery")).opened;
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
  const opened = (await vault.verifyBackup(slot, "correct horse battery")).opened;
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
  const result = vault.commitRestore(slot, (await vault.verifyBackup(slot, "correct horse battery")).opened, { slot: "clear" });
  assert.equal(result.slotOk, true);
  assert.equal(vault.replacedCopyInfo(), null);
});

test("clearing the slot after a restore deletes only the copy that was restored, never a vault that took the slot meanwhile", async () => {
  const { file, vault, spaceId } = await seeded();
  const replaced = path.join(path.dirname(file), "replaced.kapevault");
  vault.keepReplacedCopy();
  const slot = fs.readFileSync(replaced, "utf8");
  const opened = (await vault.verifyBackup(slot, "correct horse battery")).opened;
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
  assert.deepEqual(await vault.proveCopy(file, "correct horse battery"), { ok: true });
  assert.equal((await vault.proveCopy(path.join(path.dirname(file), "missing.kapevault"), "x")).ok, false);
  const planted = path.join(path.dirname(file), "planted.kapevault");
  fs.writeFileSync(planted, "not a vault");
  assert.deepEqual(await vault.proveCopy(planted, "correct horse battery"), { ok: false, error: "That file is not a KAPEVault vault." });
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

  await vault.unlock("correct horse battery");
  vault.saveEntry({ kind: "note", spaceId, title: "Mock later", body: "b" });
  // A second restore never overwrites it: after a lock-screen restore of someone's own file, the slot
  // holds the real vault, and a second restore would otherwise wipe it without any password.
  assert.throws(() => vault.keepReplacedCopy(), (e) => e.code === "slot-taken");
  assert.ok(fs.readFileSync(replaced).equals(first), "the slot keeps the vault it had");
  assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), ["replaced.kapevault", "vault.kapevault"]);
  assert.equal((await createVaultSession(replaced).unlock("correct horse battery")).ok, true);

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

test("a new master password the strength rule refuses is marked as a rule, not a wrong guess", async () => {
  const { vault } = await seeded();
  assert.deepEqual(await vault.changeMaster("correct horse battery", "short"), { ok: false, error: "Use at least 12 characters.", rule: true });
  const wrong = await vault.changeMaster("not the password at all", "brand new master phrase");
  assert.equal(wrong.ok, false);
  assert.equal(wrong.rule, undefined, "a wrong current password is a guess");
});

// ---- Sync-ready data (SYNC.md 3.1, 3.2): stamped in persist(), migrated and repaired in start()
const INSTALL = "0b8c8e52-1b7e-4d8e-9a53-6f0c1d2e3f40";
const MASTER = "correct horse battery";
const onDisk = async (file) => (await openFile(MASTER, JSON.parse(fs.readFileSync(file, "utf8")))).data;

// The file's plaintext rewritten as an app version without sync would leave it.
async function writeAsOldBuild(file, change) {
  const { encryptWithKey } = require("./vault-crypto.cjs");
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

test("a save stamps what changed, and the file carries it; a new vault stamps nothing", async () => {
  const { file, vault, spaceId, id } = await syncing();
  let sync = (await onDisk(file)).sync;
  assert.equal(sync.vaultId, spaceId, "the Personal space names the vault");
  assert.deepEqual(Object.keys(sync.meta), [id], "the new vault's Personal space is not stamped");
  assert.deepEqual(sync.meta[id].vv, { [INSTALL]: 1 });
  vault.toggleFavorite(id);
  vault.touch(id);
  sync = (await onDisk(file)).sync;
  assert.deepEqual(sync.meta[id].vv, { [INSTALL]: 2 }, "the favorite stamps; using the item does not");
  assert.deepEqual(sync.meta[id].g.fav.dot, [INSTALL, 2]);
  vault.deleteEntry(id);
  assert.deepEqual((await onDisk(file)).sync.gone[id].vv, { [INSTALL]: 3 });
});

test("a failed save rolls sync back with it: no stamp, no tombstone, no counter it never wrote", async (t) => {
  const { file, vault, spaceId, id } = await syncing();
  const refused = refuseWrites(t);
  assert.throws(() => vault.saveEntry({ id, kind: "login", spaceId, title: "Mock renamed" }), /mock disk refused/);
  assert.throws(() => vault.deleteEntry(id), /mock disk refused/);
  refused.mock.restore();
  vault.toggleFavorite(id);
  const { sync } = await onDisk(file);
  assert.equal(sync.gone[id], undefined);
  assert.deepEqual(sync.meta[id].vv, { [INSTALL]: 2 }, "create, then the favorite - the failed rename left no count");
  assert.deepEqual(Object.keys(sync.meta[id].g).sort(), ["core", "fav", "pw", "space"]);
  assert.deepEqual(sync.meta[id].g.core.dot, [INSTALL, 1]);
});

test("a vault saved before sync opens unchanged and gains sync on its next save, stamping nothing old", async () => {
  const { file, vault: synced, id } = await syncing();
  const withSync = synced.publicView();
  synced.lock();
  await writeAsOldBuild(file, (data) => delete data.sync);
  const vault = createVaultSession(file, { installId: () => INSTALL });
  assert.deepEqual((await vault.unlock(MASTER)).vault, withSync, "the page sees the same vault");
  vault.touch(id);
  const data = await onDisk(file);
  assert.deepEqual(data.sync.meta, {}, "migration never stamps");
  assert.deepEqual(data.sync.gone, {});
});

test("repair on open: an old build's edit is stamped and its delete is tombstoned", async () => {
  const { file, spaceId, id } = await syncing();
  const other = createVaultSession(file, { installId: () => INSTALL });
  await other.unlock(MASTER);
  const { id: note } = other.saveEntry({ kind: "note", spaceId, title: "Mock note", body: "b" });
  other.lock();
  await writeAsOldBuild(file, (data) => {
    data.entries = data.entries.filter((e) => e.id !== note).map((e) => (e.id === id ? { ...e, password: "changed-by-old-build" } : e));
  });
  const vault = createVaultSession(file, { installId: () => INSTALL });
  await vault.unlock(MASTER);
  vault.addSpace("Mock Client"); // any save writes what repair found
  const { sync } = await onDisk(file);
  assert.deepEqual(sync.meta[id].vv, { [INSTALL]: 2 });
  assert.deepEqual(sync.gone[note].vv, { [INSTALL]: 2 });
});

test("a master password change records the new salt as the newest key", async () => {
  const { file, vault } = await syncing();
  await vault.changeMaster(MASTER, "brand new master phrase");
  const disk = JSON.parse(fs.readFileSync(file, "utf8"));
  const { data } = await openFile("brand new master phrase", disk);
  assert.equal(data.sync.keys.at(-1).salt, disk.kdf.salt);
  assert.equal(data.sync.keys.length, 2);
});

// ---- The sync loop's hooks (SYNC.md 3.9): a merged vault is committed as it is, never stamped
const OTHER = "7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

test("sync's own save writes the merged vault as it is, and tells onPersist it was sync", async () => {
  const file = tempVault();
  const saves = [];
  const vault = createVaultSession(file, { installId: () => INSTALL, onPersist: (save) => saves.push(save) });
  const spaceId = (await vault.create(MASTER)).vault.spaces[0].id;
  const { id } = vault.saveEntry({ kind: "note", spaceId, title: "Mock note", body: "b" });
  assert.deepEqual(saves.at(-1), { bySync: false });

  const base = vault.syncBase();
  const theirs = { id: "from-other", kind: "note", spaceId, title: "Mock note from the phone", body: "p" };
  const stampOf = { dot: [OTHER, 1], at: [5, 0, OTHER] };
  const merged = {
    ...base.data,
    entries: [...base.data.entries, theirs],
    sync: { ...base.data.sync, meta: { ...base.data.sync.meta, [theirs.id]: { vv: { [OTHER]: 1 }, g: { core: stampOf, space: stampOf, body: stampOf } } } },
  };
  assert.equal(vault.commitSync(merged, base.revision), true);
  assert.deepEqual(saves.at(-1), { bySync: true });
  let sync = (await onDisk(file)).sync;
  assert.deepEqual(sync.meta[theirs.id].vv, { [OTHER]: 1 }, "the merged item is not stamped as this device's edit");
  assert.deepEqual(sync.meta[id].vv, { [INSTALL]: 1 });

  vault.toggleFavorite(theirs.id); // the merged vault is the baseline: the next save stamps only this
  sync = (await onDisk(file)).sync;
  assert.deepEqual(sync.meta[theirs.id].vv, { [OTHER]: 1, [INSTALL]: 1 });
  assert.deepEqual(Object.keys(sync.meta[theirs.id].g).sort(), ["body", "core", "fav", "space"]);
  assert.deepEqual(sync.meta[id].vv, { [INSTALL]: 1 });
});

test("a sync commit against a vault that changed since it was read writes nothing", async () => {
  const { file, vault, id } = await syncing();
  const base = vault.syncBase();
  vault.toggleFavorite(id);
  const before = fs.readFileSync(file);
  assert.equal(vault.commitSync({ ...base.data, entries: [] }, base.revision), false);
  assert.ok(fs.readFileSync(file).equals(before));
  assert.equal(vault.publicView().entries.length, 1);
  vault.lock();
  assert.throws(() => vault.syncBase(), /locked/);
  assert.equal(vault.commitSync(base.data, base.revision), false, "never while locked");
});

test("each open is a new session generation; saves move the revision", async () => {
  const { vault, id } = await syncing();
  const first = vault.syncBase();
  vault.toggleFavorite(id);
  const saved = vault.syncBase();
  assert.equal(saved.generation, first.generation);
  assert.ok(saved.revision > first.revision);
  vault.lock();
  await vault.unlock(MASTER);
  assert.ok(vault.syncBase().generation > first.generation);
});

test("a snapshot opens with the session key when its salt matches; another key or a damaged file does not", async () => {
  const { file, vault } = await syncing();
  const same = fs.readFileSync(file);
  assert.equal(vault.openSnapshot(same).data.entries[0].title, "Mock Portal");

  const other = path.join(path.dirname(file), "other.kapevault");
  fs.copyFileSync(file, other);
  const elsewhere = createVaultSession(other, { installId: () => OTHER });
  await elsewhere.unlock(MASTER);
  await elsewhere.changeMaster(MASTER, "brand new master phrase");
  assert.deepEqual(vault.openSnapshot(fs.readFileSync(other)), { otherKey: true, behind: false }, "a newer key this vault never had");
  assert.deepEqual(elsewhere.openSnapshot(same), { otherKey: true, behind: true }, "the other device still has the old key");

  const damaged = JSON.parse(same.toString("utf8"));
  const bytes = Buffer.from(damaged.data, "base64");
  bytes[3] ^= 1;
  damaged.data = bytes.toString("base64");
  assert.equal(vault.openSnapshot(Buffer.from(JSON.stringify(damaged))), null);
  assert.equal(vault.openSnapshot(same.subarray(0, 40)), null, "truncated");
  assert.equal(vault.openSnapshot(Buffer.from('{"format":"kapevault","version":1,"kdf":{"p":1048576}}')), null, "a planted header");
});

test("the sync log rides the next write and stays on this device", async () => {
  const { file, vault, id } = await syncing();
  vault.keepSyncLog([{ at: 1, with: [OTHER], added: 0, changed: 0, deleted: 0, copies: 0 }]);
  assert.equal((await onDisk(file)).syncLog, undefined, "not written by itself");
  vault.toggleFavorite(id);
  assert.deepEqual((await onDisk(file)).syncLog, [{ at: 1, with: [OTHER], added: 0, changed: 0, deleted: 0, copies: 0 }]);
  assert.equal(vault.syncBase().data.syncLog.length, 1);
});

test("another device's snapshot under a new master password opens with that password, and a commit adopts its key", async () => {
  const { file, vault } = await syncing();
  const other = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-other-")), "vault.kapevault");
  fs.copyFileSync(file, other);
  const elsewhere = createVaultSession(other, { installId: () => OTHER });
  await elsewhere.unlock(MASTER);
  await elsewhere.changeMaster(MASTER, "brand new master phrase");
  const bytes = fs.readFileSync(other);

  assert.deepEqual(await vault.openWithPassword(bytes, MASTER), { ok: false, error: "Wrong master password." });
  assert.deepEqual(await vault.openWithPassword(Buffer.from("not a vault"), MASTER), { ok: false, damaged: true, error: "That backup cannot be opened." });
  const { opened } = await vault.openWithPassword(bytes, "brand new master phrase");

  // Read before a save: nothing is written, and the key it carried is wiped.
  const base = vault.syncBase();
  vault.addSpace("Mock Client");
  const stale = { ...opened, key: Buffer.from(opened.key) };
  assert.equal(vault.commitSync(base.data, base.revision, stale), false);
  assert.ok(stale.key.every((b) => b === 0));

  vault.setCloud({ endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "mock-bucket", accessKeyId: "k", secretAccessKey: "s", auto: true });
  const now = vault.syncBase();
  assert.equal(vault.commitSync({ ...now.data, sync: { ...now.data.sync, keys: opened.data.sync.keys } }, now.revision, opened), true);
  const disk = (await openFile("brand new master phrase", JSON.parse(fs.readFileSync(file, "utf8")))).data;
  assert.equal(disk.olderBackupsPending, true, "this device's older backups still open with the old password");
  assert.equal(vault.openSnapshot(bytes).data.entries.length, 1, "the session holds the new key");
  assert.ok(vault.syncBase().generation > now.generation);
});

test("a new epoch and a removed device are saved like any change", async () => {
  const { file, vault } = await syncing();
  vault.startEpoch("epoch-2");
  vault.revokeDevice(OTHER);
  const { sync } = await onDisk(file);
  assert.equal(sync.epoch.id, "epoch-2");
  assert.equal(sync.devices[OTHER].name, "Another device");
  assert.ok(sync.devices[OTHER].revokedAt);
});

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
