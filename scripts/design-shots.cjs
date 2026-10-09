// Design review on the REAL screen: the acrylic glass is invisible to page screenshots, so this
// captures the window's screen region with capture-window.ps1. Seeds a throwaway vault.
// Run: npm run design   -> PNGs in %TEMP%\kapevault-design\ (lock, main, oauth, oauth-form, folder, form, ...)
// plus the Forever Opener page in Chromium (opener-unlock/list, light + dark, phone width)
const { _electron: electron, chromium } = require("./playwright.cjs");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { openerHtml } = require("../electron/opener.cjs");
const { openFile, encryptWithKey } = require("../electron/vault-crypto.cjs");
const { renderIdCard, renderSticker } = require("./mock-sticker.cjs");

const APP = path.resolve(__dirname, "..");
const OUT = path.join(os.tmpdir(), "kapevault-design");
fs.mkdirSync(OUT, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-design-data-"));
const sample = fs.mkdtempSync(path.join(os.tmpdir(), "KAPEVault Clients-"));
fs.mkdirSync(path.join(sample, "Contracts"));
fs.mkdirSync(path.join(sample, "Brand assets"));
for (const f of ["Proposal.docx", "Budget.xlsx", "Invoice 0925.pdf"]) fs.writeFileSync(path.join(sample, f), "x");
fs.writeFileSync(path.join(sample, "Launch plan.md"), "# Launch plan");

// quick: capture the quick search window. Found by URL - once it exists, window [0] may be either.
async function screen(app, name, quick = false) {
  const b = await app.evaluate(({ BrowserWindow, screen: display }, quick) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("#quick") === quick);
    w.focus();
    return { ...w.getBounds(), scale: display.getPrimaryDisplay().scaleFactor };
  }, quick);
  await new Promise((r) => setTimeout(r, 700));
  const px = (n) => String(Math.round(n * b.scale));
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "capture-window.ps1"),
    px(b.x), px(b.y), px(b.width), px(b.height), path.join(OUT, name)]);
}

(async () => {
  const app = await electron.launch({
    executablePath: require(`${APP}/node_modules/electron`),
    args: [APP],
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ELECTRON_RUN_AS_NODE")), KAPEVAULT_DATA_DIR: dataDir, KAPEVAULT_AUTO_LOCK_SECONDS: "86400", KAPEVAULT_AIRWALL_FAKE: "on", KAPEVAULT_OCR_FAKE: "label", KAPEVAULT_ALLOW_CAPTURE: "1" },
  });
  const page = await app.firstWindow();
  globalThis.__page = page;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // firstWindow() can return the window still on about:blank (same race as e2e-harness.cjs).
  await page.waitForURL((u) => u.protocol === "app:" || u.protocol === "http:", { waitUntil: "domcontentloaded" });

  await page.getByPlaceholder("Master password", { exact: true }).fill("design kettle harbor pass orbit gazelle");
  await page.getByPlaceholder("Confirm master password").fill("design kettle harbor pass orbit gazelle");
  await page.keyboard.press("Enter");
  await page.getByText("Nothing here yet").waitFor({ timeout: 15000 });

  // Seed through the bridge, then lock/unlock so the UI reloads the vault.
  await page.evaluate(async (folder) => {
    const b = window.kapevault;
    const v = (await b.addSpace("Northwind Studio")).vault;
    const personal = v.spaces.find((s) => s.kind === "personal").id;
    const client = v.spaces.find((s) => s.name === "Northwind Studio").id;
    await b.addSpace("Bluebird Bakery");
    const base = { tags: [], favorite: false, notes: "" };
    const login = (x) => b.saveEntry({ ...base, kind: "login", password: "x-123456", ...x });
    await login({ spaceId: client, title: "GHL agency login", username: "ops@northwind.example", url: "https://app.gohighlevel.com", favorite: true, tags: ["ghl", "a2p"], notes: "White-label domain needed for Custom JS." });
    await login({ spaceId: personal, title: "Claude", username: "sam.reyes.mock@gmail.com", url: "https://claude.ai" });
    await login({ spaceId: personal, title: "GitHub", username: "you", url: "https://github.com", favorite: true });
    await login({ spaceId: personal, title: "Slack workspace", username: "you", url: "https://team.slack.com" });
    const gmail = (await login({ spaceId: personal, title: "Gmail", username: "sam.reyes.mock@gmail.com", url: "https://mail.google.com" })).id;
    await login({ spaceId: personal, title: "Hostinger VPS", username: "root", url: "https://hpanel.hostinger.com" });
    await b.saveEntry({ ...base, kind: "login", spaceId: personal, title: "Canva", username: "sam.reyes.mock@gmail.com", url: "https://www.canva.com", signIn: "google", viaEntryId: gmail });
    await b.saveEntry({ ...base, kind: "link", spaceId: client, title: "Brand assets", linkType: "drive", location: "https://drive.google.com/drive/folders/x" });
    await b.saveEntry({ ...base, kind: "link", spaceId: client, title: "Client files", linkType: "folder", location: folder });
  }, sample);
  await page.getByRole("button", { name: "Lock vault" }).click();
  await page.waitForTimeout(500);
  await screen(app, "lock.png");
  await page.getByPlaceholder("Master password").fill("design kettle harbor pass orbit gazelle");
  await page.keyboard.press("Enter");
  await page.locator("section li").first().waitFor({ timeout: 15000 });

  const open = async (title, shot) => {
    await page.locator("section li", { hasText: title }).click();
    await page.waitForTimeout(700);
    await screen(app, shot);
  };
  await open("GHL agency login", "main.png");
  await page.getByRole("button", { name: "How KAPEVault protects you" }).click();
  await page.waitForTimeout(500);
  await screen(app, "trust.png");
  await page.getByRole("dialog").getByText("Windows can keep KAPEVault offline").scrollIntoViewIfNeeded();
  await screen(app, "trust-air-wall.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await open("Canva", "oauth.png");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.waitForTimeout(500);
  await screen(app, "oauth-form.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await open("Client files", "folder.png");

  // Themes on the real screen: dark changes the window material too, which only a capture shows.
  const theme = async (name) => {
    await page.evaluate((t) => window.kapevault.setSettings({ theme: t }), name);
    await page.waitForTimeout(500);
  };
  await theme("dark");
  await open("GHL agency login", "theme-dark.png");
  await theme("contrast");
  await screen(app, "theme-contrast.png");
  await theme("colorblind");
  await screen(app, "theme-colorblind.png");
  await theme("classic");

  // v2 views: new item types, generator, 2FA, security, settings tabs, narrow + compact layouts.
  await page.evaluate(async () => {
    const b = window.kapevault;
    const v = await b.view();
    const personal = v.spaces.find((s) => s.kind === "personal").id;
    const base = { tags: [], favorite: false, notes: "" };
    const withCode = v.entries.find((e) => e.title === "GitHub");
    await b.saveEntry({ ...base, id: withCode.id, kind: "login", spaceId: personal, title: "GitHub", username: "you", url: "https://github.com", favorite: true, totp: "JBSWY3DPEHPK3PXP", password: "rotated-pass-2" });
    await b.saveEntry({ ...base, kind: "note", spaceId: personal, title: "Google recovery codes", body: "1234 5678\n2345 6789" });
    await b.saveEntry({ ...base, kind: "key", spaceId: personal, title: "Cloudflare R2 token", keyId: "mock-key-id", secret: "mock-secret", url: "https://dash.cloudflare.com", expires: new Date(Date.now() + 12 * 86400000).toLocaleDateString("en-CA") });
    await b.saveEntry({ ...base, kind: "login", spaceId: personal, title: "Old forum", username: "you", password: "password1", url: "https://forum.example.com" });
  });
  await open("GitHub", "v2-login-2fa.png");
  await open("Cloudflare R2 token", "v2-key.png");
  await open("Google recovery codes", "v2-note.png");
  await page.locator("aside").getByText("Security").click();
  await page.waitForTimeout(300);
  await open("Old forum", "v2-security.png");
  await page.locator("aside").getByText("All items").click();
  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Generate password" }).click();
  await page.waitForTimeout(400);
  await screen(app, "v2-generator.png");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "API key" }).click();
  await page.waitForTimeout(300);
  await screen(app, "v2-form-key.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Settings" }).click();
  for (const tab of ["General", "Security", "Backup", "Import"]) {
    await page.getByRole("dialog").getByRole("tab", { name: tab }).click();
    await page.waitForTimeout(300);
    await screen(app, `v2-settings-${tab.toLowerCase()}.png`);
    if (tab === "Security") {
      await page.getByRole("dialog").getByRole("button", { name: "Test", exact: true }).click(); // Air Wall (fake: on)
      await page.waitForTimeout(300);
      await screen(app, "air-wall.png");
      await theme("dark");
      await screen(app, "air-wall-dark.png");
      await theme("classic");
    }
    if (tab === "Backup") {
      await page.getByRole("dialog").getByText("Forever Opener", { exact: true }).scrollIntoViewIfNeeded();
      await screen(app, "opener-settings.png");
      await page.getByRole("dialog").getByRole("button", { name: "Check it's genuine" }).click();
      await page.waitForTimeout(300);
      await screen(app, "opener-check.png");
      await theme("dark");
      await screen(app, "opener-check-dark.png");
      await theme("classic");
    }
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.locator("aside").getByRole("button", { name: /^NS Northwind Studio/ }).click({ button: "right" });
  await page.waitForTimeout(250);
  await screen(app, "v2-client-menu.png");
  await page.keyboard.press("Escape");

  // Held-For: the sidebar section, a person's list with its chip, and the Hand back sheet.
  await page.evaluate(async () => {
    const b = window.kapevault;
    const personal = (await b.view()).spaces.find((s) => s.kind === "personal").id;
    const base = { tags: [], favorite: false, notes: "", spaceId: personal, heldFor: "Mock Lola" };
    await b.saveEntry({ ...base, kind: "login", title: "Mock Rural Bank", username: "mock.lola", password: "x-123456", url: "https://bank.example.com" });
    await b.saveEntry({ ...base, kind: "note", title: "Mock Lola Wi-Fi", body: "Mock network" });
  });
  await page.locator("aside").getByRole("button", { name: /^ML Mock Lola/ }).click();
  await open("Mock Rural Bank", "held-for-list.png");
  await theme("dark");
  await screen(app, "held-for-list-dark.png");
  await theme("classic");
  await page.getByRole("button", { name: "Hand back", exact: true }).click();
  await page.waitForTimeout(400);
  await screen(app, "held-for-hand-back.png");
  await theme("dark");
  await screen(app, "held-for-hand-back-dark.png");
  await theme("classic");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.locator("aside").getByText("All items").click();

  // Recovery Code Ledger: running low (the Security banner + card), then the revealed grid.
  await page.evaluate(async () => {
    const b = window.kapevault;
    const id = (await b.view()).entries.find((e) => e.title === "Slack workspace").id;
    await b.setRecoveryCodes(id, ["1234 5678", "2345 6789", "3456 7890", "4567 8901", "5678 9012", "6789 0123", "7890 1234", "8901 2345", "9012 3456", "0123 4567"]);
    for (let i = 0; i < 8; i++) await b.markRecoveryCode(id, i, true);
    await b.addPaperCopy(id, "the desk drawer", "");
  });
  await open("Slack workspace", "codes-issue.png");
  await theme("dark");
  await screen(app, "codes-issue-dark.png");
  await theme("classic");
  await page.locator("section[aria-label='Backup codes']").getByRole("button", { name: "Show codes" }).click();
  await page.locator("section[aria-label='Backup codes']").scrollIntoViewIfNeeded();
  await screen(app, "codes-grid.png");
  await theme("dark");
  await screen(app, "codes-grid-dark.png");
  await theme("classic");
  // Lie Keeper: the questions card, the form group, and Hotline mode (light + dark).
  await page.evaluate(async () => {
    const b = window.kapevault;
    const personal = (await b.view()).spaces.find((s) => s.kind === "personal").id;
    const questions = [{ question: "Name of your first pet?", answer: "velvet lantern 38" }, { question: "Street you grew up on?", answer: "Mock Acacia Lane" }];
    await b.saveEntry({ tags: [], favorite: false, notes: "", kind: "login", spaceId: personal, title: "Mock Bank", username: "mock.user", password: "x-123456", url: "https://bank.example.com", questions });
  });
  await open("Mock Bank", "questions-card.png");
  await page.locator("section[aria-label='Security questions']").scrollIntoViewIfNeeded();
  await screen(app, "questions-card.png");
  await theme("dark");
  await screen(app, "questions-card-dark.png");
  await theme("classic");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Invent answer 2" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await screen(app, "questions-form.png");
  await theme("dark");
  await screen(app, "questions-form-dark.png");
  await theme("classic");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.locator("section[aria-label='Security questions']").getByRole("button", { name: "Phone call view, question 1" }).click();
  await page.waitForTimeout(600);
  await screen(app, "questions-hotline.png");
  await theme("dark");
  await screen(app, "questions-hotline-dark.png");
  await theme("classic");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Shrink Queue: a dormant account, a deletion request past its follow-up day (moved back in the vault
  // file), a tombstone; then the Closing list, the erasure email, Close this account, and Closed.
  await page.evaluate(async () => {
    const b = window.kapevault;
    const personal = (await b.view()).spaces.find((s) => s.kind === "personal").id;
    const base = { tags: [], favorite: false, notes: "", kind: "login", spaceId: personal, password: "x-123456" };
    const forum = (await b.saveEntry({ ...base, title: "Mock Old Forum", username: "mock.forum@example.com", url: "https://forum.example.com" })).id;
    const shop = (await b.saveEntry({ ...base, title: "Mock Shop", username: "mock.shop", url: "https://shop.example.com" })).id;
    const stream = (await b.saveEntry({ ...base, title: "Mock Stream", username: "mock.stream", url: "https://stream.example.com", notes: "Closed after the free trial." })).id;
    await b.setLifecycle(shop, "dormant");
    await b.setLifecycle(forum, "deletion-requested");
    await b.setLifecycle(stream, "deletion-requested");
    await b.confirmGone(stream, false);
  });
  await page.getByRole("button", { name: "Lock vault" }).click();
  await page.waitForTimeout(500);
  const vaultFile = path.join(dataDir, "vault.kapevault");
  const plain = await openFile("design kettle harbor pass orbit gazelle", JSON.parse(fs.readFileSync(vaultFile, "utf8")));
  const yesterday = new Date(new Date().setDate(new Date().getDate() - 1)).toLocaleDateString("en-CA");
  plain.data.entries.find((e) => e.title === "Mock Old Forum").lifecycle.followUpAt = yesterday;
  fs.writeFileSync(vaultFile, JSON.stringify(encryptWithKey(plain.key, plain.kdf, plain.salt, plain.data)));
  await page.getByPlaceholder("Master password").fill("design kettle harbor pass orbit gazelle");
  await page.keyboard.press("Enter");
  await page.locator("section li").first().waitFor({ timeout: 15000 });
  await page.locator("aside").getByRole("button", { name: /^Closing/ }).click();
  await open("Mock Old Forum", "closing-list.png");
  await theme("dark");
  await screen(app, "closing-list-dark.png");
  await theme("classic");
  await page.locator("section[aria-label='Closing']").getByRole("button", { name: "Show email" }).click();
  await page.waitForTimeout(500);
  await screen(app, "closing-email.png");
  await theme("dark");
  await screen(app, "closing-email-dark.png");
  await theme("classic");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.locator("aside").getByRole("button", { name: /^Closed/ }).click();
  await open("Mock Stream", "closed-tombstone.png");
  await theme("dark");
  await screen(app, "closed-tombstone-dark.png");
  await theme("classic");
  await page.locator("aside").getByText("All items").click();
  await page.locator("section li", { hasText: "GitHub" }).click();
  await page.locator("main").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Close this account..." }).click();
  await page.waitForTimeout(500);
  await screen(app, "closing-choose.png");
  await theme("dark");
  await screen(app, "closing-choose-dark.png");
  await theme("classic");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Where Is It: a thing's detail and form, the Things list, Evacuate, and the kind picker (wide + 400 px).
  await page.evaluate(async () => {
    const b = window.kapevault;
    const personal = (await b.view()).spaces.find((s) => s.kind === "personal").id;
    const thing = (title, room, spot, grab) => b.saveEntry({ tags: [], favorite: false, notes: "", kind: "thing", spaceId: personal, title, room, spot, grab });
    await thing("Passport", "Bedroom", "Blue folder, top shelf of the bedroom cabinet", 1);
    await thing("PSA birth certificate", "Bedroom", "Same blue folder, under the IDs", 1);
    await thing("Land title", "Attic", "Tin box behind the electric fan", 1);
    await thing("YubiKey", "", "On my key ring", 1);
    await thing("Spare keys", "Kitchen", "Hook by the back door", 2);
    await thing("Photo albums", "Sala", "Bottom shelf of the TV cabinet", 3);
  });
  const twice = async (name) => {
    await screen(app, `${name}.png`);
    await theme("dark");
    await screen(app, `${name}-dark.png`);
    await theme("classic");
  };
  await page.locator("aside").getByRole("button", { name: /^Things/ }).click();
  await open("Passport", "things-list.png");
  await twice("things-detail");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.waitForTimeout(500);
  await twice("things-form");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Evacuate", exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole("dialog").getByRole("checkbox", { name: "Passport", exact: true }).click();
  await page.mouse.move(0, 0);
  await twice("things-evacuate");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "New" }).click();
  await page.waitForTimeout(500);
  await twice("kind-picker-wide");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.locator("aside").getByText("All items").click();

  // Sticker Capture: a new router, the scan review, then the saved device with its label photo.
  const sticker = await renderSticker(path.join(dataDir, "mock-sticker.png"));
  const sheet = page.getByRole("dialog");
  await page.getByRole("button", { name: "New" }).click();
  await page.waitForTimeout(400);
  await sheet.getByRole("button", { name: "Device", exact: true }).click();
  await page.waitForTimeout(400);
  await twice("devices-form");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), sheet.getByRole("button", { name: "Scan a label" }).click()]);
  await chooser.setFiles(sticker);
  await sheet.getByText("Found 8 details").waitFor();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await twice("devices-scan-review");
  await sheet.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Show photo" }).click();
  await page.getByRole("button", { name: "Show the label photo larger" }).locator("img").waitFor();
  await page.locator("main .overflow-y-auto").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await twice("devices-detail");

  // IDs: the form with a photo, then the saved ID with its photo shown.
  const card = await renderIdCard(path.join(dataDir, "mock-id.png"));
  await page.getByRole("button", { name: "New" }).click();
  await page.waitForTimeout(400);
  await sheet.getByRole("button", { name: "ID", exact: true }).click();
  await sheet.locator("select").first().selectOption("Passport");
  await sheet.getByLabel("ID number", { exact: true }).fill("P1234567A");
  const [cardChooser] = await Promise.all([page.waitForEvent("filechooser"), sheet.getByRole("button", { name: /Add a photo/ }).click()]);
  await cardChooser.setFiles(card);
  await sheet.getByRole("button", { name: "Show the ID photo larger" }).waitFor();
  await page.mouse.move(0, 0);
  await twice("ids-form");
  await sheet.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Show photo" }).click();
  await page.getByRole("button", { name: "Show the ID photo larger" }).locator("img").waitFor();
  await twice("ids-detail");

  const resize = (w, h) => app.evaluate(({ BrowserWindow }, [a, c]) => BrowserWindow.getAllWindows()[0].setContentSize(a, c), [w, h]);
  await resize(780, 720);
  await open("GitHub", "v2-narrow.png");
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.waitForTimeout(400);
  await screen(app, "v2-narrow-drawer.png");
  await page.keyboard.press("Escape");
  await resize(440, 720);
  await page.waitForTimeout(300);
  await screen(app, "v2-compact-list.png");
  await open("GitHub", "v2-compact-detail.png");
  await resize(400, 720);
  await page.getByRole("button", { name: "Back to list" }).click();
  await page.getByRole("button", { name: "New" }).click();
  await page.waitForTimeout(500);
  await twice("kind-picker-400");
  await page.getByRole("dialog").getByRole("button", { name: "Thing", exact: true }).click();
  await page.waitForTimeout(300);
  await twice("things-form-400");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await resize(1440, 900);

  await app.close();

  // The Forever Opener page in a plain browser, light and dark, opening this seeded vault.
  const opener = path.join(OUT, "opener.html");
  fs.writeFileSync(opener, openerHtml(require("../package.json").version));
  const browser = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    const web = await browser.newPage({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
    web.on("pageerror", (e) => errors.push(`opener: ${e.message}`));
    await web.goto(pathToFileURL(opener).href);
    await web.screenshot({ path: path.join(OUT, `opener-unlock-${scheme}.png`) });
    await web.locator("#file").setInputFiles(path.join(dataDir, "vault.kapevault"));
    await web.getByRole("textbox", { name: "Master password" }).fill("design kettle harbor pass orbit gazelle");
    await web.keyboard.press("Enter");
    await web.getByRole("button", { name: /GHL agency login/ }).click({ timeout: 20000 });
    await web.getByRole("button", { name: /GitHub/ }).click();
    await web.getByRole("button", { name: "Show password" }).first().click();
    await web.waitForTimeout(400);
    await web.screenshot({ path: path.join(OUT, `opener-list-${scheme}.png`) });
    await web.setViewportSize({ width: 390, height: 800 });
    await web.waitForTimeout(200);
    await web.screenshot({ path: path.join(OUT, `opener-list-phone-${scheme}.png`) });
  }
  await browser.close();

  console.log(`shots in ${OUT}`, errors.length ? `errors: ${errors.join(" | ")}` : "(no page errors)");
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(sample, { recursive: true, force: true });
})().catch((e) => {
  console.log("CRASH", e.message.split("\n").slice(0, 4).join("\n"));
  process.exit(1);
});
