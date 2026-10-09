// End-to-end checks for the v2 features: item types, generator, 2FA codes,
// password history, health, clients, keyboard, sorting, quick search, Windows Hello (fake), backup
// + Emergency Kit + restore from file, and the resizable layout at every breakpoint.
// Run: npm run e2e (runs e2e.cjs first). Throwaway vault, mock names only.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHarness, shows, gone, clip, opened, waitFor } = require("./e2e-harness.cjs");
const { renderIdCard } = require("./mock-sticker.cjs");
const { totpCode } = require("../electron/totp.cjs");
const { parseTotp } = require("../core/index.js");

const SHOTS = path.join(os.tmpdir(), "kapevault-e2e-v2");
fs.mkdirSync(SHOTS, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e2-"));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e2-out-"));
const { check, launch: launchWith, lockedBy, report } = createHarness();
const launch = () => launchWith({ KAPEVAULT_DATA_DIR: dataDir, KAPEVAULT_BIOMETRIC_FAKE: "approve" });
const MASTER = "mock kettle harbor pass orbit gazelle";
const TOTP_KEY = "JBSWY3DPEHPK3PXP";

// The code on the clipboard must be the current code (or the neighbour step, if the 30s boundary passed).
function codeMatches(code) {
  const uri = parseTotp(TOTP_KEY).uri;
  const now = Date.now();
  return [now - 30000, now, now + 30000].some((t) => totpCode(uri, t).code === code);
}

(async () => {
  let { app, page, errors } = await launch();
  const dialog = page.getByRole("dialog");
  const mod = "Control";
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight);
  const setSize = async (w, h) => {
    await app.evaluate(({ BrowserWindow }, [w2, h2]) => {
      const win = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes("#quick"));
      win.unmaximize();
      win.setContentSize(w2, h2);
    }, [w, h]);
    await page.waitForFunction(([w2]) => Math.abs(innerWidth - w2) <= 2, [w]);
    await page.waitForTimeout(250);
  };

  check("window is resizable with a minimum size", await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const [mw, mh] = w.getMinimumSize();
    return w.isResizable() && mw === 400 && mh === 560;
  }));

  // New vault
  await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
  await page.getByPlaceholder("Confirm master password").fill(MASTER);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Nothing here yet").waitFor({ timeout: 15000 });
  await setSize(1440, 900);

  // ---- Login with generator + 2FA
  await page.getByRole("button", { name: "New" }).click();
  await dialog.getByPlaceholder("GitHub").fill("Mock Portal");
  await dialog.getByText("Username or email").locator("..").locator("input").fill("mock.user@example.com");
  await dialog.getByRole("button", { name: "Generate password" }).click();
  const genPreview = await shows(page.getByRole("button", { name: "Use password" }));
  check("generator opens under the password field", genPreview);
  await page.getByRole("button", { name: "Use password" }).click();
  const generated = await dialog.getByText("Password", { exact: true }).locator("..").locator("input").inputValue();
  check("generated password fills the field (20 chars default)", generated.length === 20, String(generated.length));
  check("strength meter rates it", await shows(dialog.getByText(/Very strong|Strong/)));
  const totpInput = dialog.getByLabel("2FA setup key");
  await totpInput.fill("not a key !!");
  await totpInput.blur();
  check("a bad 2FA key is refused inline", await shows(dialog.getByText("That is not a valid 2FA setup key.")));
  await totpInput.fill("jbsw y3dp ehpk 3pxp");
  await totpInput.blur();
  await dialog.getByPlaceholder("https://", { exact: true }).fill("https://portal.example.com");
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.locator("h1", { hasText: "Mock Portal" }).waitFor();
  check("login with 2FA saved", true);
  check("2FA code shows in the detail pane", await shows(page.getByRole("button", { name: "Copy 2FA code" })));
  await page.getByRole("button", { name: "Copy code" }).click();
  await page.waitForTimeout(200);
  check("Copy code puts the current TOTP code on the clipboard", codeMatches(await clip(app)), await clip(app));
  check("a toast confirms the copy", await shows(page.getByRole("status").filter({ hasText: "2FA code copied" })));
  check("the 2FA key never reaches the page", !(await page.content()).includes(TOTP_KEY));

  // ---- Password history
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.getByText("Password", { exact: true }).locator("..").locator("input").fill("Mock-Second-Pass-42");
  check("changing the password says the old one is kept", await shows(dialog.getByText("The old password moves to Password history.")));
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  await page.getByRole("button", { name: /Password history \(1\)/ }).click();
  await page.getByRole("button", { name: "Copy old password (clears in 30s)" }).click();
  await page.waitForTimeout(200);
  check("history keeps the replaced password", (await clip(app)) === generated);

  // ---- Generated passwords: a value is kept the moment it leaves the generator, so a lock with the item
  // form open and unsaved (Win+L, sleep, idle) cannot take a password already pasted into a site
  await page.getByRole("button", { name: "New" }).click();
  await dialog.getByPlaceholder("GitHub").fill("Mock Unsaved Site");
  await dialog.getByRole("button", { name: "Generate password" }).click();
  const generator = page.getByRole("group", { name: "Password generator" });
  await generator.waitFor();
  // The login above took its password through "Use password", so that one is already kept.
  check("Use password kept the value it put in the form", await shows(generator.getByRole("button", { name: "Recent (1)" })));
  await generator.getByRole("button", { name: "New password" }).click(); // a re-roll keeps nothing
  const copiedRoll = await generator.locator("p.font-mono").innerText();
  await generator.getByRole("button", { name: "Copy", exact: true }).click();
  check("Copy puts the generated password on the clipboard", await waitFor(async () => (await clip(app)) === copiedRoll));
  check("the copy is listed under Recent", await shows(generator.getByRole("button", { name: "Recent (2)" })));
  await lockedBy(app, page, () => page.evaluate(() => window.kapevault.lock()));
  await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Lock vault" }).waitFor({ timeout: 8000 });
  check("the lock took the unsaved form", (await page.getByText("Mock Unsaved Site").count()) === 0);
  await page.getByRole("button", { name: "New" }).click();
  await dialog.getByRole("button", { name: "Generate password" }).click();
  await generator.waitFor();
  check("after the lock and unlock, Recent still holds both", await shows(generator.getByRole("button", { name: "Recent (2)" })));
  await generator.getByRole("button", { name: "Recent (2)" }).click();
  check("the page holds the list's times only, no value, until one is shown", !(await page.content()).includes(copiedRoll));
  // Newest first: the copy, then the earlier "Use password" value - and nothing else, so the re-roll was never kept.
  await generator.getByRole("button", { name: "Show password" }).first().click();
  check("Show reveals the copied password first", await shows(generator.getByText(copiedRoll, { exact: true })));
  await generator.getByRole("button", { name: "Show password" }).last().click();
  check("then the one Use password put in the form", await shows(generator.getByText(generated, { exact: true })));
  await app.evaluate(({ clipboard }) => clipboard.clear());
  await generator.getByRole("button", { name: "Copy password" }).first().click();
  check("Copy in Recent puts it on the clipboard", await waitFor(async () => (await clip(app)) === copiedRoll));
  await generator.getByRole("button", { name: "Clear" }).click();
  await generator.getByRole("button", { name: "Confirm delete" }).click();
  check("Clear empties Recent", await gone(generator.getByRole("button", { name: /^Recent/ })));
  await page.keyboard.press("Escape"); // the generator
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await gone(dialog);

  // ---- Weak + reused -> Security view
  await page.getByRole("button", { name: "New" }).click();
  await dialog.getByPlaceholder("GitHub").fill("Weak Twin");
  await dialog.getByText("Password", { exact: true }).locator("..").locator("input").fill("password1");
  check("strength meter flags a weak password", await shows(dialog.getByText("Very weak")));
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  await page.getByRole("button", { name: "New" }).click();
  await dialog.getByPlaceholder("GitHub").fill("Weak Clone");
  await dialog.getByText("Password", { exact: true }).locator("..").locator("input").fill("password1");
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  check("detail shows the issue banner", await shows(page.getByText("Reused on 1 other item")));
  await page.locator("aside").getByText("Security").click();
  check("Security view lists the two weak, reused items", (await page.locator("section li").count()) === 2);
  check("Security view explains the issues", await shows(page.getByText(/2 items need attention/)));

  // ---- Secure note + API key
  await page.locator("aside").getByText("All items").click();
  await page.getByRole("button", { name: "New" }).click();
  await dialog.getByRole("button", { name: "Secure note" }).click();
  await dialog.getByPlaceholder("GitHub").fill("Mock recovery codes");
  await dialog.getByLabel("Note").fill("1111-2222\n3333-4444");
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.locator("h1", { hasText: "Mock recovery codes" }).waitFor();
  await gone(dialog); // the closing form still holds what was typed
  check("note body is hidden until asked", !(await page.content()).includes("1111-2222"));
  await page.getByRole("button", { name: "Show note" }).click();
  check("Show note reveals the body", await shows(page.getByText("3333-4444")));

  await page.getByRole("button", { name: "New" }).click();
  await dialog.getByRole("button", { name: "API key" }).click();
  await dialog.getByPlaceholder("GitHub").fill("Mock Stripe key");
  await dialog.getByLabel("Key ID").fill("pk_mock_123");
  await dialog.getByLabel("Secret", { exact: true }).fill("sk_mock_secret_456");
  const soon = new Date(Date.now() + 5 * 86400000).toLocaleDateString("en-CA");
  await dialog.getByLabel("Expires").fill(soon);
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.locator("h1", { hasText: "Mock Stripe key" }).waitFor();
  await gone(dialog);
  check("API key secret stays out of the page", !(await page.content()).includes("sk_mock_secret_456"));
  await page.getByRole("button", { name: "Copy secret", exact: true }).click();
  await page.waitForTimeout(200);
  check("Copy secret copies the key secret", (await clip(app)) === "sk_mock_secret_456");
  check("an expiring key is flagged", await shows(page.getByText(/Expires in 5 days/)));
  await page.locator("aside").getByText("API keys").click();
  check("API keys view lists it", (await page.locator("section li").count()) === 1);
  await page.locator("aside").getByText("Notes").click();
  check("Notes view lists the note", (await page.locator("section li").count()) === 1);
  await page.locator("aside").getByText("2FA codes").click();
  check("2FA codes view lists the login with a code", (await page.locator("section li").count()) === 1);
  await page.locator("aside").getByText("All items").click();

  // ---- Keyboard flow
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.type("mock portal");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  check("Enter in search copies the top result's password", (await clip(app)) === "Mock-Second-Pass-42");
  await page.keyboard.press("Escape");
  await page.locator("section li", { hasText: "Mock Portal" }).click();
  await page.keyboard.press(`${mod}+c`);
  await page.waitForTimeout(200);
  check(`${mod}+C copies the username`, (await clip(app)) === "mock.user@example.com");
  await page.keyboard.press(`${mod}+Alt+c`);
  await page.waitForTimeout(200);
  check(`${mod}+Alt+C copies the 2FA code`, codeMatches(await clip(app)));
  const before = await page.locator("[aria-selected=true]").innerText();
  await page.locator("[data-entry-list]").focus();
  await page.keyboard.press("ArrowDown");
  check("ArrowDown moves the selection", (await page.locator("[aria-selected=true]").innerText()) !== before);
  await page.keyboard.press(`${mod}+/`);
  check(`${mod}+/ opens the shortcut list`, await shows(page.getByRole("dialog", { name: "Keyboard shortcuts" })));
  // Every sheet is a real modal: focus moves in and stays in, the app behind is inert, and focus comes back after.
  const shortcutsSheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  const entryList = page.locator("[data-entry-list]");
  const focusInSheet = () => shortcutsSheet.evaluate((d) => d.contains(document.activeElement));
  check("a sheet takes the focus, and the app behind it is inert", (await focusInSheet()) && (await entryList.evaluate((l) => l.closest("[inert]") !== null)));
  let stayed = true;
  for (const key of ["Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    stayed = stayed && (await focusInSheet());
  }
  check("Tab and Shift+Tab stay inside the sheet", stayed);
  await page.keyboard.press("Escape");
  await gone(dialog);
  check("closed, focus goes back to where it was and the app wakes", (await entryList.evaluate((l) => l === document.activeElement)) && (await entryList.evaluate((l) => l.closest("[inert]") === null)));
  await page.keyboard.press(`${mod}+n`);
  check(`${mod}+N opens a new item`, await shows(page.getByRole("dialog", { name: "New item" })));
  await page.keyboard.press("Escape");
  await gone(dialog);

  // ---- Recently used order
  await page.getByRole("button", { name: /^Sort by/ }).click();
  await page.getByRole("menuitem", { name: "Recently used" }).click();
  const firstRow = await page.locator("section li").first().innerText();
  check("Recently used puts the last copied item first", firstRow.includes("Mock Portal"), firstRow.split("\n")[0]);
  await page.getByRole("button", { name: /^Sort by/ }).click();
  await page.getByRole("menuitem", { name: "Title" }).click();
  check("Title sort is alphabetical", (await page.locator("section li").first().innerText()).includes("Mock Portal"));

  // ---- Clients: add, move by drag, rename, delete (moving items)
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByPlaceholder("Client name, then Enter").fill("Mock Client");
  await page.keyboard.press("Enter");
  await page.locator("aside").getByText("Mock Client").waitFor();
  await page.locator("aside").getByText("All items").click();
  await page.locator("section li", { hasText: "Weak Clone" }).locator("[draggable]").dragTo(page.locator("aside").getByRole("button", { name: /^MC Mock Client/ }));
  check("dragging an item onto a client moves it", await shows(page.getByRole("status").filter({ hasText: "Moved to Mock Client" })));
  await page.locator("aside").getByRole("button", { name: /^MC Mock Client/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Rename Mock Client").fill("Mock Client Renamed");
  await page.keyboard.press("Enter");
  check("rename a client", await shows(page.locator("aside").getByText("Mock Client Renamed")));
  // A client's photo: picked from its menu, cropped square and shown in place of the initials; removable.
  const clientRow = page.locator("aside").getByRole("button", { name: /^(MC )?Mock Client Renamed( \d+)?$/ });
  const avatar = clientRow.locator("img");
  const photoFile = await renderIdCard(path.join(dataDir, "mock-photo.png"));
  await page.getByRole("button", { name: "Mock Client Renamed options" }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }), page.getByRole("menuitem", { name: "Choose photo..." }).click()]);
  await chooser.setFiles(photoFile);
  check("a client's chosen photo replaces its initials", await shows(avatar));
  const shape = await avatar.evaluate((img) => ({ src: img.getAttribute("src")?.slice(0, 23), w: img.naturalWidth, h: img.naturalHeight, shown: img.getBoundingClientRect().width }));
  check("the photo is kept as a small square JPEG, drawn at 24 px", shape.src === "data:image/jpeg;base64," && shape.w === 128 && shape.h === 128 && shape.shown === 24);
  await page.getByRole("button", { name: "Mock Client Renamed options" }).click();
  check("with a photo the menu offers Change and Remove", await shows(page.getByRole("menuitem", { name: "Change photo..." })));
  await page.getByRole("menuitem", { name: "Remove photo" }).click();
  check("removing the photo brings the initials back", await gone(avatar) && (await shows(clientRow.getByText("MC", { exact: true }))));
  await page.getByRole("button", { name: "Mock Client Renamed options" }).click();
  await page.getByRole("menuitem", { name: "Delete client..." }).click();
  check("delete asks what happens to the items", await shows(dialog.getByText("This client holds 1 item.")));
  await dialog.getByRole("button", { name: "Delete client" }).click();
  await gone(dialog);
  // The menu and the row whose "..." opened it are both gone: focus lands on the item list, not the page.
  check("after deleting a client from its menu, focus is on the item list", await page.evaluate(() => document.activeElement?.matches("[data-entry-list]") === true));
  check("deleting a client moves its items to Personal", (await page.locator("aside").getByText("Mock Client Renamed").count()) === 0 && (await shows(page.locator("section li", { hasText: "Weak Clone" }))));

  // Context menu on a row
  await page.locator("section li", { hasText: "Mock Portal" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy username" }).click();
  await page.waitForTimeout(200);
  check("row menu copies the username", (await clip(app)) === "mock.user@example.com");
  await page.locator("section li", { hasText: "Mock Portal" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await dialog.getByPlaceholder("GitHub").waitFor();
  await page.waitForTimeout(150);
  check("Edit from the row menu leaves focus in the form", await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")));
  await page.keyboard.press("Escape");
  await gone(dialog);
  check("closing it hands focus to what had it before the menu (the list), not the page", await page.evaluate(() => document.activeElement?.matches("[data-entry-list]") === true));

  // Unfavoriting inside Favorites keeps the same item selected (the next row must not take over).
  await page.locator("section li", { hasText: "Weak Twin" }).click();
  await page.keyboard.press(`${mod}+d`);
  await page.locator("aside").getByText("Favorites").click();
  await page.locator("section li", { hasText: "Weak Twin" }).click();
  await page.keyboard.press(`${mod}+d`);
  await page.waitForTimeout(200);
  check("unfavorited item stays selected after it leaves Favorites", await shows(page.locator("h1", { hasText: "Weak Twin" })));
  await page.locator("aside").getByText("All items").click();

  // ---- Windows Hello (fake): enable in Settings, lock, unlock without the master password
  await page.getByRole("button", { name: "Settings" }).click();
  const lockAfter = dialog.getByLabel("Lock after", { exact: true });
  check("Lock after starts at 8 hours", (await shows(lockAfter)) && (await lockAfter.inputValue()) === "8");
  await lockAfter.selectOption("1");
  check("Lock after saves a change", await waitFor(async () => (await page.evaluate(() => window.kapevault.getSettings())).sessionLimitHours === 1));
  await lockAfter.selectOption("8");
  await dialog.getByRole("tab", { name: "Security" }).click();
  await dialog.getByRole("switch", { name: "Windows Hello" }).click();
  check("Windows Hello turns on", await shows(dialog.getByRole("switch", { name: "Windows Hello", checked: true }), 8000));
  // ---- Hide from screen capture: on by default; the switch flips the window's content protection live
  const captured = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isContentProtected()));
  const hideSwitch = (checked) => dialog.getByRole("switch", { name: "Hide from screen capture", checked });
  // A watched run (KAPEVAULT_ALLOW_CAPTURE=1, so a recording or screen share shows the windows) keeps
  // them capturable whatever the switch says; the switch itself is still checked.
  const watched = Boolean(process.env.KAPEVAULT_ALLOW_CAPTURE);
  const protectedNow = async () => (await captured()).every((p) => p === !watched);
  check(watched ? "Hide from screen capture starts on (watched run: windows stay capturable)" : "Hide from screen capture starts on, windows protected", (await shows(hideSwitch(true))) && (await protectedNow()));
  await hideSwitch(true).click();
  check("turned off, the windows can be captured", (await shows(hideSwitch(false))) && (await waitFor(async () => (await captured()).every((p) => !p))));
  await hideSwitch(false).click();
  check(watched ? "turned on again (watched run: windows stay capturable)" : "turned on again, the windows are protected", (await shows(hideSwitch(true))) && (await waitFor(protectedNow)));
  // ---- Backup: encrypted copy + Emergency Kit
  await dialog.getByRole("tab", { name: "Backup" }).click();
  const copyPath = path.join(outDir, "mock-copy.kapevault");
  const kitPath = path.join(outDir, "mock-kit.pdf");
  const saveTo = (p) => app.evaluate(({ dialog: d }, f) => { d.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, p);
  await saveTo(copyPath);
  await dialog.getByRole("button", { name: "Save encrypted copy..." }).click();
  check("Save encrypted copy writes the vault file as-is", await waitFor(() => fs.existsSync(copyPath) && fs.readFileSync(copyPath).equals(fs.readFileSync(path.join(dataDir, "vault.kapevault")))));
  await saveTo(kitPath);
  await dialog.getByRole("button", { name: "Save Emergency Kit..." }).click();
  check("Emergency Kit PDF is saved", await waitFor(() => fs.existsSync(kitPath) && fs.readFileSync(kitPath).subarray(0, 4).toString() === "%PDF", 10000));
  check("the kit opens for printing", (await opened(app)).some(([k, v]) => k === "path" && v === kitPath));
  await dialog.getByRole("button", { name: "Done" }).click();
  await gone(dialog);

  // Change after the copy, so a restore from the copy is visible
  await page.getByRole("button", { name: "New" }).click();
  await dialog.getByPlaceholder("GitHub").fill("Made After Copy");
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);

  await lockedBy(app, page, () => page.getByRole("button", { name: "Lock vault" }).click());
  check("lock screen offers Windows Hello", await shows(page.getByRole("button", { name: "Unlock with Windows Hello" })));
  await page.getByRole("button", { name: "Unlock with Windows Hello" }).click();
  check("Windows Hello unlocks without the master password", await shows(page.getByRole("button", { name: "Lock vault" }), 8000));

  // ---- Restore from the saved copy: needs its master password, then opens straight away
  await page.getByRole("button", { name: "Settings" }).click();
  await dialog.getByRole("tab", { name: "Backup" }).click();
  await app.evaluate(({ dialog: d }, f) => { d.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, copyPath);
  await dialog.getByRole("button", { name: "Restore from a file..." }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Choose file..." }).click();
  const restorePw = page.getByRole("dialog").getByLabel("Master password for this backup");
  await restorePw.fill("wrong password");
  await page.getByRole("dialog").getByRole("button", { name: "Restore", exact: true }).click();
  check("a wrong backup password changes nothing", await shows(page.getByText("Wrong master password for that backup.")));
  await restorePw.fill(MASTER);
  await page.getByRole("dialog").getByRole("button", { name: "Restore", exact: true }).click();
  // No R2 here: the vault it replaces is kept beside it as replaced.kapevault, so no second click.
  const restoreClosed = await gone(page.getByRole("dialog"));
  if (!restoreClosed) await page.screenshot({ path: path.join(SHOTS, "restore-stuck.png") });
  check("restore from file opens the restored vault", await gone(page.locator("section li", { hasText: "Made After Copy" })));
  check("the restore says the replaced vault is kept here", await shows(page.getByRole("status").filter({ hasText: "The vault it replaced is kept on this PC" })));
  check("without R2 the replaced vault is kept in the data folder", fs.existsSync(path.join(dataDir, "replaced.kapevault")));
  check("no replace without a copy was asked for", (await page.getByRole("button", { name: "Replace without a copy" }).count()) === 0);
  check("restoring turns Windows Hello off (new key)", !fs.existsSync(path.join(dataDir, "hello.json")));

  // ---- The replaced vault: Settings > Backup brings it back with its own password, or deletes it
  const replacedFile = path.join(dataDir, "replaced.kapevault");
  await page.getByRole("button", { name: "Settings" }).click();
  await dialog.getByRole("tab", { name: "Backup" }).click();
  check("Settings shows the vault the restore replaced", await shows(dialog.getByText("Replaced vault", { exact: true })));
  await dialog.getByRole("button", { name: "Restore it" }).click();
  const replacedPw = dialog.getByLabel("Master password for this backup");
  check("Restore it asks only for that vault's master password", (await shows(replacedPw)) && (await dialog.getByRole("button", { name: "Choose file..." }).isHidden()));
  await replacedPw.fill(MASTER);
  await dialog.getByRole("button", { name: "Restore", exact: true }).click();
  check("restoring the replaced vault brings back what it held", await shows(page.locator("section li", { hasText: "Made After Copy" })));
  check("the slot now holds the vault that restore replaced, never a second copy of the open one", fs.existsSync(replacedFile) && !fs.readFileSync(replacedFile).equals(fs.readFileSync(path.join(dataDir, "vault.kapevault"))) && !fs.existsSync(path.join(dataDir, "replaced-next.kapevault")));
  await gone(dialog);

  // ---- A second restore never overwrites an occupied slot: it asks to replace with no copy kept,
  // and the kept vault stays byte for byte (after a lock-screen restore it may be the real vault)
  const slotBefore = fs.readFileSync(replacedFile);
  await page.getByRole("button", { name: "Settings" }).click();
  await dialog.getByRole("tab", { name: "Backup" }).click();
  await dialog.getByRole("button", { name: "Restore from a file..." }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Choose file..." }).click();
  await page.getByRole("dialog").getByLabel("Master password for this backup").fill(MASTER);
  await page.getByRole("dialog").getByRole("button", { name: "Restore", exact: true }).click();
  check("with the slot taken, the restore asks before replacing with no copy", await shows(page.getByRole("dialog").getByRole("button", { name: "Replace without a copy" })));
  check("it says the kept copy stays as it is", await shows(page.getByText(/already kept on this PC, and it stays as it is/)));
  check("asking changed nothing", fs.readFileSync(replacedFile).equals(slotBefore) && (await page.locator("section li", { hasText: "Made After Copy" }).count()) > 0);
  await page.getByRole("dialog").getByRole("button", { name: "Replace without a copy" }).click();
  check("replacing without a copy opens the restored vault", await gone(page.locator("section li", { hasText: "Made After Copy" })));
  check("the slot keeps its bytes through the second restore", fs.readFileSync(replacedFile).equals(slotBefore));
  await gone(page.getByRole("dialog"));

  // ---- Locked with the slot taken, replacing without a copy also needs the vault here's own master
  // password: a confirm alone would let anyone at the keyboard wipe it with a backup of their own.
  const vaultFile = path.join(dataDir, "vault.kapevault");
  await page.getByRole("button", { name: "New" }).click();
  await dialog.getByPlaceholder("GitHub").fill("Mock Before Locked Restore");
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  await lockedBy(app, page, () => page.getByRole("button", { name: "Lock vault" }).click());
  await page.getByRole("button", { name: "Restore from backup" }).click();
  await dialog.getByRole("tab", { name: "File" }).click();
  await dialog.getByRole("button", { name: "Choose file..." }).click();
  await dialog.getByLabel("Master password for this backup").fill(MASTER);
  await dialog.getByRole("button", { name: "Restore", exact: true }).click();
  const hereNow = dialog.getByLabel("Master password of the vault here now");
  check("locked with the slot taken, replacing without a copy asks for the vault here's own password", await shows(hereNow));
  const liveBefore = fs.readFileSync(vaultFile);
  await hereNow.fill("mock wrong passphrase");
  await dialog.getByRole("button", { name: "Replace without a copy" }).click();
  check("a wrong password for the vault here replaces nothing", await shows(dialog.getByText("Wrong master password for that vault.")));
  check("the vault here and the slot keep their bytes", fs.readFileSync(vaultFile).equals(liveBefore) && fs.readFileSync(replacedFile).equals(slotBefore));
  await hereNow.fill(MASTER);
  await dialog.getByRole("button", { name: "Replace without a copy" }).click();
  check("its right password replaces it", await shows(page.getByRole("button", { name: "Lock vault" }), 15000));
  check("the restored vault is open", await gone(page.locator("section li", { hasText: "Mock Before Locked Restore" })));
  check("the slot still keeps its bytes", fs.readFileSync(replacedFile).equals(slotBefore));
  await gone(dialog);
  await page.getByRole("button", { name: "Settings" }).click();
  await dialog.getByRole("tab", { name: "Backup" }).click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  check("deleting the replaced vault asks once more", await shows(dialog.getByRole("button", { name: "Confirm delete" })));
  check("asking deleted nothing yet", fs.existsSync(replacedFile));
  // Being unlocked is not enough: only the replaced vault's own master password deletes it.
  const replacedDeletePw = dialog.getByLabel("Its master password");
  await replacedDeletePw.fill("mock wrong passphrase");
  await dialog.getByRole("button", { name: "Confirm delete" }).click();
  check("a wrong password for the replaced vault deletes nothing", (await shows(dialog.getByText("Wrong master password for that vault."))) && fs.existsSync(replacedFile));
  await replacedDeletePw.fill(MASTER);
  await dialog.getByRole("button", { name: "Confirm delete" }).click();
  check("Confirm delete removes the replaced vault", await waitFor(() => !fs.existsSync(replacedFile)));
  check("its row goes with it", await gone(dialog.getByText("Replaced vault", { exact: true })));
  await dialog.getByRole("button", { name: "Done" }).click();
  await gone(dialog);

  // ---- Quick search window
  const quickOpened = app.waitForEvent("window", { timeout: 8000 }).catch(() => null);
  await app.evaluate(() => globalThis.__kapevaultToggleQuick());
  const quick = (await quickOpened) ?? app.windows().find((w) => w.url().includes("#quick"));
  check("quick search window opens", !!quick);
  if (quick) {
    await quick.waitForLoadState("domcontentloaded");
    const qInput = quick.getByRole("combobox");
    const ready = await shows(qInput, 8000);
    if (!ready) await quick.screenshot({ path: path.join(SHOTS, "quick-not-ready.png") });
    check("quick search shows the search field on an unlocked vault", ready);
    await qInput.fill("mock portal");
    await quick.keyboard.press("Enter");
    check("quick search Enter copies the password", await waitFor(async () => (await clip(app)) === "Mock-Second-Pass-42"));
    check("quick search hides after a copy", await waitFor(() => app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("#quick")).isVisible())));
    await app.evaluate(() => globalThis.__kapevaultToggleQuick());
    await qInput.fill("mock portal");
    await quick.keyboard.press("Control+Enter");
    check("quick search Ctrl+Enter copies the 2FA code", await waitFor(async () => codeMatches(await clip(app))));
    await quick.screenshot({ path: path.join(SHOTS, "quick.png") });
  }

  // ---- Responsive layout at every breakpoint
  for (const [w, h, name] of [[1440, 900, "wide"], [1000, 760, "medium"], [760, 700, "narrow"], [460, 640, "compact"], [400, 560, "minimum"]]) {
    await setSize(w, h);
    await page.screenshot({ path: path.join(SHOTS, `layout-${name}-${w}x${h}.png`) });
    check(`${name} ${w}x${h}: nothing overflows the window`, await noOverflow());
    const sidebarInline = await page.locator("aside[aria-label='Vault navigation']").isVisible();
    if (w >= 900) check(`${name}: sidebar sits inline`, sidebarInline);
    else check(`${name}: sidebar tucks away behind a button`, !sidebarInline && (await page.getByRole("button", { name: "Show sidebar" }).isVisible()));
  }
  await setSize(760, 700);
  await page.getByRole("button", { name: "Show sidebar" }).click();
  check("the sidebar drawer slides in", await shows(page.locator("aside[aria-label='Vault navigation']")));
  await page.locator("aside").getByText("Logins").click();
  check("picking a list closes the drawer", await gone(page.locator("aside[aria-label='Vault navigation']")));
  await setSize(460, 640);
  await page.locator("section li", { hasText: "Mock Portal" }).click();
  check("compact: an item pushes over the list", await shows(page.getByRole("button", { name: "Back to list" })));
  await page.screenshot({ path: path.join(SHOTS, "layout-compact-detail.png") });
  await page.getByRole("button", { name: "Back to list" }).click();
  check("compact: Back returns to the list", await shows(page.locator("section li", { hasText: "Mock Portal" })));
  await setSize(1440, 900);

  // ---- Sidebar collapses in place on wide windows, and comes back
  const aside = page.locator("aside[aria-label='Vault navigation']");
  // Sample every frame of the slide: once it starts moving out it must never jump back into view
  // (it snapped back to x=0 for a frame when the animation ended).
  const lefts = await page.evaluate(async () => {
    const seen = [];
    const t0 = performance.now();
    document.querySelector('[aria-label="Hide sidebar"]').click();
    while (performance.now() - t0 < 600) {
      const a = document.querySelector("[data-sidebar-slide]");
      seen.push(a ? Math.round(a.getBoundingClientRect().left) : null);
      await new Promise((r) => requestAnimationFrame(r));
    }
    return seen;
  });
  const moving = lefts.slice(lefts.findIndex((l) => l !== null && l < 0));
  check("the sidebar slides out without flashing back", moving.every((l, i) => l === null || i === 0 || moving[i - 1] === null || l <= moving[i - 1]), lefts.join(","));
  check("Hide sidebar collapses it", await gone(aside));
  check("collapsed: the list carries Show sidebar and search", (await page.getByRole("button", { name: "Show sidebar" }).isVisible()) && (await page.locator("section[aria-label='Items'] [data-search]").isVisible()));
  check("collapsed: nothing overflows", await noOverflow());
  await page.screenshot({ path: path.join(SHOTS, "sidebar-collapsed.png") });
  await page.getByRole("button", { name: "Show sidebar" }).click();
  check("Show sidebar brings it back inline", await shows(aside));
  await page.locator("section[aria-label='Items'] li").first().click();
  await page.keyboard.press("Control+Backslash");
  check("Ctrl+\\ hides the sidebar", await gone(aside));
  await page.keyboard.press("Control+Backslash");
  check("Ctrl+\\ shows it again", await shows(aside));

  // ---- Trust page: the "i" beside the name explains how the vault protects you
  // Its lock sentence follows Lock after (read when the page opens), and names no limit when it is Off.
  const lockSentence = dialog.getByText(/The vault locks when/).first();
  const trustSays = async (hours, words) => {
    await page.evaluate((h) => window.kapevault.setSettings({ sessionLimitHours: h }), hours);
    await page.getByRole("button", { name: "How KAPEVault protects you" }).click();
    return waitFor(async () => (await shows(lockSentence)) && (await lockSentence.textContent()).includes(words));
  };
  check("the trust page states the real Lock after value", await trustSays(1, "when you lock it, and 1 hour after you unlock it."));
  await dialog.getByRole("button", { name: "Done" }).click();
  await gone(dialog);
  check("with Lock after off, the trust page promises no limit", (await trustSays(0, "when it sleeps, and when you lock it.")) && !(await lockSentence.textContent()).includes("after you unlock it"));
  await dialog.getByRole("button", { name: "Done" }).click();
  await gone(dialog);
  check("the i button opens the trust page", (await trustSays(8, "and 8 hours after you unlock it.")) && (await shows(dialog.getByRole("heading", { name: "How KAPEVault protects you" }))));
  check("the trust page is honest about its limits", await shows(dialog.getByText("What no vault can protect against")));
  await dialog.getByRole("button", { name: "Done" }).click();
  check("Done closes the trust page", await gone(dialog));

  // ---- Themes: Settings > General > Appearance
  const themeIs = (t) => waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === t);
  await page.getByRole("button", { name: "Settings" }).click();
  await dialog.getByRole("tab", { name: "General" }).click();
  await dialog.getByRole("radio", { name: "Dark" }).click();
  check("Dark theme applies at once", await themeIs("dark"));
  check("dark theme turns the ink light", (await page.evaluate(() => getComputedStyle(document.body).color)) === "rgb(245, 245, 247)");
  await page.screenshot({ path: path.join(SHOTS, "theme-dark-settings.png") });
  await dialog.getByRole("radio", { name: "Colorblind" }).click();
  check("Colorblind theme applies", await themeIs("colorblind"));
  await dialog.getByRole("radio", { name: "High contrast" }).click();
  check("High contrast theme applies", await themeIs("contrast"));
  await dialog.getByRole("radio", { name: "System" }).click();
  check("System resolves to classic or dark", await waitFor(async () => ["classic", "dark"].includes(await page.evaluate(() => document.documentElement.dataset.theme))));
  await dialog.getByRole("radio", { name: "Dark" }).click();
  await themeIs("dark");
  check("the sheet stays below the window-button strip", (await dialog.boundingBox()).y >= 52);

  // A real drag on the scrim over a title bar must close the sheet, not move the window.
  const win = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes("#quick"));
    // An OS press lands on whatever window is on top there. Windows refuses focus() to a background
    // process, so with another window over it (an editor in use) the press missed: [] (2026-10-10).
    w.setAlwaysOnTop(true, "screen-saver");
    w.moveTop();
    w.focus();
    const c = w.getContentBounds();
    // Physical pixels for the press, converted by Windows itself (mixed-DPI monitors included).
    return { ...w.getBounds(), pid: process.pid, press: screen.dipToScreenPoint({ x: c.x + 420, y: c.y + 20 }) };
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.__downs = [];
    addEventListener("mousedown", (e) => window.__downs.push(`${e.clientX},${e.clientY} ${String(e.target.className).slice(0, 12)}`), true);
  });
  const under = String(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "os-drag.ps1"), String(win.press.x), String(win.press.y)])).trim();
  await page.waitForTimeout(400);
  const moved = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes("#quick"));
    w.setAlwaysOnTop(false);
    return w.getBounds();
  });
  check("dragging the dimmed title bar does not move the window", moved.x === win.x && moved.y === win.y, `${win.x},${win.y} -> ${moved.x},${moved.y}`);
  const downs = await page.evaluate(() => window.__downs);
  // The OS press goes through screen pixels and sometimes lands a pixel or two off (418,21 on a
  // two-display PC, 2026-10-10): what matters is that it hit the scrim, inside the title bar strip.
  const [, px, py] = /^(\d+),(\d+) scrim/.exec(downs[0] ?? "") ?? [];
  check("the real press landed on the scrim over the title bar", px !== undefined && Math.abs(px - 420) <= 3 && Math.abs(py - 20) <= 3, `${JSON.stringify(downs)} app pid=${win.pid} win=${win.x},${win.y} ${win.width}x${win.height} under: ${under}`);
  check("clicking the dimmed title bar closes the sheet", await gone(dialog));
  if (await dialog.isVisible()) await page.keyboard.press("Escape"); // leave a clean window either way
  await page.screenshot({ path: path.join(SHOTS, "theme-dark.png") });

  // ---- A lock by the session limit says why on the lock screen (a test cannot wait hours for it)
  await lockedBy(app, page, () => app.evaluate(() => globalThis.__kapevaultLock("session-limit")));
  check("the lock screen says the session limit locked it", await shows(page.getByText("Locked after 8 hours", { exact: true })));
  await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Lock vault" }).waitFor({ timeout: 8000 });

  // ---- Quick window, locked: a half-typed master password never stays in it once it hides
  await page.keyboard.press(`${mod}+l`);
  await shows(page.getByRole("button", { name: "Continue" }));
  check("a lock by hand gives no reason", (await page.getByText(/^Locked after/).count()) === 0);
  await app.evaluate(() => globalThis.__kapevaultToggleQuick());
  const quickMaster = app.windows().find((w) => w.url().includes("#quick"))?.getByLabel("Master password");
  const quickAsks = Boolean(quickMaster) && (await shows(quickMaster));
  check("the locked quick window asks for the master password", quickAsks);
  if (quickAsks) {
    await quickMaster.fill("mock half typed");
    await app.evaluate(() => globalThis.__kapevaultToggleQuick()); // hides it
    await app.evaluate(() => globalThis.__kapevaultToggleQuick()); // and back
    check("hidden and shown again, the half-typed master password is gone", await waitFor(async () => (await quickMaster.inputValue()) === ""));
    await app.evaluate(() => globalThis.__kapevaultToggleQuick());
  }

  // ---- Window size is remembered
  await setSize(1100, 720);
  await page.waitForTimeout(700);
  check("no page errors", errors.length === 0, errors.join(" | "));
  await app.close();
  ({ app, page, errors } = await launch());
  const reopened = await page.evaluate(() => [innerWidth, innerHeight]);
  check("the window reopens at the size it was left", Math.abs(reopened[0] - 1100) <= 16 && Math.abs(reopened[1] - 720) <= 16, reopened.join("x"));
  check("the vault is locked after a restart", await shows(page.getByRole("button", { name: "Continue" })));
  check("the theme is remembered and painted from the first frame", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await page.getByRole("button", { name: "How KAPEVault protects you" }).click();
  check("the lock screen links to the trust page", await shows(page.getByRole("dialog").getByRole("heading", { name: "How KAPEVault protects you" })));
  await page.screenshot({ path: path.join(SHOTS, "trust-dark.png") });
  await app.close();

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(`Screens: ${SHOTS}`);
  process.exitCode = report() ? 0 : 1;
})().catch((e) => {
  report();
  console.log("CRASH:", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(1);
});
