// End-to-end checks for the Recovery Code Ledger: add codes from a pasted block
// (preview first), reveal the grid, tick one used, copy one, paper copies, the Security issue with
// its Replace action, and a new set flagging the old printout. Part of npm run e2e. Throwaway vault,
// mock names only, made-up codes. Page screenshots (light + dark) in %TEMP%\kapevault-e2e-v2.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHarness, shows, gone, clip, waitFor } = require("./e2e-harness.cjs");

const SHOTS = path.join(os.tmpdir(), "kapevault-e2e-v2");
fs.mkdirSync(SHOTS, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-codes-"));
const { check, launch, report } = createHarness();
const MASTER = "mock kettle harbor pass";
const GOOGLE = ["1234 5678", "2345 6789", "3456 7890", "4567 8901", "5678 9012", "6789 0123", "7890 1234", "8901 2345", "9012 3456", "0123 4567"];
const GOOGLE_BLOCK = ["SAVE YOUR BACKUP CODES", "mock.user@example.com", "", ...GOOGLE.map((c, i) => `${i + 1}. ${c}`), "", "* You can only use each backup code once."].join("\n");
const GITHUB = ["a1b2c-3d4e5", "f6a7b-8c9d0", "0e1f2-a3b4c", "5d6e7-f8a9b"];

(async () => {
  const { app, page, errors } = await launch({ KAPEVAULT_DATA_DIR: dataDir });
  const aside = page.locator("aside[aria-label='Vault navigation']");
  const card = page.locator("section[aria-label='Backup codes']");
  const grid = card.getByRole("list", { name: "Codes" });
  const summary = card.locator("p").nth(1);
  const theme = (t) => page.evaluate((name) => window.kapevault.setSettings({ theme: name }), t).then(() => page.waitForTimeout(400));
  const shot = async (name) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    await theme("dark");
    await page.screenshot({ path: path.join(SHOTS, `${name}-dark.png`) });
    await theme("classic");
  };
  const codesInPage = async (list) => {
    const html = await page.content();
    return list.filter((c) => html.includes(c));
  };

  await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
  await page.getByPlaceholder("Confirm master password").fill(MASTER);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Nothing here yet").waitFor({ timeout: 15000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.evaluate(async () => {
    const b = window.kapevault;
    const spaceId = (await b.view()).spaces[0].id;
    const base = { spaceId, tags: [], favorite: false, notes: "" };
    await b.saveEntry({ ...base, kind: "login", title: "Mock Mail", username: "mock.user@example.com", password: "Mock-Mail-Pass-72!x", url: "https://mail.example.com" });
    await b.saveEntry({ ...base, kind: "note", title: "Mock note" });
  });
  await page.locator("section li", { hasText: "Mock Mail" }).click();

  // ---- Add codes: paste a real-looking block, see what was found, then save
  check("a login shows a Backup codes card", await shows(card.getByText("None saved", { exact: false })));
  await page.locator("section li", { hasText: "Mock note" }).click();
  check("other kinds have no Backup codes card", !(await card.isVisible()));
  await page.locator("section li", { hasText: "Mock Mail" }).click();
  await card.getByRole("button", { name: "Add codes" }).click();
  const paste = card.getByRole("textbox", { name: "Paste backup codes" });
  await paste.fill(GOOGLE.slice(0, 3).join("\n"));
  check("too few codes: a plain reason, Save is off", (await shows(card.getByText("Found 3. A set has at least 4 codes", { exact: false }))) && (await card.getByRole("button", { name: "Save codes" }).isDisabled()));
  await paste.fill(GOOGLE_BLOCK);
  check("the preview lists every code found, headings left out", (await card.getByRole("list", { name: "Codes found" }).locator("li").count()) === 10 && (await shows(card.getByText("10 codes found.", { exact: false }))));
  await shot("codes-paste");
  await card.getByRole("button", { name: "Save 10 codes" }).click();
  check("saved: 10 of 10 left", await waitFor(async () => (await summary.innerText()).startsWith("10 of 10 left")));
  check("no code is in the page before Show codes", (await codesInPage(GOOGLE)).length === 0);
  check("the page view carries counts only", await page.evaluate(async (codes) => {
    const text = JSON.stringify(await window.kapevault.view());
    return codes.every((c) => !text.includes(c)) && text.includes('"total":10') && text.includes('"left":10');
  }, GOOGLE));

  // ---- Reveal (one fetch), tick one used, copy one
  await card.getByRole("button", { name: "Show codes" }).click();
  check("Show codes reveals the whole grid", (await shows(grid)) && (await grid.locator("li").count()) === 10 && (await codesInPage(GOOGLE)).length === 10);
  await card.getByRole("button", { name: "Mark code 1 used" }).click();
  check("ticking a code strikes it through", await waitFor(async () => (await card.getByRole("button", { name: "Mark code 1 unused" }).getAttribute("aria-pressed")) === "true"));
  check("and counts it: 9 of 10 left", await waitFor(async () => (await summary.innerText()).startsWith("9 of 10 left")));
  check("the used code is drawn struck through", await grid.locator("li").first().locator(".line-through").isVisible());
  await card.getByRole("button", { name: "Copy code 2 (clears in 30s)" }).click();
  check("copying one code puts only that code on the clipboard", await waitFor(async () => (await clip(app)) === GOOGLE[1]));
  check("a toast says it clears", await shows(page.getByRole("status").filter({ hasText: "Code copied - clears in 30s" })));
  await shot("codes-revealed");
  await card.getByRole("button", { name: "Hide codes" }).click();
  check("Hide codes takes them out of the page", (await gone(grid)) && (await codesInPage(GOOGLE)).length === 0);

  // ---- A paper copy
  await card.getByRole("button", { name: "Add printed copy" }).click();
  await card.getByPlaceholder("Desk drawer").fill("the desk drawer");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  check("Add printed copy records where it is", await shows(card.getByText("Printed copy in the desk drawer", { exact: true })));

  // ---- Running low: the Security issue and its fix
  await page.evaluate(async () => {
    const b = window.kapevault;
    const id = (await b.view()).entries.find((e) => e.title === "Mock Mail").id;
    for (let i = 1; i < 8; i++) await b.markRecoveryCode(id, i, true);
  });
  check("2 left raises a health issue", await shows(page.getByRole("region", { name: "Security issue" }).getByText("Only 2 backup codes left")));
  check("the Security list counts it", (await aside.getByRole("button", { name: /Security/ }).innerText()).includes("1"));
  await aside.getByRole("button", { name: /Security/ }).click();
  check("the Security view names it", (await shows(page.getByText("low on backup codes", { exact: false }))) && (await shows(page.locator("section li", { hasText: "Only 2 backup codes left" }))));
  await page.locator("section li", { hasText: "Mock Mail" }).click();
  await shot("codes-issue");
  await page.getByRole("button", { name: "Make new codes on website" }).click();
  check("Make new codes opens the site", await waitFor(async () => (await app.evaluate(() => globalThis.__opened)).some(([k, u]) => k === "external" && u === "https://mail.example.com/")));
  await page.getByRole("region", { name: "Security issue" }).getByRole("button", { name: "Replace codes" }).click();
  check("Replace codes opens the paste box", await shows(card.getByRole("textbox", { name: "Paste backup codes" })));
  check("it warns what replacing does", await shows(card.getByText("This replaces the 10 saved codes - printed copies go out of date.")));
  await card.getByRole("textbox", { name: "Paste backup codes" }).fill(["GitHub recovery codes", "", ...GITHUB, "", "Put these in a safe spot."].join("\n"));
  await card.getByRole("button", { name: "Save 4 codes" }).click();
  check("the new set replaces the old one", await waitFor(async () => (await summary.innerText()).startsWith("4 of 4 left")));
  check("the old paper copy is flagged", await shows(card.getByText("Printed copy in the desk drawer is out of date - shred it")));
  check("4 fresh codes: the issue is gone", (await gone(page.getByRole("region", { name: "Security issue" }))) && !(await aside.getByRole("button", { name: /Security/ }).innerText()).includes("1"));
  await shot("codes-outdated-paper");
  await card.getByRole("button", { name: "Show codes" }).click();
  check("the grid shows the new codes only", await waitFor(async () => (await codesInPage(GITHUB)).length === 4));
  check("and none of the old", (await codesInPage(GOOGLE)).length === 0, JSON.stringify(await codesInPage(GOOGLE)));
  await card.getByRole("button", { name: "Shredded" }).click();
  check("Shredded removes the out-of-date copy", await gone(card.getByText("is out of date", { exact: false })));

  // ---- Removing a printed copy: a double click removes that one, never the next one up
  await page.evaluate(async () => {
    const b = window.kapevault;
    const id = (await b.view()).entries.find((e) => e.title === "Mock Mail").id;
    await b.addPaperCopy(id, "the safe", "");
    await b.addPaperCopy(id, "the go bag", "");
  });
  await card.getByRole("button", { name: "Remove the printed copy in the safe" }).dblclick();
  check("the list says printed copies, not paper", await shows(card.getByRole("list", { name: "Printed copies" })));
  check("a double-clicked remove takes only its own copy", (await gone(card.getByText("Printed copy in the safe", { exact: true }))) && (await shows(card.getByText("Printed copy in the go bag", { exact: true }))));

  check("no page errors", errors.length === 0, errors.join(" | "));
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = report() ? 0 : 1;
})().catch((e) => {
  report();
  console.log("CRASH:", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(1);
});
