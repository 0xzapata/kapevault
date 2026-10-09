// Trash + undo delete at phone size on the mock host, light and dark. Move to Trash from the edit sheet
// (no "are you sure"), the toast's Undo puts the item back; the drawer's Trash row counts what is in it;
// the Trash lists days left, Restore, a read-only page (no Edit, no copy, no open) with Restore and
// Delete now (asks once, in place), and Empty Trash (asks once). A trashed item is in no list and no
// search. Screenshots: trash-toast, trash-drawer, trash-list, trash-item, trash-empty (-light / -dark).
// Needs `npx vite --port 5199 --strictPort` (UI_PORT names another port).
const { chromium } = require("./browser.cjs");
const out = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const check = (name, ok) => results.push(`${ok ? "PASS" : "FAIL"}  ${name}`);

  for (const scheme of ["light", "dark"]) {
    const errors = [];
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`http://localhost:${process.env.UI_PORT || 5199}/?mock&nofingerprint`);
    if (scheme === "dark") await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    const pw = page.locator("input[type=password]").first();
    await pw.fill("demo");
    await pw.press("Enter");
    await page.getByRole("tab", { name: "Items" }).waitFor();
    const shot = (name) => page.waitForTimeout(400).then(() => page.screenshot({ path: `${out}/${name}-${scheme}.png` }));
    const row = (title) => page.locator("[data-entry]").filter({ hasText: title });
    const trashScreen = page.getByRole("region", { name: "Trash" });
    const toastText = (text) => page.getByRole("status").filter({ hasText: text });
    const seen = (locator) => locator.waitFor({ timeout: 3000 }).then(() => true, () => false);

    // Delete from the edit sheet: straight to the Trash, the toast offers Undo.
    const trashItem = async (title) => {
      await row(title).first().click();
      await page.getByRole("region", { name: "Item" }).getByRole("button", { name: "Edit" }).click();
      const edit = page.getByRole("dialog", { name: "Edit item" });
      await edit.getByRole("button", { name: "Move to Trash" }).click();
      await page.waitForTimeout(400);
    };
    const openTrash = async () => {
      await page.getByRole("button", { name: "Show sidebar" }).click();
      await page.getByRole("button", { name: /^Trash/ }).click();
      await page.waitForTimeout(450);
    };

    // ---- Move to Trash, then Undo
    check(`${scheme}: Slack is in the list`, (await row("Slack").count()) === 1);
    await trashItem("Slack");
    check(`${scheme}: Move to Trash needs no second tap: the toast says Moved to Trash`, await seen(toastText("Moved to Trash")));
    check(`${scheme}: the toast has an Undo button`, await page.getByRole("button", { name: "Undo" }).isVisible());
    check(`${scheme}: Slack left the list`, (await row("Slack").count()) === 0);
    await shot("trash-toast");
    await page.getByRole("button", { name: "Undo" }).click();
    await page.waitForTimeout(400);
    check(`${scheme}: Undo puts Slack back in the list`, (await row("Slack").count()) === 1);

    // ---- The drawer's Trash row, the Trash list
    await trashItem("Slack");
    await page.getByRole("button", { name: "Show sidebar" }).click();
    await page.waitForTimeout(450);
    const trashRow = page.getByRole("button", { name: /^Trash/ });
    check(`${scheme}: the drawer's Trash row counts 1`, (await trashRow.textContent()).replace(/\s/g, "") === "Trash1");
    await shot("trash-drawer");
    await trashRow.click();
    await page.waitForTimeout(450);
    check(`${scheme}: the Trash lists Slack with days left`, (await seen(trashScreen.getByText("Slack", { exact: true }))) && (await trashScreen.getByText(/30 days left/).count()) >= 1);
    await shot("trash-list");

    // ---- A trashed item is read only
    await trashScreen.getByText("Slack", { exact: true }).click();
    await page.waitForTimeout(350);
    check(`${scheme}: its page offers Restore and Delete now`, (await trashScreen.getByRole("button", { name: "Restore" }).isVisible()) && (await trashScreen.getByRole("button", { name: "Delete now" }).isVisible()));
    check(`${scheme}: its page has no Edit, no copy, no open`, (await trashScreen.getByRole("button", { name: /^Edit|Copy|Open/ }).count()) === 0);
    await shot("trash-item");
    await trashScreen.getByRole("button", { name: "Back to Trash" }).click();
    await page.waitForTimeout(300);
    check(`${scheme}: Back goes to the Trash list`, await trashScreen.getByRole("heading", { name: "Trash" }).isVisible());

    // ---- Restore from the list
    await trashScreen.getByRole("button", { name: "Restore Slack" }).click();
    check(`${scheme}: Restore says Restored and empties the Trash`, (await seen(toastText("Restored"))) && (await seen(trashScreen.getByText("Trash is empty"))));
    await shot("trash-empty");
    await trashScreen.getByRole("button", { name: "Back to list" }).click();
    await page.waitForTimeout(450);
    check(`${scheme}: Slack is back in the list`, (await row("Slack").count()) === 1);

    // ---- Delete now asks once, in place
    await trashItem("Slack");
    await openTrash();
    await trashScreen.getByText("Slack", { exact: true }).click();
    await page.waitForTimeout(350);
    await trashScreen.getByRole("button", { name: "Delete now" }).click();
    check(`${scheme}: Delete now asks first, in place`, (await trashScreen.getByRole("button", { name: "Confirm delete" }).isVisible()) && (await trashScreen.getByText("This cannot be undone.").isVisible()));
    await trashScreen.getByRole("button", { name: "Cancel" }).click();
    check(`${scheme}: Cancel keeps it`, await trashScreen.getByRole("button", { name: "Delete now" }).isVisible());
    await trashScreen.getByRole("button", { name: "Delete now" }).click();
    await trashScreen.getByRole("button", { name: "Confirm delete" }).click();
    check(`${scheme}: Confirm deletes it for good`, (await seen(toastText("Deleted for good"))) && (await seen(trashScreen.getByText("Trash is empty"))));
    await trashScreen.getByRole("button", { name: "Back to list" }).click();
    await page.waitForTimeout(450);

    // ---- Empty Trash asks once
    await trashItem("Notion");
    await trashItem("Figma");
    await openTrash();
    check(`${scheme}: two items in the Trash`, (await trashScreen.locator("[data-trashed]").count()) === 2);
    await trashScreen.getByRole("button", { name: "Back to list" }).click();
    await page.waitForTimeout(450);
    check(`${scheme}: trashed items are in no list and no search`, (await row("Notion").count()) === 0 && (await row("Figma").count()) === 0);
    await page.getByRole("searchbox").fill("Figma");
    await page.waitForTimeout(300);
    check(`${scheme}: a search does not find a trashed item`, (await row("Figma").count()) === 0);
    await page.getByRole("searchbox").fill("");
    await openTrash();
    await trashScreen.getByRole("button", { name: "Empty Trash" }).click();
    check(`${scheme}: Empty Trash asks first, in place`, (await trashScreen.getByText("Delete all 2 items for good?").isVisible()) && (await trashScreen.getByRole("button", { name: "Confirm empty" }).isVisible()));
    await trashScreen.getByRole("button", { name: "Confirm empty" }).click();
    check(`${scheme}: Confirm empties the Trash`, (await seen(toastText("Trash emptied"))) && (await seen(trashScreen.getByText("Trash is empty"))));

    // ---- Android's back gesture leaves the Trash
    await page.goBack();
    await page.waitForTimeout(450);
    check(`${scheme}: the back gesture closes the Trash`, (await page.locator("section[aria-label='Trash'][data-open]").count()) === 0);

    if (errors.length) console.log(errors);
    check(`${scheme}: no page errors`, errors.length === 0);
    await page.close();
  }
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.every((r) => r.startsWith("PASS")) ? 0 : 1);
})();
