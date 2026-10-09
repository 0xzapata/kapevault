// End-to-end checks for Held-For: the "Held for" field with suggestions, the chip on
// the detail, the sidebar section and its filter, search by person, and Hand back - from the list
// button and the person's menu, with and without passwords. Part of npm run e2e. Throwaway vault,
// mock names only. Page screenshots (light + dark) in %TEMP%\kapevault-e2e-v2.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHarness, shows, gone, opened, waitFor } = require("./e2e-harness.cjs");

const SHOTS = path.join(os.tmpdir(), "kapevault-e2e-v2");
fs.mkdirSync(SHOTS, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-heldfor-"));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-heldfor-out-"));
const { check, launch, report } = createHarness();
const MASTER = "mock kettle harbor pass orbit gazelle";
const PASSWORD = "Mock-Lola-Bank-Pass-7";

(async () => {
  const { app, page, errors } = await launch({ KAPEVAULT_DATA_DIR: dataDir });
  const dialog = page.getByRole("dialog");
  const aside = page.locator("aside[aria-label='Vault navigation']");
  const search = aside.locator("[data-search]");
  const rows = page.locator("section[aria-label='Items'] li[class='group']");
  const heldForField = dialog.getByText("Held for", { exact: true }).locator("..").locator("input");
  const moreOptions = dialog.getByRole("button", { name: "More options" });
  const theme = (t) => page.evaluate((name) => window.kapevault.setSettings({ theme: name }), t).then(() => page.waitForTimeout(400));
  const shot = async (name) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    await theme("dark");
    await page.screenshot({ path: path.join(SHOTS, `${name}-dark.png`) });
    await theme("classic");
  };

  await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
  await page.getByPlaceholder("Confirm master password").fill(MASTER);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Nothing here yet").waitFor({ timeout: 15000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.getByRole("button", { name: "Add an item" }).click();
  check("an empty vault's one button opens New item", await shows(dialog.getByRole("heading", { name: "New item" })));
  await page.keyboard.press("Escape");
  await gone(dialog);
  await page.evaluate(async () => {
    const b = window.kapevault;
    const spaceId = (await b.view()).spaces[0].id;
    const base = { spaceId, tags: [], favorite: false, notes: "" };
    await b.saveEntry({ ...base, kind: "login", title: "Mock Own GitHub", username: "mock.me", password: "mock-own-pass-9", url: "https://github.com" });
    await b.saveEntry({ ...base, kind: "thing", title: "Mock Lola passport", spot: "blue folder", heldFor: "Mock Lola" });
  });
  check("the Held for section shows once one item is held for someone", await shows(aside.getByText("Held for", { exact: true })));

  // ---- The field: typed on a new login, then suggested on the next item
  await page.getByRole("button", { name: "New" }).click();
  await dialog.getByPlaceholder("GitHub").fill("Mock Rural Bank");
  await dialog.getByText("Username or email").locator("..").locator("input").fill("mock.lola");
  await dialog.locator("input[type='password']").fill(PASSWORD);
  check("Held for waits under More options", !(await heldForField.isVisible()));
  await moreOptions.click();
  check("More options shows it, with the focus in it", (await shows(heldForField)) && (await heldForField.evaluate((el) => el === document.activeElement)));
  check("names already used are suggested", (await dialog.locator("datalist option[value='Mock Lola']").count()) === 1);
  await heldForField.fill("mock lola "); // another spelling of the same person
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  check("the detail shows a quiet Held for chip", await shows(page.locator("main").getByText("Held for mock lola")));
  await shot("held-for-detail");

  const person = aside.getByRole("button", { name: /^ML Mock Lola/ });
  check("one row per person, any spelling, with the count", (await person.count()) === 1 && (await person.innerText()).includes("2"));
  await search.fill("rural bank");
  check("search finds by title", await waitFor(async () => (await rows.count()) === 1));
  await search.fill("mock lola");
  check("search matches who it is held for", await waitFor(async () => (await rows.count()) === 2) && (await shows(rows.filter({ hasText: "Mock Rural Bank" }))));
  await search.fill("");

  await person.click();
  check("selecting a person lists only their items", (await shows(page.locator("h2", { hasText: "Held for Mock Lola" }))) && (await rows.count()) === 2);
  check("the sidebar marks the person as current", (await person.getAttribute("aria-current")) === "true");
  await shot("held-for-list");

  await page.getByRole("button", { name: "New" }).click();
  await dialog.getByRole("button", { name: "Secure note" }).click();
  check("a new item from a person's list is theirs already, shown open", (await shows(heldForField)) && (await heldForField.inputValue()) === "Mock Lola");
  await dialog.getByPlaceholder("GitHub").fill("Mock Lola gate code");
  await dialog.getByLabel("Note", { exact: true }).fill("Mock gate 4321");
  await shot("held-for-form");
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  check("it lands in the person's list", await waitFor(async () => (await rows.count()) === 3));

  // ---- Hand back: capture the page the PDF is printed from, stub the save dialog
  await app.evaluate(({ app: a }) => {
    globalThis.__printed = [];
    a.on("browser-window-created", (_e, w) => w.webContents.on("did-finish-load", () => globalThis.__printed.push(decodeURIComponent(w.webContents.getURL()))));
  });
  const printed = () => app.evaluate(() => globalThis.__printed);
  const saveTo = (p) => app.evaluate(({ dialog: d }, f) => { d.showSaveDialog = async () => (f ? { canceled: false, filePath: f } : { canceled: true }); }, p);

  await page.getByRole("button", { name: "Hand back", exact: true }).click();
  check("Hand back opens from the person's list", await shows(dialog.getByRole("heading", { name: "Hand back to Mock Lola" })));
  check("it lists what is kept for them", (await dialog.getByRole("list", { name: "Kept for Mock Lola" }).locator("li").count()) === 3);
  const tick = dialog.getByRole("checkbox", { name: /Include passwords and secrets/ });
  check("passwords are off by default", !(await tick.isChecked()));
  await shot("held-for-hand-back");
  await saveTo(null);
  await dialog.getByRole("button", { name: "Save PDF..." }).click();
  check("a cancelled save dialog keeps the sheet open", (await dialog.isVisible()) && (await printed()).length === 0);
  const plainPdf = path.join(outDir, "mock-hand-back.pdf");
  await saveTo(plainPdf);
  await dialog.getByRole("button", { name: "Save PDF..." }).click();
  check("Save PDF writes the PDF", await waitFor(() => fs.existsSync(plainPdf) && fs.readFileSync(plainPdf).subarray(0, 4).toString() === "%PDF", 10000));
  check("and opens it, like the Emergency Kit", await waitFor(async () => (await opened(app)).some(([k, p]) => k === "path" && p === plainPdf)));
  check("a toast names the file", await shows(page.getByRole("status").filter({ hasText: "Saved mock-hand-back.pdf" })));
  const plainHtml = (await printed()).at(-1) ?? "";
  check("the printout lists her items", ["Mock Rural Bank", "Mock Lola passport", "Mock Lola gate code", "mock.lola", "blue folder"].every((t) => plainHtml.includes(t)));
  check("without the tick: no password, no note body", !plainHtml.includes(PASSWORD) && !plainHtml.includes("Mock gate 4321") && plainHtml.includes("Passwords are not on this page."));
  check("never another person's items", !plainHtml.includes("Mock Own GitHub") && !plainHtml.includes("mock-own-pass-9"));

  await person.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Hand back..." }).click();
  check("Hand back also opens from the person's menu", await shows(dialog.getByRole("heading", { name: "Hand back to Mock Lola" })));
  await tick.check();
  check("ticking it warns in plain words", await shows(dialog.getByText("Anyone who sees the PDF can read them", { exact: false })));
  const typed = path.join(outDir, "mock-hand-back-full.cmd"); // a typed name that is not a PDF is never what gets opened
  await saveTo(typed);
  await dialog.getByRole("button", { name: "Save PDF..." }).click();
  check("with the tick, the PDF is saved too - as .pdf whatever name was typed", (await waitFor(() => fs.existsSync(`${typed}.pdf`), 10000)) && !fs.existsSync(typed));
  check("and the .pdf is what opens", await waitFor(async () => (await opened(app)).some(([k, p]) => k === "path" && p === `${typed}.pdf`)));
  const fullHtml = (await printed()).at(-1) ?? "";
  check("with the tick: the password and the note are printed", fullHtml.includes(PASSWORD) && fullHtml.includes("Mock gate 4321") && fullHtml.includes("This page holds passwords."));
  await gone(dialog);

  // ---- Clearing the name everywhere takes the person away
  await page.evaluate(async () => {
    const b = window.kapevault;
    for (const e of (await b.view()).entries.filter((x) => x.heldFor)) await b.saveEntry({ ...e, heldFor: "" });
  });
  check("no one held for: the section and the person's list go", (await gone(aside.getByText("Held for", { exact: true }))) && (await shows(page.locator("h2", { hasText: "All items" }))));

  check("no page errors", errors.length === 0, errors.join(" | "));
  await app.close();
  for (const dir of [dataDir, outDir]) fs.rmSync(dir, { recursive: true, force: true });
  process.exitCode = report() ? 0 : 1;
})().catch((e) => {
  report();
  console.log("CRASH:", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(1);
});
