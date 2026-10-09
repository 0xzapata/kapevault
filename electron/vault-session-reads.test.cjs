const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { openFile } = require("./vault-crypto.cjs");
const { seeded, localDay } = require("./fixtures/vault-session-helpers.cjs");

test("public view never carries passwords; getPassword does", async () => {
  const { vault, id } = await seeded();
  const view = JSON.stringify(vault.publicView());
  assert.equal(view.includes("s3cret-pass!"), false);
  assert.equal(vault.getPassword(id), "s3cret-pass!");
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

test("health issues reach the page without the passwords", async () => {
  const { vault, spaceId, id } = await seeded();
  const other = vault.saveEntry({ kind: "login", spaceId, title: "Twin", password: "s3cret-pass!" }).id;
  const issues = (eid) => vault.publicView().entries.find((e) => e.id === eid).issues.map((i) => i.type);
  assert.ok(issues(id).includes("reused"));
  assert.ok(issues(other).includes("reused"));
  const weak = vault.saveEntry({ kind: "login", spaceId, title: "Weak", password: "password1" }).id;
  assert.ok(issues(weak).includes("weak"));
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

test("hand back lists one person's items, any case; secrets only when asked for", async () => {
  const { vault, spaceId } = await seeded();
  const base = { spaceId, heldFor: "Mock Lola" };
  vault.saveEntry({ ...base, kind: "login", title: "Mock Bank", username: "lola", password: "mock-bank-pass", url: "https://bank.example.com", totp: "JBSWY3DPEHPK3PXP", notes: "Branch: Mock Town" });
  vault.saveEntry({ ...base, kind: "note", title: "Mock gate", body: "Gate 4321", heldFor: "mock lola" });
  vault.saveEntry({ ...base, kind: "key", title: "Mock API", keyId: "kid-1", secret: "mock-key-secret" });
  vault.saveEntry({ ...base, kind: "thing", title: "Lola passport", spot: "blue folder" });
  vault.saveEntry({ spaceId, kind: "login", title: "Not hers", password: "other-pass", heldFor: "Mock Papa" });

  const plain = vault.handBack("MOCK LOLA ", false);
  assert.equal(plain.person, "Mock Lola");
  assert.deepEqual(plain.items.map((i) => i.title), ["Lola passport", "Mock API", "Mock Bank", "Mock gate"]);
  const text = JSON.stringify(plain);
  for (const secret of ["mock-bank-pass", "JBSWY3DPEHPK3PXP", "Gate 4321", "mock-key-secret", "other-pass"]) assert.ok(!text.includes(secret), secret);
  const bank = plain.items.find((i) => i.title === "Mock Bank");
  assert.deepEqual(bank.rows.map((r) => r.label), ["Website", "Username", "Notes"]);
  assert.equal(bank.space, "Personal");
  assert.deepEqual(plain.items.find((i) => i.title === "Lola passport").rows.map((r) => `${r.label}: ${r.value}`), ["Where: blue folder", "In a hurry: If there is time"]);

  const full = vault.handBack("Mock Lola", true);
  const rows = full.items.flatMap((i) => i.rows);
  for (const [label, value] of [["Password", "mock-bank-pass"], ["2FA setup key", "JBSWY3DPEHPK3PXP"], ["Note", "Gate 4321"], ["Secret", "mock-key-secret"]]) {
    assert.ok(rows.some((r) => r.label === label && r.value === value && r.secret), label);
  }
  assert.ok(!JSON.stringify(full).includes("other-pass"), "another person's items never come along");
  assert.throws(() => vault.handBack("Mock Nobody", true), /Nothing is held/);
  assert.throws(() => vault.handBack("", true), /Nothing is held/);
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
  const opened = await openFile("correct horse battery orbit gazelle", JSON.parse(fs.readFileSync(file, "utf8")));
  opened.data.entries.find((e) => e.id === id).lifecycle.followUpAt = localDay(-1);
  opened.data.entries.find((e) => e.id === other).lifecycle.followUpAt = localDay(0);
  fs.writeFileSync(file, JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, opened.data)));
  await vault.unlock("correct horse battery orbit gazelle");
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
