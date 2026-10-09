// End-to-end checks for Shrink Queue: Close this account (Mark dormant, Request
// deletion with the erasure email: Copy email, Open the site, I sent it), the Closing list and its
// follow-up marker (the date is seeded into the vault file), the tray tooltip saying only a count,
// health checks skipping closing accounts, Back in use, Confirm it's gone (every secret wiped, the
// tombstone in Closed, read only, out of search), and Delete for good. Part of npm run e2e.
// Throwaway vault, mock names only. Page screenshots (light + dark) in %TEMP%\kapevault-e2e-v2.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHarness, shows, gone, clip, opened, waitFor } = require("./e2e-harness.cjs");
const { openFile, encryptWithKey } = require("../electron/vault-crypto.cjs");

const SHOTS = path.join(os.tmpdir(), "kapevault-e2e-v2");
fs.mkdirSync(SHOTS, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-shrink-"));
const { check, launch, lockedBy, report } = createHarness();
const MASTER = "mock kettle harbor pass orbit gazelle";
const FORUM_PASSWORD = "password1"; // weak on purpose: a health issue to see disappear

(async () => {
  const { app, page, errors } = await launch({ KAPEVAULT_DATA_DIR: dataDir });
  const aside = page.locator("aside[aria-label='Vault navigation']");
  const search = aside.locator("[data-search]");
  const main = page.locator("main");
  const status = page.locator("section[aria-label='Closing']");
  const rowOf = (title) => page.locator("section li", { hasText: title });
  const theme = (t) => page.evaluate((name) => window.kapevault.setSettings({ theme: name }), t).then(() => page.waitForTimeout(400));
  const shot = async (name) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    await theme("dark");
    await page.screenshot({ path: path.join(SHOTS, `${name}-dark.png`) });
    await theme("classic");
  };
  const entry = (title) => page.evaluate(async (t) => (await window.kapevault.view()).entries.find((e) => e.title === t), title);
  const localDay = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString("en-CA");
  };

  // The tray tooltip is set in main; record every value it is given.
  await app.evaluate(({ Tray }) => {
    globalThis.__tips = [];
    const set = Tray.prototype.setToolTip;
    Tray.prototype.setToolTip = function (text) {
      globalThis.__tips.push(text);
      return set.call(this, text);
    };
  });
  const lastTip = () => app.evaluate(() => globalThis.__tips.at(-1) ?? "");

  await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
  await page.getByPlaceholder("Confirm master password").fill(MASTER);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Nothing here yet").waitFor({ timeout: 15000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.evaluate(async (weak) => {
    const b = window.kapevault;
    const spaceId = (await b.view()).spaces[0].id;
    const base = { spaceId, tags: [], favorite: false };
    // Every kind of login secret: a password with an old one in history, 2FA, backup codes, an answer.
    const forum = { ...base, kind: "login", title: "Mock Old Forum", username: "mock.forum@example.com", url: "https://forum.example.com", notes: "Mock note: stopped using it" };
    const { id } = await b.saveEntry({ ...forum, password: "Mock-Forum-Old-Pass-9!", totp: "JBSWY3DPEHPK3PXP", questions: [{ question: "Mock first pet?", answer: "mock velvet otter 38" }] });
    await b.saveEntry({ ...forum, id, password: weak });
    await b.setRecoveryCodes(id, ["1111 2222", "3333 4444", "5555 6666", "7777 8888"]);
    await b.saveEntry({ ...base, notes: "", kind: "login", title: "Mock Shop", username: "mock.shop", password: "Mock-Shop-Pass-72!x", url: "https://shop.example.com" });
    await b.saveEntry({ ...base, notes: "", kind: "login", title: "Mock Stream", username: "mock.stream", password: "Mock-Stream-Pass-72!x", url: "https://stream.example.com" });
  }, FORUM_PASSWORD);
  await rowOf("Mock Old Forum").click();
  check("the seeded login holds every kind of secret", await page.evaluate(async () => {
    const e = (await window.kapevault.view()).entries.find((x) => x.title === "Mock Old Forum");
    return e.hasPassword && e.hasTotp && e.history.length === 1 && e.questions.length === 1 && e.recoveryCodes.total === 4;
  }));
  check("the weak password raises a health issue", await shows(page.getByRole("region", { name: "Security issue" })));
  check("no Closing or Closed list while nothing is being closed", !(await aside.getByRole("button", { name: /^Closing/ }).isVisible()) && !(await aside.getByRole("button", { name: /^Closed/ }).isVisible()));

  // ---- Close this account: Mark dormant
  await main.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Close this account..." }).click();
  const sheet = page.getByRole("dialog");
  check("Close this account offers dormant or deletion", (await shows(sheet.getByRole("button", { name: /I stopped using it/ }))) && (await shows(sheet.getByRole("button", { name: /Ask to delete/ }))));
  await shot("closing-choose");
  await sheet.getByRole("button", { name: /I stopped using it/ }).click();
  check("I stopped using it says so", await shows(page.getByRole("status").filter({ hasText: "Moved to Closing" })));
  check("the detail shows it is not in use", await shows(status.getByText("Not in use", { exact: true })));
  check("a closing account leaves the health checks", (await gone(page.getByRole("region", { name: "Security issue" }))) && (await entry("Mock Old Forum")).issues.length === 0);
  check("the Closing list appears", await shows(aside.getByRole("button", { name: /^Closing/ })));

  // ---- Request deletion: the email, Copy email, Open the site, I sent it
  await status.getByRole("button", { name: "Ask to delete" }).click();
  const email = sheet.getByLabel("Email");
  check("the erasure email names the account", (await shows(sheet.getByText("Request to delete my account and personal data - Mock Old Forum"))) && (await email.innerText()).includes("Account: mock.forum@example.com"));
  check("it names GDPR Article 17 and RA 10173 Section 16(e)", /Article 17 of the EU General Data Protection Regulation/.test(await email.innerText()) && /Section 16\(e\) of the Philippine Data Privacy Act of 2012 \(Republic Act No\. 10173\)/.test(await email.innerText()));
  check("it says it is a template, not legal advice", await shows(sheet.getByText("A template, not legal advice.")));
  await shot("closing-email");
  await sheet.getByRole("button", { name: "Copy email" }).click();
  check("Copy email puts subject and body on the clipboard", await waitFor(async () => (await clip(app)).startsWith("Subject: Request to delete my account and personal data - Mock Old Forum\n\nHello,")));
  await sheet.getByRole("button", { name: "Open website" }).click();
  check("Open the site opens the login's own website", await waitFor(async () => (await opened(app)).some(([k, u]) => k === "external" && u === "https://forum.example.com/")));
  await sheet.getByRole("button", { name: "I sent it" }).click();
  check("I sent it saves the request and says when to follow up", await shows(page.getByRole("status").filter({ hasText: "Request saved - follow up" })));
  const requested = (await entry("Mock Old Forum")).lifecycle;
  check("requestedAt is today and the follow-up 30 days on", requested.state === "deletion-requested" && requested.requestedAt === localDay(0) && requested.followUpAt === localDay(30), JSON.stringify(requested));
  check("the detail shows the request", await shows(status.getByText(/^Asked to delete on/)));
  check("the tray says nothing is due yet", (await lastTip()) === "KAPEVault");

  // ---- Another account dormant, then back in use
  await rowOf("Mock Shop").click();
  await main.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Close this account..." }).click();
  await sheet.getByRole("button", { name: /I stopped using it/ }).click();
  await aside.getByRole("button", { name: /^Closing/ }).click();
  check("Closing lists every account on its way out", (await shows(rowOf("Mock Old Forum"))) && (await shows(rowOf("Mock Shop"))) && !(await rowOf("Mock Stream").isVisible()));
  check("no follow-up marker before the day", !(await page.getByText("Follow up due").first().isVisible()));
  await rowOf("Mock Shop").click();
  await status.getByRole("button", { name: "Back in use" }).click();
  check("Back in use takes it off the Closing list", await gone(rowOf("Mock Shop")));

  // ---- The follow-up day passes: the date is moved back in the vault file itself
  await lockedBy(app, page, () => page.evaluate(() => window.kapevault.lock()));
  const file = path.join(dataDir, "vault.kapevault");
  const plain = await openFile(MASTER, JSON.parse(fs.readFileSync(file, "utf8")));
  plain.data.entries.find((e) => e.title === "Mock Old Forum").lifecycle.followUpAt = localDay(-1);
  fs.writeFileSync(file, JSON.stringify(encryptWithKey(plain.key, plain.kdf, plain.salt, plain.data)));
  await page.getByPlaceholder("Master password").fill(MASTER);
  await page.keyboard.press("Enter");
  await aside.waitFor({ timeout: 15000 });
  await aside.getByRole("button", { name: /^Closing/ }).click();
  check("the Closing row marks the follow-up as due", await shows(rowOf("Mock Old Forum").getByText("Follow up due")));
  check("the Closing count turns into a capsule", await shows(aside.getByRole("button", { name: /^Closing/ }).locator(".bg-sys-red")));
  await rowOf("Mock Old Forum").click();
  check("the detail says the follow-up is due", await shows(status.getByText("Follow up due", { exact: true })));
  check("the tray tooltip gives a count, never the account", await waitFor(async () => (await lastTip()) === "KAPEVault - 1 account to follow up"));
  check("no tooltip ever named an account", !(await app.evaluate(() => globalThis.__tips.join("|"))).includes("Forum"));
  await shot("closing-list-due");
  await status.getByRole("button", { name: "I sent it again" }).click();
  check("I sent it again moves the follow-up a month on", await waitFor(async () => (await entry("Mock Old Forum")).lifecycle.followUpAt === localDay(30)));
  check("and the marker and the tray count clear", (await gone(rowOf("Mock Old Forum").getByText("Follow up due"))) && (await waitFor(async () => (await lastTip()) === "KAPEVault")));

  // ---- Confirm it's gone: secrets wiped, a tombstone in Closed
  await status.getByRole("button", { name: "Confirm it's gone" }).click();
  check("Confirm it's gone asks first and says what is wiped", await shows(sheet.getByText("wiped for good", { exact: false })));
  await sheet.getByRole("checkbox").check();
  await sheet.getByRole("button", { name: "Wipe secrets" }).click();
  check("it moves to Closed", await shows(page.getByRole("status").filter({ hasText: "Mock Old Forum moved to Closed" })));
  const tomb = await entry("Mock Old Forum");
  check("every secret is gone", !tomb.hasPassword && !tomb.hasTotp && tomb.history.length === 0 && tomb.questions.length === 0 && tomb.recoveryCodes === undefined, JSON.stringify(tomb));
  const leftovers = await page.evaluate(async (id) => {
    const b = window.kapevault;
    return [await b.getSecret(id, "password"), await b.getSecret(id, "answer", 0), await b.getSecret(id, "code", 0), await b.getSecret(id, "history", 0)].join("");
  }, tomb.id);
  check("main has nothing left to hand out", leftovers === "");
  check("the notes were cleared when ticked", tomb.notes === "");
  check("the tombstone keeps title, site, username and the date", tomb.username === "mock.forum@example.com" && tomb.url === "https://forum.example.com" && tomb.lifecycle.state === "gone" && tomb.lifecycle.goneAt === localDay(0) && tomb.lifecycle.requestedAt === localDay(0));
  check("the Closing list leaves with its last account", await gone(aside.getByRole("button", { name: /^Closing/ })));
  check("confirming shows it in Closed", (await shows(page.locator("section[aria-label='Items'] h2", { hasText: "Closed" }))) && (await shows(main.getByRole("button", { name: "Delete for good" }))));
  await aside.getByRole("button", { name: /^All items/ }).click();
  check("a tombstone is not in All items", (await gone(rowOf("Mock Old Forum"))) && (await shows(rowOf("Mock Stream"))));
  check("nor in the counts", (await aside.getByRole("button", { name: /^All items/ }).innerText()).includes("2"));
  await search.fill("forum");
  check("nor in search", await shows(page.getByText("No results")));
  await search.fill("");
  await aside.getByRole("button", { name: /^Closed/ }).click();
  check("Closed lists it with the day it closed", await shows(rowOf("Mock Old Forum").getByText(/^Closed /)));
  await rowOf("Mock Old Forum").click();
  check("the tombstone is read only: no Edit, no favorite", !(await main.getByRole("button", { name: "Edit" }).isVisible()) && !(await main.getByRole("button", { name: /favorites/ }).isVisible()));
  await page.keyboard.press("Control+e");
  check("Ctrl+E does not open the form on it", !(await page.getByRole("dialog").isVisible()));
  await page.keyboard.press("Control+d");
  check("Ctrl+D does not favorite it", !(await entry("Mock Old Forum")).favorite);
  await rowOf("Mock Old Forum").click({ button: "right" });
  check("its row menu only copies and opens", (await shows(page.getByRole("menuitem", { name: "Copy username" }))) && !(await page.getByRole("menuitem", { name: /Edit|Move to/ }).first().isVisible()));
  await page.keyboard.press("Escape");
  check("it shows the record and Delete for good", (await shows(main.getByText("mock.forum@example.com"))) && (await shows(main.getByRole("button", { name: "Delete for good" }))));
  check("a closed account raises no health issue", tomb.issues.length === 0);
  await shot("closed-tombstone");

  // ---- Delete for good
  await main.getByRole("button", { name: "Delete for good" }).click();
  await main.getByRole("button", { name: "Confirm delete for good" }).click();
  check("Delete for good removes it", await shows(page.getByRole("status").filter({ hasText: "Deleted for good" })));
  check("and the Closed list leaves with it", (await gone(aside.getByRole("button", { name: /^Closed/ }))) && (await entry("Mock Old Forum")) === undefined);

  check("no page errors", errors.length === 0, errors.join(" | "));
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = report() ? 0 : 1;
})().catch((e) => {
  report();
  console.log("CRASH:", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(1);
});
