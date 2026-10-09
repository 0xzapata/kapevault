// End-to-end checks for the ID kind: an ID from the list and
// an Other one typed by hand, the number (masked in the form, Reveal / Copy in the detail, cleared from
// the clipboard after 30 s, never in the page's data or search), the photo (add, large, hidden until
// Show photo, remove, never copied), edit, search, quick search, the IDs list, then the Forever Opener
// in Playwright's Chromium from file:// with the number and photo masked. Part of npm run e2e.
// Throwaway vault, mock names only. Page screenshots (light + dark) in %TEMP%\kapevault-e2e-v2.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("./playwright.cjs");
const { createHarness, shows, gone, clip, waitFor } = require("./e2e-harness.cjs");
const { renderIdCard } = require("./mock-sticker.cjs");
const { openerHtml } = require("../electron/opener.cjs");
const { version } = require("../package.json");

const SHOTS = path.join(os.tmpdir(), "kapevault-e2e-v2");
fs.mkdirSync(SHOTS, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-id-"));
const { check, launch, report } = createHarness();
const MASTER = "mock kettle harbor pass orbit gazelle";
const NUMBER = "P1234567A"; // the number printed on the mock card
const OTHER_NUMBER = "MOCK-BRGY-0042";

(async () => {
  const cardFile = await renderIdCard(path.join(dataDir, "mock-id.png"));
  const { app, page, errors } = await launch({ KAPEVAULT_DATA_DIR: dataDir });
  const dialog = page.getByRole("dialog", { name: /item/ });
  const aside = page.locator("aside[aria-label='Vault navigation']");
  const main = page.locator("main");
  const search = page.locator("[data-search]:visible").first();
  const rows = page.locator("section[aria-label='Items'] li[class='group']");
  const typeSelect = dialog.locator("select").first(); // the ID list comes before Space
  const numberInput = dialog.getByLabel("ID number", { exact: true });
  const titleInput = dialog.getByLabel("Title (optional)");
  const view = () => page.evaluate(() => window.kapevault.view());
  const ids = async () => (await view()).entries.filter((e) => e.kind === "id");
  const byTitle = async (t) => (await ids()).find((e) => e.title === t);
  const theme = (t) => page.evaluate((name) => window.kapevault.setSettings({ theme: name }), t).then(() => page.waitForTimeout(400));
  const shot = async (name) => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    await theme("dark");
    await page.screenshot({ path: path.join(SHOTS, `${name}-dark.png`) });
    await theme("classic");
  };
  const newId = async () => {
    await page.getByRole("button", { name: "New" }).click();
    await dialog.getByRole("group", { name: "Kind of item" }).getByRole("button", { name: "ID", exact: true }).click();
  };
  const pickPhoto = async (button) => {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }), button.click()]);
    await chooser.setFiles(cardFile);
  };

  await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
  await page.getByPlaceholder("Confirm master password").fill(MASTER);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Nothing here yet").waitFor({ timeout: 15000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  check("no IDs list before there is an ID", !(await aside.getByText("IDs", { exact: true }).isVisible()));

  // ---- The form: which ID, its number, a photo, then the title
  await newId();
  check("the kind picker offers ID, and the ID list takes the focus", (await shows(typeSelect)) && (await typeSelect.evaluate((s) => s === document.activeElement)));
  check("the list starts with the Philippine IDs and ends with Other", await typeSelect.locator("option").evaluateAll((o) => o[1].textContent === "Passport" && o[3].textContent === "National ID (PhilSys)" && o[o.length - 1].textContent === "Other" && o.length === 17));
  check("an ID has no logo picker", !(await dialog.getByText("Logo", { exact: true }).isVisible()));
  check("the photo is optional: one Add a photo button", await shows(dialog.getByRole("button", { name: /Add a photo/ })));
  await dialog.getByRole("button", { name: "Save" }).click();
  check("saving with no ID picked says so", await shows(dialog.getByText("Pick which ID it is.")));
  await typeSelect.selectOption("Passport");
  check("the title follows the ID until one is typed", (await titleInput.getAttribute("placeholder")) === "Passport");
  await numberInput.fill(NUMBER);
  check("the number is masked while typed", (await numberInput.getAttribute("type")) === "password");
  await dialog.getByRole("button", { name: "Show ID number" }).click();
  check("Show turns it to text", (await numberInput.getAttribute("type")) === "text");
  await pickPhoto(dialog.getByRole("button", { name: /Add a photo/ }));
  const formThumb = dialog.getByRole("button", { name: "Show the ID photo larger" });
  check("the picked photo shows as a thumbnail", (await shows(formThumb.locator("img"))) && (await formThumb.locator("img").evaluate((img) => img.naturalWidth > 0)));
  await formThumb.click();
  const viewer = page.getByRole("dialog", { name: "ID photo" });
  check("the photo opens large, in the app", await shows(viewer.locator("img")));
  // React events bubble through the viewer's portal: a photo dropped on it must not replace the one behind.
  const formState = async () => [await formThumb.locator("img").getAttribute("src"), await dialog.getByRole("alert").allInnerTexts()];
  const before = JSON.stringify(await formState());
  await viewer.evaluate(async (v) => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 40, height: 40 });
    canvas.getContext("2d").fillRect(0, 0, 40, 40);
    const png = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([png], "mock-other.png", { type: "image/png" }));
    for (const type of ["dragover", "drop"]) v.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
  });
  await page.waitForTimeout(800);
  check("a photo dropped on the large photo leaves the form's photo as it was", JSON.stringify(await formState()) === before);
  await page.keyboard.press("Escape");
  check("Escape closes only the photo; the form stays", (await gone(viewer)) && (await dialog.isVisible()));
  check("nothing is saved before Save", (await ids()).length === 0);
  await shot("ids-form");
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);

  // ---- The detail: the number and the photo stay in main until asked for
  const passport = await byTitle("Passport");
  check("saved under its ID type, with the number and the photo", passport?.idType === "Passport" && passport.hasNumber && passport.hasPhoto);
  const data = JSON.stringify(await view());
  check("the page never holds the number or the photo", !data.includes(NUMBER) && !data.includes("data:image"));
  check("the detail says ID and shows the ID", (await shows(main.getByText("ID ·", { exact: false }))) && (await shows(main.getByText("Passport", { exact: true }).nth(1))));
  check("the number is masked", !(await main.getByText(NUMBER).count()));
  await main.locator("div.border-b", { hasText: "ID number" }).getByRole("button", { name: "Reveal" }).click();
  check("Reveal shows the number", await shows(main.getByText(NUMBER)));
  const thumb = main.getByRole("button", { name: "Show the ID photo larger" });
  check("the photo is hidden until Show photo", (await shows(main.getByRole("button", { name: "Show photo" }))) && !(await thumb.count()));
  await main.getByRole("button", { name: "Show photo" }).click();
  check("Show photo shows it under the card", (await shows(thumb.locator("img"))) && (await thumb.locator("img").evaluate((img) => img.naturalWidth > 0)));
  await shot("ids-detail");
  await thumb.click();
  check("a click shows it large", await shows(viewer.locator("img")));
  await viewer.getByRole("button", { name: "Close photo" }).click();
  check("Close photo closes it", await gone(viewer));
  check("a photo is never copied", await page.evaluate((id) => window.kapevault.copySecret(id, "photo").then(() => false, () => true), passport.id));
  await main.getByRole("button", { name: "Copy ID number", exact: true }).click();
  check("the Copy ID number pill copies it", await waitFor(async () => (await clip(app)) === NUMBER));
  // The clear leaves a newer copy alone, so a copy made meanwhile by someone at this PC stays: what must
  // be true either way is that the number is gone.
  check("and it is cleared from the clipboard after 30 s", await waitFor(async () => (await clip(app)) !== NUMBER, 34000), JSON.stringify((await clip(app)).slice(0, 40)));

  // ---- Other: a name typed by hand; the title follows it
  await newId();
  await typeSelect.selectOption("Other");
  const which = dialog.getByLabel("Which ID");
  check("Other asks which ID, and that field takes the focus", (await shows(which)) && (await which.evaluate((i) => i === document.activeElement)));
  await dialog.getByRole("button", { name: "Save" }).click();
  check("an empty Other says so", await shows(dialog.getByText("Say which ID it is.")));
  await which.fill("Mock Barangay ID");
  await titleInput.fill("Mock Lola card"); // a title of its own, so search by type is tested apart from the title
  await numberInput.fill(OTHER_NUMBER);
  await pickPhoto(dialog.getByRole("button", { name: /Add a photo/ }));
  await shows(formThumb);
  await dialog.getByRole("button", { name: "More options" }).click();
  await dialog.getByLabel("Held for").fill("Mock Lola");
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  const barangay = await byTitle("Mock Lola card");
  check("an Other ID saves the typed name as its type", barangay?.idType === "Mock Barangay ID" && barangay.hasNumber && barangay.hasPhoto && barangay.heldFor === "Mock Lola");

  // ---- Edit: the title keeps following, the number loads masked, the photo stays unloaded
  await rows.filter({ hasText: "Passport" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  check("editing: the list shows the saved ID", (await typeSelect.inputValue()) === "Passport");
  check("the title still follows the ID", (await titleInput.inputValue()) === "");
  check("the saved number loads, masked", (await waitFor(async () => (await numberInput.inputValue()) === NUMBER)) && (await numberInput.getAttribute("type")) === "password");
  check("the saved photo is not even loaded", (await shows(dialog.getByRole("button", { name: "Show photo" }))) && !(await dialog.locator("img[alt='ID photo']").count()));
  await dialog.getByRole("button", { name: "Show photo" }).click();
  check("Show photo loads it into the form, and it takes the focus", (await shows(formThumb.locator("img"))) && (await formThumb.evaluate((b) => b === document.activeElement)));
  await typeSelect.selectOption("Driver's license");
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  const license = await byTitle("Driver's license");
  check("a new ID type renames an untitled ID; number and photo kept", license?.id === passport.id && license.idType === "Driver's license" && license.hasPhoto && (await page.evaluate((id) => window.kapevault.getSecret(id, "idNumber"), license.id)) === NUMBER);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.getByRole("button", { name: "Remove photo" }).click();
  check("Remove photo brings back Add a photo", await shows(dialog.getByRole("button", { name: /Add a photo/ })));
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  check("Remove photo + Save drops the photo, keeps the number", !(await byTitle("Driver's license")).hasPhoto && (await byTitle("Driver's license")).hasNumber);

  // ---- The IDs list, search, the keyboard, quick search
  check("the IDs list appears once there is an ID", await shows(aside.getByText("IDs", { exact: true })));
  await aside.getByRole("button", { name: /^IDs/ }).click();
  check("IDs lists both, each row saying its ID", (await waitFor(async () => (await rows.count()) === 2)) && (await shows(rows.filter({ hasText: "Mock Barangay ID" }))));
  await shot("ids-list");
  await search.fill("barangay");
  check("search finds an ID by its type", await waitFor(async () => (await rows.count()) === 1));
  await search.fill(OTHER_NUMBER);
  check("search never finds an ID by its number", await waitFor(async () => (await rows.count()) === 0));
  await search.fill("");
  await rows.filter({ hasText: "Mock Barangay ID" }).click();
  await page.keyboard.press("Control+Shift+C");
  check("Ctrl+Shift+C copies the ID number", await waitFor(async () => (await clip(app)) === OTHER_NUMBER));
  const quickOpened = app.waitForEvent("window", { timeout: 8000 }).catch(() => null);
  await app.evaluate(() => globalThis.__kapevaultToggleQuick());
  const quick = (await quickOpened) ?? app.windows().find((w) => w.url().includes("#quick"));
  if (quick) {
    await quick.waitForLoadState("domcontentloaded");
    await quick.getByRole("combobox").fill("license");
    check("quick search finds an ID and offers Copy ID number", (await shows(quick.getByRole("option", { name: /Driver's license/ }))) && (await shows(quick.getByText("Copy ID number"))));
    check("quick search never shows the number", !(await quick.content()).includes(NUMBER));
    await app.evaluate(() => globalThis.__kapevaultToggleQuick());
  } else check("quick search window opens", false);

  check("no page errors", errors.length === 0, errors.join(" | "));
  await app.close();

  // ---- The Forever Opener: the type reads plainly, the number and the photo stay masked until shown
  const browser = await chromium.launch();
  const openerFile = path.join(dataDir, "KAPEVault Opener.html");
  fs.writeFileSync(openerFile, openerHtml(version));
  const context = await browser.newContext();
  const requests = [];
  context.on("request", (r) => !r.url().startsWith("file:") && !r.url().startsWith("data:") && requests.push(r.url()));
  const web = await context.newPage();
  const pageErrors = [];
  web.on("pageerror", (e) => pageErrors.push(e.message));
  await web.goto(pathToFileURL(openerFile).href);
  await web.locator("#file").setInputFiles(path.join(dataDir, "vault.kapevault"));
  await web.getByLabel("Master password").fill(MASTER);
  await web.getByRole("button", { name: "Open" }).click();
  await web.getByRole("button", { name: /Mock Barangay ID/ }).click({ timeout: 20000 });
  check("opener: the ID type reads plainly", (await shows(web.locator(".field-label", { hasText: /^ID$/ }))) && (await shows(web.locator(".field-value", { hasText: "Mock Barangay ID" }))));
  check("opener: the number is masked until shown", !(await web.content()).includes(OTHER_NUMBER) && (await shows(web.getByRole("button", { name: "Show ID number" }))));
  await web.getByRole("button", { name: "Show ID number" }).click();
  check("opener: Show reveals the number", await shows(web.getByText(OTHER_NUMBER)));
  const openerPhoto = web.locator("img[alt='ID photo']");
  check("opener: the ID photo is hidden until shown", !(await openerPhoto.count()) && (await shows(web.getByRole("button", { name: "Show ID photo" }))));
  await web.getByRole("button", { name: "Show ID photo" }).click();
  check("opener: Show draws the photo as a picture", (await shows(openerPhoto)) && (await openerPhoto.evaluate((img) => img.complete && img.naturalWidth > 0)));
  await web.screenshot({ path: path.join(SHOTS, "ids-opener.png") });
  await web.getByLabel("Search").fill(OTHER_NUMBER);
  check("opener: search never finds an ID by its number", await shows(web.getByText("0 items")));
  check("opener: zero network requests, no page errors", requests.length === 0 && pageErrors.length === 0, [...requests, ...pageErrors].join(" | "));
  await browser.close();

  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = report() ? 0 : 1;
})().catch((e) => {
  report();
  console.log("CRASH:", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(1);
});
