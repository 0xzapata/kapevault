// End-to-end checks for Payee Check: the payee kind (form, provider logos, detail,
// Mark confirmed today) and the verdict card - MATCH / NEW NUMBER / NEAR-MISS / NOT A PAYEE - in
// main search and quick search. Part of npm run e2e. Throwaway vault, mock names only.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHarness, shows, gone, clip, waitFor } = require("./e2e-harness.cjs");

const SHOTS = path.join(os.tmpdir(), "kapevault-e2e-v2");
fs.mkdirSync(SHOTS, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-payee-"));
const { check, launch, report } = createHarness();
const MASTER = "mock kettle harbor pass";

(async () => {
  const { app, page, errors } = await launch({ KAPEVAULT_DATA_DIR: dataDir });
  const dialog = page.getByRole("dialog");
  const aside = page.locator("aside[aria-label='Vault navigation']");
  const search = aside.locator("[data-search]");
  const card = page.locator("[data-verdict]");
  // The page formats dates in its own locale, so ask it for today.
  const today = await page.evaluate(() => new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }));
  const loaded = (loc) => loc.evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false);

  await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
  await page.getByPlaceholder("Confirm master password").fill(MASTER);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Nothing here yet").waitFor({ timeout: 15000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));

  check("no Payees list before there is a payee", !(await aside.getByText("Payees").isVisible()));
  check("with no payees, a number in search shows no verdict", await search.fill("0999 888 7777").then(() => card.count()).then((n) => n === 0));
  await search.fill("");

  // ---- First payee: provider picked from the logo grid, number typed with +63
  await page.getByRole("button", { name: "New" }).click();
  await dialog.getByRole("button", { name: "Payee", exact: true }).click();
  check("the New menu offers Payee", await shows(dialog.getByText("Account or mobile number")));
  check("the provider grid is open on a new payee", await shows(dialog.getByRole("button", { name: "GCash", exact: true })));
  for (const name of ["GCash", "Maya", "BDO", "BPI", "Landbank", "Palawan Express", "Western Union"]) {
    check(`provider logo loads: ${name}`, await loaded(dialog.getByRole("button", { name, exact: true }).locator("img")));
  }
  check("the wallet picker opened by itself, so Who keeps the focus", await dialog.getByPlaceholder("Mama", { exact: true }).evaluate((i) => i === document.activeElement));
  const wallet = (name) => dialog.getByRole("button", { name, exact: true });
  check("the wallet tiles are one Tab stop", (await wallet("GCash").getAttribute("tabindex")) === "0" && (await wallet("Maya").getAttribute("tabindex")) === "-1");
  await wallet("GCash").focus();
  await page.keyboard.press("ArrowRight");
  check("arrows move between the wallet tiles without picking", (await wallet("Maya").evaluate((b) => b === document.activeElement)) && (await wallet("Maya").getAttribute("aria-pressed")) === "false");
  await dialog.getByPlaceholder("Mama", { exact: true }).fill("Mock Tita Rosa");
  await dialog.getByPlaceholder("Mother").fill("Tita");
  await dialog.getByRole("button", { name: "GCash", exact: true }).click();
  check("picking a provider closes the grid and shows it", await shows(dialog.getByRole("button", { name: /GCash\s*Change/ })));
  check("the title offers who + provider", await shows(dialog.getByPlaceholder("Mock Tita Rosa GCash")));
  const number = dialog.getByText("Account or mobile number").locator("..").locator("input");
  await number.fill("0917-CALL-ME");
  await dialog.getByRole("button", { name: "Save" }).click();
  check("a number with letters is refused", await shows(dialog.getByText("Account number must be 7 to 20 digits.")));
  await number.fill("+63 917 123 4567");
  await dialog.getByPlaceholder("As the app shows it").fill("MO** T*** R.");
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  check("an untitled payee is saved as who + provider", await shows(page.locator("h1", { hasText: "Mock Tita Rosa GCash" })));
  check("+63 number is saved as 09... and shown grouped", await shows(page.getByText("0917 123 4567", { exact: true })));
  check("the payee tile shows the GCash logo", await loaded(page.locator("main img[data-brand='gcash']")));
  check("a new payee says it is not confirmed yet", await shows(page.getByText("Not confirmed yet")));
  await page.getByRole("button", { name: "Copy number" }).first().click();
  check("Copy number copies the digits", await waitFor(async () => (await clip(app)) === "09171234567"));
  await page.getByRole("button", { name: "Mark confirmed today" }).click();
  check("Mark confirmed today dates the call", await shows(page.getByText(`Confirmed by call on ${today}`)));
  check("a toast confirms it", await shows(page.getByRole("status").filter({ hasText: "Marked confirmed today" })));
  check("the Payees list appears once there is a payee", await shows(aside.getByText("Payees")));
  await page.screenshot({ path: path.join(SHOTS, "payee-detail.png") });

  // ---- Second payee: provider found by search, Enter picks it
  await page.getByRole("button", { name: "New" }).click();
  await dialog.getByRole("button", { name: "Payee", exact: true }).click();
  await dialog.getByPlaceholder("Mama", { exact: true }).fill("Mock Tito Lito");
  await dialog.getByLabel("Search wallets and banks").press("Escape");
  await page.waitForTimeout(300); // a closing sheet would be gone by now
  check("Escape in the provider search closes only the picker", (await gone(dialog.getByLabel("Search wallets and banks"))) && (await dialog.isVisible()));
  check("and hands the focus back to its button", await dialog.getByRole("button", { name: /Choose one/ }).evaluate((b) => b === document.activeElement));
  await dialog.getByRole("button", { name: /Choose one/ }).click();
  check("opened by hand, the search takes the focus", await dialog.getByLabel("Search wallets and banks").evaluate((i) => i === document.activeElement));
  await dialog.getByLabel("Search wallets and banks").fill("bdo");
  await dialog.getByLabel("Search wallets and banks").press("Enter");
  check("Enter in the provider search picks the match", await shows(dialog.getByRole("button", { name: /BDO\s*Change/ })));
  check("Enter there did not save the form", await dialog.isVisible());
  await dialog.getByText("Account or mobile number").locator("..").locator("input").fill("0012 3456 7890");
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  check("second payee saved", await shows(page.locator("h1", { hasText: "Mock Tito Lito BDO" })));
  check("a bank logo on the payee tile", await loaded(page.locator("main img[data-brand='bdo']")));
  await aside.getByText("Payees").click();
  check("the Payees list holds both", (await page.locator("section li").count()) === 2);

  // ---- Main search: every verdict, above the results
  const verdict = async (query) => {
    await search.fill(query);
    return (await shows(card)) ? card.getAttribute("data-verdict") : null;
  };
  check("MATCH in main search", (await verdict("+63 917 123 4567")) === "match" && (await shows(card.getByText("Matches Mock Tita Rosa's GCash"))));
  check("MATCH shows the confirmed date", await shows(card.getByText(`Confirmed by call on ${today}`, { exact: false })));
  await search.fill("0917 123 4567");
  check("the matching item still lists below the card", await shows(page.locator("section li", { hasText: "Mock Tita Rosa GCash" })));
  check("MATCH on an unconfirmed payee says so", (await verdict("001234567890")) === "match" && (await shows(card.getByText("Not confirmed by call yet", { exact: false }))));
  check("NEW NUMBER in main search", (await verdict("Mock Tita Rosa 0999 888 7777")) === "new-number" && (await shows(card.getByText("New number for Mock Tita Rosa"))));
  check("NEW NUMBER masks the saved number", await shows(card.getByText("0917 ••• 4567", { exact: false })));
  check("NEAR-MISS in main search", (await verdict("0917 123 4576")) === "near-miss" && (await shows(card.getByText("two digits swapped", { exact: false }))));
  check("NEAR-MISS marks the differing digits", (await card.locator("mark").count()) === 4);
  await page.screenshot({ path: path.join(SHOTS, "payee-main-near-miss.png") });
  check("NOT A PAYEE in main search", (await verdict("0999 888 7777")) === "not-payee" && (await shows(card.getByText("Not one of your payees"))));
  await search.fill("0917 123 4576");
  await page.locator("button:has([data-verdict])").click();
  check("clicking the card opens the saved payee", await shows(page.locator("h1", { hasText: "Mock Tita Rosa GCash" })));
  check("short numbers get no card", (await verdict("0917")) === null);
  await search.fill("");

  // ---- Quick search: the card is the first option; Enter on it shows the payee
  const quickOpened = app.waitForEvent("window", { timeout: 8000 }).catch(() => null);
  await app.evaluate(() => globalThis.__kapevaultToggleQuick());
  const quick = (await quickOpened) ?? app.windows().find((w) => w.url().includes("#quick"));
  check("quick search window opens", !!quick);
  if (quick) {
    await quick.waitForLoadState("domcontentloaded");
    quick.on("pageerror", (e) => errors.push(`quick: ${e.message}`));
    const qInput = quick.getByRole("combobox");
    await shows(qInput, 8000);
    const qCard = quick.locator("[data-verdict]");
    const quickVerdict = async (query) => {
      await qInput.fill(query);
      return (await shows(qCard)) ? qCard.getAttribute("data-verdict") : null;
    };
    for (const [query, want, shot] of [
      ["0917 123 4567", "match", "match"],
      ["Mock Tita Rosa 0999 888 7777", "new-number", "new-number"],
      ["0917 123 4568", "near-miss", "near-miss"],
      ["0999 888 7777", "not-payee", "not-payee"],
    ]) {
      check(`quick search: ${want}`, (await quickVerdict(query)) === want);
      await quick.screenshot({ path: path.join(SHOTS, `payee-quick-${shot}.png`) });
    }
    check("quick NEAR-MISS says one digit differs", (await quickVerdict("0917 123 4568")) === "near-miss" && (await shows(qCard.getByText("1 digit differs", { exact: false }))));
    check("the card is the selected option", (await quick.locator("#quick-payee-check").getAttribute("aria-selected")) === "true");
    await quickVerdict("0917 123 4567");
    await quick.keyboard.press("ArrowDown");
    check("Down moves from the card to the matching row", (await quick.getByRole("option", { name: /Mock Tita Rosa GCash/ }).getAttribute("aria-selected")) === "true");
    await quick.keyboard.press("Enter");
    check("Enter on a payee row copies its number", await waitFor(async () => (await clip(app)) === "09171234567"));
    await waitFor(() => app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("#quick")).isVisible()));
    await app.evaluate(() => globalThis.__kapevaultToggleQuick());
    await quickVerdict("0012 3456 7899");
    await quick.keyboard.press("Enter");
    check("Enter on the card shows the payee in KAPEVault", await shows(page.locator("h1", { hasText: "Mock Tito Lito BDO" })));
    check("quick search hides after showing it", await waitFor(() => app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("#quick")).isVisible())));
  }

  // ---- A changed number starts unconfirmed again
  await aside.getByText("Payees").click();
  await page.locator("section li", { hasText: "Mock Tita Rosa GCash" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editNumber = dialog.getByText("Account or mobile number").locator("..").locator("input");
  await editNumber.fill("0917 123 9999");
  check("changing a confirmed number warns first", await shows(dialog.getByText("again to confirm it", { exact: false })));
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  check("after saving it is not confirmed any more", await shows(page.getByText("Not confirmed yet")));

  // ---- An untitled payee's title follows a new provider; deleting the last payee leaves the list
  await page.locator("section li", { hasText: "Mock Tito Lito BDO" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.getByRole("button", { name: /BDO\s*Change/ }).click();
  await dialog.getByRole("button", { name: "Maya", exact: true }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  check("an untitled payee's title follows the new provider", await shows(page.locator("h1", { hasText: "Mock Tito Lito Maya" })));
  for (const title of ["Mock Tito Lito Maya", "Mock Tita Rosa GCash"]) {
    await page.locator("section li", { hasText: title }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await dialog.getByRole("button", { name: "Delete" }).click();
    await dialog.getByRole("button", { name: "Confirm delete" }).click();
    await gone(dialog);
  }
  check("deleting the last payee leaves the Payees list for All items", (await shows(page.locator("h2", { hasText: "All items" }))) && !(await aside.getByText("Payees").isVisible()));

  check("no page errors", errors.length === 0, errors.join(" | "));
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = report() ? 0 : 1;
})().catch((e) => {
  report();
  console.log("CRASH:", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(1);
});
