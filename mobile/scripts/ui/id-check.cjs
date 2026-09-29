// The ID kind at phone size on the mock host, light and dark: the kind tile, the form (the list, Other,
// the masked number, a photo picked through the file input and shown as a blob: image, large in its own
// sheet), then the saved ID's detail (number masked until Reveal, the photo hidden until Show photo).
// Screenshots: id-form, id-photo, id-detail (-light / -dark). Needs `npx vite --port 5199 --strictPort`
// (UI_PORT names another port, for a second checkout serving at the same time).
const path = require("path");
const { chromium } = require("./browser.cjs");
const { renderIdCard } = require("../../../scripts/mock-sticker.cjs");
const out = process.argv[2];

(async () => {
  const card = await renderIdCard(path.join(out, "mock-id.png"));
  const browser = await chromium.launch();
  const results = [];
  const check = (name, ok) => results.push(`${ok ? "PASS" : "FAIL"}  ${name}`);

  for (const scheme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`http://localhost:${process.env.UI_PORT || 5199}/?mock&nofingerprint`);
    if (scheme === "dark") await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    const pw = page.locator("input[type=password]").first();
    await pw.fill("demo");
    await pw.press("Enter");
    await page.getByRole("tab", { name: "Items" }).waitFor();
    const sheet = page.getByRole("dialog", { name: "New item" });
    const shot = (name, target = page) => target.screenshot({ path: `${out}/${name}-${scheme}.png` });

    // ---- The form
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.waitForTimeout(400);
    const tiles = sheet.getByRole("group", { name: "Kind of item" }).getByRole("button");
    await tiles.filter({ hasText: /^ID$/ }).click();
    await page.waitForTimeout(300);
    check(`${scheme}: 8 kind tiles, every name whole`, (await tiles.count()) === 8 && (await tiles.locator("span.truncate").evaluateAll((s) => s.every((e) => e.scrollWidth <= e.clientWidth))));
    const select = sheet.locator("select").first();
    check(`${scheme}: the ID list starts empty, Passport first, Other last`, (await select.inputValue()) === "" && (await select.locator("option").evaluateAll((o) => o[1].textContent === "Passport" && o[o.length - 1].textContent === "Other")));
    await page.getByRole("button", { name: "Save" }).click();
    check(`${scheme}: nothing picked says so`, await sheet.getByText("Pick which ID it is.").isVisible());
    await select.selectOption("Other");
    const which = sheet.getByLabel("Which ID");
    check(`${scheme}: Other asks which ID`, await which.isVisible());
    await select.selectOption("Passport");
    check(`${scheme}: picking from the list again hides it`, !(await which.isVisible()));
    const number = sheet.getByRole("textbox", { name: /^ID number/ });
    await number.fill("P1234567A");
    check(`${scheme}: the number is masked`, (await number.getAttribute("type")) === "password");
    check(`${scheme}: the title follows the ID`, (await sheet.getByLabel("Title (optional)").getAttribute("placeholder")) === "Passport");
    await sheet.locator("input[type=file][aria-label='ID photo']").setInputFiles(card);
    const thumb = sheet.getByRole("button", { name: "Show the ID photo larger" });
    await thumb.waitFor();
    check(`${scheme}: the picked photo shows as a blob: image`, await thumb.locator("img").evaluate((img) => img.src.startsWith("blob:") && img.complete && img.naturalWidth > 0));
    await page.waitForTimeout(300);
    await shot("id-form");
    await thumb.click();
    const large = page.getByRole("dialog", { name: "ID photo" });
    await large.waitFor();
    await page.waitForTimeout(400);
    await shot("id-photo");
    await large.getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(600);

    // ---- The detail
    const item = page.getByRole("region", { name: "Item" });
    if (!(await item.getByRole("heading", { name: "Passport" }).isVisible())) {
      await page.getByRole("tab", { name: "Items" }).click();
      await page.getByText("Passport", { exact: true }).first().click();
      await page.waitForTimeout(500);
    }
    check(`${scheme}: the detail says ID and masks the number`, (await item.getByText("ID ·").isVisible()) && !(await item.getByText("P1234567A").count()));
    await item.getByRole("button", { name: "Reveal ID number" }).click();
    check(`${scheme}: Reveal shows the number`, await item.getByText("P1234567A").isVisible());
    check(`${scheme}: the dock copies the ID number`, await item.getByRole("button", { name: "Copy ID number" }).first().isVisible());
    check(`${scheme}: the photo waits for Show photo`, (await item.getByRole("button", { name: "Show photo" }).isVisible()) && !(await item.locator("img[alt='ID photo']").count()));
    await item.getByRole("button", { name: "Show photo" }).click();
    const photo = item.locator("img[alt='ID photo']");
    await photo.waitFor();
    check(`${scheme}: Show photo draws it as a blob: image`, await photo.evaluate((img) => img.src.startsWith("blob:") && img.complete && img.naturalWidth > 0));
    await item.locator(".overflow-y-auto").first().evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(300);
    await shot("id-detail");
    // The detail stays mounted under the edit sheet: a photo shown before an edit is hidden after it.
    await item.getByRole("button", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: "Edit item" });
    await edit.locator("input[type=file][aria-label='ID photo']").setInputFiles(card);
    await edit.getByRole("button", { name: "Show the ID photo larger" }).waitFor();
    await edit.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(600);
    check(`${scheme}: after an edit the photo waits for Show photo again`, (await item.getByRole("button", { name: "Show photo" }).isVisible()) && !(await item.locator("img[alt='ID photo']").count()));
    check(`${scheme}: no page errors`, errors.length === 0);
    if (errors.length) console.log(errors.join("\n"));
    await page.close();
  }
  await browser.close();
  console.log(results.join("\n"));
  console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
  process.exitCode = results.every((r) => r.startsWith("PASS")) ? 0 : 1;
})();
