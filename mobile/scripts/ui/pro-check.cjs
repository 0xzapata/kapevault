// KAPEVault Pro at phone size on the mock host, light and dark. Without Pro: the sync line and the Sync
// sheet say backup only, + on Clients opens the Pro sheet (a sideways swipe on it leaves the drawer open),
// the Space field greys the client folders and its See Pro opens the Pro sheet; then
// Buy turns Pro on and sync comes back. Without Pro: New in a client folder, editing a client's item,
// Settings' Back up now, Restore purchase with nothing bought. Google Play missing, a pending payment and
// a closed Play sheet. Free users see a PRO tag on Clients and on the Settings Pro row.
// Screenshots: pro-sync-free, pro-drawer-free, pro-space-free, pro-sheet, pro-bought, pro-edit-free,
// pro-settings-free, pro-unavailable, pro-pending (-light / -dark). Needs `npx vite --port 5199 --strictPort` (UI_PORT names another port).
const { chromium } = require("./browser.cjs");
const out = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const check = (name, ok) => results.push(`${ok ? "PASS" : "FAIL"}  ${name}`);

  for (const scheme of ["light", "dark"]) {
    const errors = [];
    const open = async (query) => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await page.goto(`http://localhost:${process.env.UI_PORT || 5199}/?mock&nofingerprint&${query}`);
      if (scheme === "dark") await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
      const pw = page.locator("input[type=password]").first();
      await pw.fill("demo");
      await pw.press("Enter");
      await page.getByRole("tab", { name: "Items" }).waitFor();
      return page;
    };
    const shot = (page, name) => page.waitForTimeout(400).then(() => page.screenshot({ path: `${out}/${name}-${scheme}.png` }));
    const proSheet = (page) => page.getByRole("dialog", { name: "KAPEVault Pro" });
    const settingsPro = async (page) => {
      await page.getByRole("tab", { name: "Settings" }).click();
      const row = page.getByRole("button", { name: /^KAPEVault Pro/ });
      await row.scrollIntoViewIfNeeded();
      await row.click();
      await proSheet(page).waitFor();
    };

    // ---- Without Pro
    let page = await open("free");
    const line = page.getByRole("button", { name: /Backed up|Backs up to your bucket/ });
    check(`${scheme}: the sync line says backup, not sync`, await line.isVisible());
    await line.click();
    const sync = page.getByRole("dialog", { name: "Sync" });
    check(`${scheme}: the Sync sheet says syncing is Pro's, and offers Back up now`, (await sync.getByText("Syncing with your PC is part of Pro.").isVisible()) && (await sync.getByRole("button", { name: "Back up now" }).isVisible()));
    check(`${scheme}: the Sync sheet lists only this phone, no check code`, (await sync.getByText("This phone", { exact: true }).isVisible()) && (await sync.getByText("DESKTOP-4F2A").count()) === 0 && (await sync.getByText("Check code").count()) === 0);
    await shot(page, "pro-sync-free");
    await sync.getByRole("button", { name: "Back up now" }).click();
    check(`${scheme}: Back up now says Backed up`, await page.getByText("Backed up", { exact: true }).waitFor({ timeout: 3000 }).then(() => true, () => false));
    await sync.getByRole("button", { name: "See Pro" }).click();
    await proSheet(page).waitFor();
    check(`${scheme}: See Pro opens the Pro sheet with Play's price`, await proSheet(page).getByRole("button", { name: "Buy for US$9.99" }).waitFor({ timeout: 3000 }).then(() => true, () => false));
    check(`${scheme}: the Pro sheet names what stays free`, await proSheet(page).getByText("Everything else stays free: backup, restore, autofill, fingerprint.").isVisible());
    await shot(page, "pro-sheet");
    await proSheet(page).getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(300);
    await sync.getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: "Show sidebar" }).click();
    const clients = page.locator("aside[aria-label='Vault navigation']").locator("p", { hasText: /^Clients/ });
    await clients.scrollIntoViewIfNeeded();
    check(`${scheme}: free: Clients carries the PRO tag`, (await clients.textContent()).includes("PRO"));
    await shot(page, "pro-drawer-free");
    await page.getByRole("button", { name: "Add client" }).click();
    check(`${scheme}: + on Clients opens the Pro sheet, no name field`, (await proSheet(page).waitFor({ timeout: 3000 }).then(() => true, () => false)) && (await page.getByPlaceholder("Client name, then Enter").count()) === 0);
    await page.waitForTimeout(400); // the sheet settles in
    const box = await proSheet(page).getByText("Everything else stays free", { exact: false }).boundingBox();
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 10, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const drawerOpen = (await page.locator("aside[aria-label='Vault navigation'][data-open]").count()) === 1;
    check(`${scheme}: a sideways swipe on that Pro sheet leaves it and the drawer open`, (await proSheet(page).isVisible()) && drawerOpen);
    await proSheet(page).getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(300);
    if (drawerOpen) await page.mouse.click(370, 400); // the drawer's scrim
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "New", exact: true }).click();
    const item = page.getByRole("dialog", { name: "New item" });
    const space = item.getByLabel("Space");
    const options = await space.locator("option").evaluateAll((o) => o.map((e) => [e.textContent, e.disabled]));
    check(`${scheme}: a new item defaults to Personal, the client folders greyed`, (await space.inputValue()) === "sp-personal" && options.every(([name, disabled]) => disabled === (name !== "Personal")));
    check(`${scheme}: the Space field says client folders are Pro's`, await item.getByText(/Client folders are part of Pro/).isVisible());
    await item.getByText(/Client folders are part of Pro/).scrollIntoViewIfNeeded();
    await shot(page, "pro-space-free");
    await item.getByRole("button", { name: "See Pro" }).click();
    check(`${scheme}: the Space field's See Pro opens the Pro sheet`, await proSheet(page).waitFor({ timeout: 3000 }).then(() => true, () => false));
    await proSheet(page).getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);

    // ---- Buy
    await settingsPro(page);
    await proSheet(page).getByRole("button", { name: "Buy for US$9.99" }).click();
    check(`${scheme}: Buy turns Pro on`, await page.getByText("KAPEVault Pro is on").waitFor({ timeout: 4000 }).then(() => true, () => false));
    await page.waitForTimeout(400);
    check(`${scheme}: Settings says On`, await page.getByRole("button", { name: /KAPEVault Pro\s*On$/ }).isVisible());
    await page.getByRole("button", { name: /KAPEVault Pro\s*On$/ }).click();
    check(`${scheme}: the Pro sheet says it is on, no Buy`, (await proSheet(page).getByText("Pro is on for this phone").waitFor({ timeout: 3000 }).then(() => true, () => false)) && (await proSheet(page).getByRole("button", { name: /^Buy/ }).count()) === 0);
    await shot(page, "pro-bought");
    await proSheet(page).getByRole("button", { name: "Done" }).click();
    await page.getByRole("tab", { name: "Items" }).click();
    check(`${scheme}: bought: the sync line says Synced`, await page.getByRole("button", { name: /Synced with DESKTOP-4F2A/ }).waitFor({ timeout: 3000 }).then(() => true, () => false));
    await page.getByRole("button", { name: "New", exact: true }).click();
    check(`${scheme}: bought: every client folder can be picked`, (await page.getByRole("dialog", { name: "New item" }).getByLabel("Space").locator("option").evaluateAll((o) => o.every((e) => !e.disabled))) && (await page.getByText(/Client folders are part of Pro/).count()) === 0);
    await page.close();

    // ---- Without Pro: New inside a client folder, then an item already in one
    page = await open("free");
    await page.getByRole("button", { name: "Show sidebar" }).click();
    await page.getByRole("button", { name: /Harbor & Pine/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "New", exact: true }).click();
    check(`${scheme}: New inside a client folder goes to Personal`, (await page.getByRole("dialog", { name: "New item" }).getByLabel("Space").inputValue()) === "sp-personal");
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);
    await page.getByText("Slack", { exact: true }).first().click();
    await page.getByRole("region", { name: "Item" }).getByRole("button", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: "Edit item" });
    const editOptions = await edit.getByLabel("Space").locator("option").evaluateAll((o) => o.map((e) => [e.value, e.disabled]));
    check(`${scheme}: editing a client's item: its own folder and Personal open, the other clients greyed`, (await edit.getByLabel("Space").inputValue()) === "sp-hp" && editOptions.every(([id, disabled]) => disabled === !["sp-personal", "sp-hp"].includes(id)));
    await edit.getByLabel("Space").scrollIntoViewIfNeeded();
    await shot(page, "pro-edit-free");
    await edit.getByRole("button", { name: "Save" }).click();
    check(`${scheme}: editing a client's item: Save works`, await page.getByText("Saved", { exact: true }).waitFor({ timeout: 3000 }).then(() => true, () => false));
    await page.close();

    // ---- Without Pro: Settings backs up, and Restore purchase finds nothing to restore
    page = await open("free");
    await page.getByRole("tab", { name: "Settings" }).click();
    const backup = page.getByRole("button", { name: /^Back up now/ });
    await backup.scrollIntoViewIfNeeded();
    check(`${scheme}: Settings says Back up now, with this phone's own backup time`, /^Back up now\s*2 min ago$/.test(await backup.textContent()) && (await page.getByRole("button", { name: /^Sync now/ }).count()) === 0);
    const proRow = page.getByRole("button", { name: /^KAPEVault Pro/ });
    await proRow.scrollIntoViewIfNeeded();
    check(`${scheme}: free: the Settings Pro row carries the PRO tag`, (await proRow.textContent()).trim().endsWith("PRO"));
    await shot(page, "pro-settings-free");
    await backup.click();
    check(`${scheme}: Settings' Back up now says Backed up`, await page.getByText("Backed up", { exact: true }).waitFor({ timeout: 3000 }).then(() => true, () => false));
    await page.getByRole("button", { name: /^KAPEVault Pro/ }).click();
    await proSheet(page).getByRole("button", { name: "Buy for US$9.99" }).waitFor();
    await proSheet(page).getByRole("button", { name: "Restore purchase" }).click();
    check(`${scheme}: Restore purchase, not bought: says so, Pro stays off`, (await page.getByText("This Google account has not bought KAPEVault Pro").waitFor({ timeout: 3000 }).then(() => true, () => false)) && (await proSheet(page).getByRole("button", { name: "Buy for US$9.99" }).isVisible()));
    await page.close();

    // ---- Restore purchase, bought on this Google account (a reinstall): the sheet asks Play on open
    page = await open("free&store=owned");
    await settingsPro(page);
    check(`${scheme}: bought on this account: opening the Pro sheet turns Pro on`, (await proSheet(page).getByText("Pro is on for this phone").waitFor({ timeout: 3000 }).then(() => true, () => false)) && (await proSheet(page).getByRole("button", { name: "Restore purchase" }).count()) === 0);
    await proSheet(page).getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(300);
    check(`${scheme}: bought on this account: Settings says On`, await page.getByRole("button", { name: /KAPEVault Pro\s*On$/ }).isVisible());
    await page.close();

    // ---- No Google Play
    page = await open("free&store=unavailable");
    await settingsPro(page);
    check(`${scheme}: no Google Play: said plainly`, await proSheet(page).getByRole("alert").filter({ hasText: "Google Play is not on this phone" }).waitFor({ timeout: 3000 }).then(() => true, () => false));
    await shot(page, "pro-unavailable");
    await page.close();

    // ---- A pending payment
    page = await open("free&store=pending");
    await settingsPro(page);
    await proSheet(page).getByRole("button", { name: "Buy for US$9.99" }).click();
    check(`${scheme}: pending: said, and Buy waits`, (await proSheet(page).getByText("Your payment is pending.", { exact: false }).waitFor({ timeout: 3000 }).then(() => true, () => false)) && (await proSheet(page).getByRole("button", { name: /^Buy/ }).isDisabled()));
    await shot(page, "pro-pending");
    await proSheet(page).getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(300);
    check(`${scheme}: pending: Settings says Pending`, await page.getByRole("button", { name: /KAPEVault Pro\s*Pending$/ }).isVisible());
    await page.close();

    // ---- The Play sheet closed
    page = await open("free&store=cancel");
    await settingsPro(page);
    await proSheet(page).getByRole("button", { name: "Buy for US$9.99" }).click();
    await page.waitForTimeout(1500);
    check(`${scheme}: closing Play's sheet says nothing and changes nothing`, (await proSheet(page).isVisible()) && (await proSheet(page).getByRole("alert").count()) === 0 && (await proSheet(page).getByRole("button", { name: "Buy for US$9.99" }).isEnabled()));
    await page.close();

    if (errors.length) console.log(errors);
    check(`${scheme}: no page errors`, errors.length === 0);
  }
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.every((r) => r.startsWith("PASS")) ? 0 : 1);
})();
