// End-to-end checks for the Forever Opener. In the real window: it lands beside a
// saved copy (never over someone else's file, and only trusted byte for byte), Settings > Backup saves
// it and shows its fingerprint, cloud backup keeps the real one beside the snapshots. Then the page itself, from file:// in Playwright's Chromium: a throwaway
// vault opens with its master password, secrets stay hidden until shown, JSON downloads, an old
// bovault file opens too, a field from a later version stays masked - with zero network requests and
// zero page errors.
// Run: npm run e2e. Throwaway vault, mock names only.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { chromium } = require("./playwright.cjs");
const { createHarness, shows, waitFor } = require("./e2e-harness.cjs");
const { version } = require("../package.json");
const crypto = require("node:crypto");
const { openFile, encryptWithKey } = require("../electron/vault-crypto.cjs");
const { openerHtml } = require("../electron/opener.cjs");

const SHOTS = path.join(os.tmpdir(), "kapevault-e2e-opener");
fs.mkdirSync(SHOTS, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-opener-"));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-opener-out-"));
const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-opener-other-"));
const { check, launch, report } = createHarness();
const MASTER = "mock opener kettle harbor orbit gazelle";
const PASSWORD = "Mock-Opener-Pass-7";
const OPENER = "KAPEVault Opener.html";
const OPENER_KEY = "kapevault/opener/kapevault-opener.html"; // one fixed key (audit run-1 4.8)

// A fake R2 bucket, as in e2e.cjs, that also logs every PUT.
const r2 = { objects: new Map(), modified: new Map(), puts: [] };
const r2Server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const u = new URL(req.url, "http://local");
    const key = decodeURIComponent(u.pathname.split("/").slice(2).join("/"));
    const reply = (status, body = "") => {
      res.writeHead(status, { "content-type": "application/xml" });
      res.end(body);
    };
    if (req.method === "PUT") {
      r2.puts.push(key);
      r2.objects.set(key, Buffer.concat(chunks));
      r2.modified.set(key, new Date());
      return reply(200);
    }
    if (req.method === "DELETE") {
      r2.objects.delete(key);
      return reply(204);
    }
    if (req.method === "GET" && !key) {
      const prefix = u.searchParams.get("prefix") || "";
      const items = [...r2.objects].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `<Contents><Key>${k}</Key><LastModified>${(r2.modified.get(k) ?? new Date()).toISOString()}</LastModified><Size>${v.length}</Size></Contents>`);
      return reply(200, `<ListBucketResult>${items.join("")}</ListBucketResult>`);
    }
    if (req.method === "GET" && r2.objects.has(key)) return reply(200, r2.objects.get(key));
    reply(404, "<Error><Code>NoSuchKey</Code></Error>");
  });
});
const r2Ready = new Promise((resolve) => r2Server.listen(0, "127.0.0.1", resolve));
const snapshots = () => [...r2.objects.keys()].filter((k) => k.startsWith("kapevault/snapshots/"));

(async () => {
  await r2Ready;
  const { app, page, errors } = await launch({ KAPEVAULT_DATA_DIR: dataDir, KAPEVAULT_R2_ENDPOINT: `http://127.0.0.1:${r2Server.address().port}`, KAPEVAULT_BACKUP_DELAY_MS: "400" });
  const dialog = page.getByRole("dialog");
  await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
  await page.getByPlaceholder("Confirm master password").fill(MASTER);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Nothing here yet").waitFor({ timeout: 15000 });
  await page.evaluate(async (password) => {
    const b = window.kapevault;
    const spaceId = (await b.view()).spaces[0].id;
    const base = { spaceId, tags: [], favorite: false, notes: "" };
    await b.saveEntry({ ...base, kind: "login", title: "Mock Portal", username: "mock.user@example.com", password, url: "https://portal.example.com" });
    await b.saveEntry({ ...base, kind: "note", title: "Mock gate code", body: "Mock gate 4321" });
  }, PASSWORD);

  // ---- Settings > Backup: beside a saved copy, and on its own
  await page.getByRole("button", { name: "Settings" }).click();
  await dialog.getByRole("tab", { name: "Backup" }).click();
  check("Backup shows the Forever Opener row", await shows(dialog.getByText("A page that opens your vault in any web browser", { exact: false })));
  await dialog.getByText("Forever Opener", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "opener-settings.png") });
  const saveTo = (p) => app.evaluate(({ dialog: d }, f) => { d.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, p);
  const copyPath = path.join(outDir, "mock-copy.kapevault");
  await saveTo(copyPath);
  await dialog.getByRole("button", { name: "Save encrypted copy..." }).click();
  const beside = path.join(outDir, OPENER);
  check("Save encrypted copy writes the opener beside it", await waitFor(() => fs.existsSync(copyPath) && fs.existsSync(beside)));
  check("the opener beside it is this version's", fs.existsSync(beside) && fs.readFileSync(beside, "utf8").includes(`<meta name="kapevault-opener" content="${version}">`));
  check("the note says the opener is beside it", await shows(dialog.getByText(`Saved mock-copy.kapevault, with ${OPENER} beside it.`)));

  fs.writeFileSync(path.join(otherDir, OPENER), "<p>mock page of my own</p>");
  await saveTo(path.join(otherDir, "mock-copy-2.kapevault"));
  await dialog.getByRole("button", { name: "Save encrypted copy..." }).click();
  check("a file of that name that is not an opener is moved aside (.txt) and the real Opener takes its place", (await shows(dialog.getByText("Another file had that name, so it was renamed with .txt added.", { exact: false }))) && fs.readFileSync(path.join(otherDir, OPENER), "utf8") === openerHtml(version) && fs.readdirSync(otherDir).some((f) => f.endsWith(".html.txt") && fs.readFileSync(path.join(otherDir, f), "utf8") === "<p>mock page of my own</p>"));

  const ownPath = path.join(outDir, "mock-opener.html");
  await saveTo(ownPath);
  await dialog.getByRole("button", { name: "Save Opener..." }).click();
  check("Save Opener... writes the page", await waitFor(() => fs.existsSync(ownPath) && fs.readFileSync(ownPath, "utf8").startsWith("<!doctype html>")));
  check("Save Opener... confirms it", await shows(dialog.getByText("Saved mock-opener.html. Keep it with your backups.")));

  // ---- The Opener's fingerprint, folded under "Check it's genuine"
  const sha = crypto.createHash("sha256").update(fs.readFileSync(ownPath)).digest("hex");
  check("the fingerprint starts folded away", !(await dialog.getByText(`${sha.slice(0, 8)} ${sha.slice(8, 16)}`).count()));
  await dialog.getByRole("button", { name: "Check it's genuine" }).click();
  check("Check it's genuine shows the first 16 digits of the saved page's SHA-256", await shows(dialog.getByText(`${sha.slice(0, 8)} ${sha.slice(8, 16)}`)));
  check("and moves focus to Copy", await waitFor(() => page.evaluate(() => document.activeElement?.textContent === "Copy")));
  await page.screenshot({ path: path.join(SHOTS, "opener-check.png") });
  await dialog.getByRole("button", { name: "Copy the whole code" }).click();
  check("Copy puts the whole code on the clipboard", await waitFor(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())) === sha));
  check("and says Copied", await shows(dialog.getByRole("button", { name: "Copied" })));

  // ---- Beside a copy, an opener is trusted by its bytes only
  const sameDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-opener-same-"));
  const planted = openerHtml(version).replace("</body>", "<p>mock planted line</p></body>");
  fs.writeFileSync(path.join(sameDir, OPENER), planted);
  await saveTo(path.join(sameDir, "mock-copy-3.kapevault"));
  await dialog.getByRole("button", { name: "Save encrypted copy..." }).click();
  check("a changed opener of this version is replaced with the real one", await waitFor(() => fs.readFileSync(path.join(sameDir, OPENER), "utf8") === openerHtml(version)));
  check("and the note says it is beside the copy", await shows(dialog.getByText(`Saved mock-copy-3.kapevault, with ${OPENER} beside it.`)));
  const newerDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-opener-newer-"));
  const newer = openerHtml("99.0.0").replace("</body>", "<p>mock planted line</p></body>");
  fs.writeFileSync(path.join(newerDir, OPENER), newer);
  await saveTo(path.join(newerDir, "mock-copy-4.kapevault"));
  await dialog.getByRole("button", { name: "Save encrypted copy..." }).click();
  check("one that says it is newer is replaced too (a planted 99.0.0 page must not survive)", (await shows(dialog.getByText(`Saved mock-copy-4.kapevault, with ${OPENER} beside it.`))) && fs.readFileSync(path.join(newerDir, OPENER), "utf8") === openerHtml(version) && newer !== openerHtml(version));
  await dialog.getByRole("button", { name: "Check my Opener" }).click();
  check("Check my Opener with no backup folder linked says so", await shows(dialog.getByText("No backup folder is set. Choose one under Keep a copy in a folder.")));

  // ---- Cloud backup: the opener is checked by its bytes, put back once, and never shows as a backup.
  // Someone changed the one already in the bucket.
  r2.objects.set(OPENER_KEY, Buffer.from(openerHtml(version).replace("</body>", "<p>mock planted line</p></body>")));
  await dialog.getByPlaceholder("https://<account-id>.r2.cloudflarestorage.com/<bucket>").fill("https://0123abcd.r2.cloudflarestorage.com/kapevault-e2e");
  await dialog.getByText("Access key ID").locator("..").locator("input").fill("e2e-key-id");
  await dialog.getByText("Secret access key").locator("..").locator("input").fill("e2e-secret-value");
  await dialog.getByRole("button", { name: "Connect" }).click();
  check("Connect puts the real opener back beside the first snapshot", await waitFor(() => (r2.objects.get(OPENER_KEY) ?? "").toString() === openerHtml(version) && snapshots().length === 1, 8000));
  check("the uploaded opener is the page, not vault data", (r2.objects.get(OPENER_KEY) ?? "").toString().includes('<meta name="kapevault-opener"') && !(r2.objects.get(OPENER_KEY) ?? "").toString().includes(PASSWORD));
  await dialog.getByRole("button", { name: "Back up now" }).click();
  check("the next backup does not upload it again", await waitFor(() => snapshots().length === 2) && r2.puts.filter((k) => k === OPENER_KEY).length === 1, r2.puts.join(", "));
  check("the backup list shows snapshots only", await waitFor(async () => (await dialog.getByRole("list", { name: "Backups" }).locator("li").count()) === 2));
  check("Settings says the cloud Opener was changed, replaced, and which one to trust", await shows(dialog.getByText("Someone changed the Opener in your bucket. KAPEVault put the real one back - open vaults with the Opener from your kit or a saved copy.")));
  await dialog.getByText("Someone changed the Opener in your bucket", { exact: false }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "opener-cloud-replaced.png") });
  check("no page errors (app)", errors.length === 0, errors.join(" | "));
  await app.close();
  r2Server.close();

  // ---- The page itself, from file://, in a plain browser
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const openerUrl = pathToFileURL(beside).href;
  const requests = [];
  const pageErrors = [];
  context.on("request", (r) => r.url() !== openerUrl && requests.push(r.url()));
  const web = await context.newPage();
  web.on("pageerror", (e) => pageErrors.push(e.message));
  web.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));
  await web.goto(openerUrl);
  check("the opener shows its version", await shows(web.getByText(`KAPEVault Opener ${version} - read only.`, { exact: false })));
  check("the file format is folded away", await web.getByText("AES-256-GCM with a 12-byte IV", { exact: false }).isHidden());
  await web.getByText("How this page works").click();
  check("it explains the file format", await shows(web.getByText("AES-256-GCM with a 12-byte IV", { exact: false })));

  const notVault = path.join(outDir, "mock-not-a-vault.kapevault");
  fs.writeFileSync(notVault, JSON.stringify({ format: "kapevault", version: 1, kdf: { name: "scrypt", N: 2 ** 20, r: 8, p: 1 } }));
  await web.locator("#file").setInputFiles(notVault);
  check("a file that is not a vault is refused before any work", await shows(web.getByText("That file is not a KAPEVault vault.")));
  await web.locator("#file").setInputFiles(copyPath);
  check("the chosen vault file is named", await shows(web.getByText("mock-copy.kapevault")));
  await web.getByLabel("Master password").fill("mock wrong password");
  await web.getByRole("button", { name: "Open" }).click();
  check("a wrong password says so, and nothing else", await shows(web.getByText("Wrong master password."), 20000) && (await web.locator("#vault").isHidden()));
  await web.getByLabel("Master password").fill(MASTER);
  await web.getByRole("button", { name: "Open" }).click();
  check("the right password opens the vault", await shows(web.getByRole("button", { name: /Mock Portal/ }), 20000));
  check("every item is listed", await shows(web.getByText("2 items")));
  check("the password is not in the page before it is shown", !(await web.content()).includes(PASSWORD));
  await web.getByRole("button", { name: /Mock Portal/ }).click();
  check("an item opens to its fields", await shows(web.getByText("mock.user@example.com").nth(1)));
  await web.getByRole("button", { name: "Show password" }).click();
  check("Show password reveals it", await shows(web.getByText(PASSWORD)));
  await web.screenshot({ path: path.join(SHOTS, "opener-item.png") });
  await web.getByRole("button", { name: "Hide password" }).click();
  check("Hide password masks it again", !(await web.content()).includes(PASSWORD));
  // A web page cannot keep a copy out of Win+V, so a copied secret says so; anything else just "Copied".
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await web.getByRole("button", { name: "Copy password" }).click();
  check("copying a password warns about clipboard history", await shows(web.getByText("Copied. Windows may keep it in clipboard history (Win+V).")));
  check("and the password is on the clipboard", (await web.evaluate(() => navigator.clipboard.readText())) === PASSWORD);
  await web.getByRole("button", { name: "Copy username" }).click();
  check("copying a username just says Copied", await shows(web.locator("#toast").getByText("Copied", { exact: true })));
  await web.getByLabel("Search").fill("gate");
  check("search filters the list", (await shows(web.getByText("1 item"))) && (await web.getByRole("button", { name: /Mock Portal/ }).isHidden()));
  await web.getByLabel("Search").fill("");

  await web.getByRole("button", { name: "Download everything" }).click();
  check("download warns that the JSON is not encrypted", await shows(web.getByText("This file is not encrypted")));
  const [download] = await Promise.all([web.waitForEvent("download"), web.getByRole("button", { name: "Download", exact: true }).click()]);
  const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  check("the JSON holds every item", exported.entries.length === 2 && exported.entries.some((e) => e.password === PASSWORD));

  await web.getByRole("button", { name: "Close vault" }).click();
  check("Close vault goes back to the unlock card", await shows(web.getByRole("button", { name: "Open" })));
  const oldCopy = path.join(outDir, "mock-old.bovault");
  fs.writeFileSync(oldCopy, JSON.stringify({ ...JSON.parse(fs.readFileSync(copyPath, "utf8")), format: "bovault" }));
  await web.locator("#file").setInputFiles(oldCopy);
  check("a bovault file from before the rename is accepted", await shows(web.getByText("Saved before the rename", { exact: false })));
  await web.getByLabel("Master password").fill(MASTER);
  await web.getByRole("button", { name: "Open" }).click();
  check("and opens", await shows(web.getByRole("button", { name: /Mock gate code/ }), 20000));

  // A vault from a later KAPEVault: a new kind with a field this opener has never heard of.
  const plain = await openFile(MASTER, JSON.parse(fs.readFileSync(copyPath, "utf8")));
  plain.data.entries.push({ id: "mock-future", spaceId: plain.data.spaces[0].id, kind: "router", title: "Mock router", model: "Mock AX1800", adminPin: "0917 000 1234", adminCodes: { codes: [{ code: "5555 6666", used: false }] }, tags: [], updatedAt: "2026-09-26" });
  plain.data.entries.push({
    id: "mock-codes", spaceId: plain.data.spaces[0].id, kind: "login", title: "Mock Codes Login", username: "mock.codes", tags: [], updatedAt: "2026-09-26",
    recoveryCodes: { codes: [{ code: "9876 5432", used: false }, { code: "8765 4321", used: true }], setAt: "2026-09-26", paper: [{ where: "the desk drawer", printedAt: "2026-09-01", outdatedAt: "2026-09-26" }] },
  });
  plain.data.entries[plain.data.entries.length - 1].questions = [{ question: "Mock first pet?", answer: "mock velvet otter 38" }];
  plain.data.entries[plain.data.entries.length - 1].lifecycle = { state: "deletion-requested", requestedAt: "2026-09-26", followUpAt: "2026-10-26" };
  plain.data.entries.push({ id: "mock-payee", spaceId: plain.data.spaces[0].id, kind: "payee", title: "Mock Tita Rosa GCash", who: "Mock Tita Rosa", provider: "GCash", number: "09171234567", confirmedAt: "2026-09-12", heldFor: "Mock Lola", tags: [], updatedAt: "2026-09-26" });
  plain.data.entries.push({ id: "mock-thing", spaceId: plain.data.spaces[0].id, kind: "thing", title: "Mock Passport", room: "Mock Bedroom", spot: "Mock blue folder, top shelf", grab: 1, tags: [], updatedAt: "2026-09-26" });
  // A device with its label photo: a real little JPEG, made in the browser.
  const photo = await web.evaluate(async () => {
    const canvas = new OffscreenCanvas(160, 100);
    const g = canvas.getContext("2d");
    g.fillStyle = "#d8d4c8";
    g.fillRect(0, 0, 160, 100);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg" })).arrayBuffer());
    return `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}`;
  });
  plain.data.entries.push({ id: "mock-device", spaceId: plain.data.spaces[0].id, kind: "device", title: "Mock Home Router", type: "router", model: "Mock AX10", ssid: "Mock_Home_2.4G", adminUrl: "192.168.0.1", adminUser: "admin", adminPassword: "mock-admin-77", wifiPassword: "mockwifi-4821", photo, tags: [], updatedAt: "2026-09-26" });
  plain.data.entries.push({ id: "mock-due", spaceId: plain.data.spaces[0].id, kind: "due", title: "Mock SSS contribution", agency: "sss", schedule: { every: "month", day: 31 }, nextDue: "2026-10-31", amount: "1,500", viaEntryId: "mock-codes", receipts: [{ paidAt: "2026-09-26", dueDate: "2026-09-30", reference: "MOCK-PRN-0001", amount: "1,500" }], tags: [], updatedAt: "2026-09-26" });
  plain.data.genHistory = [{ value: "Mock-Generated-Pass-77", at: "2026-10-09T04:00:00.000Z" }]; // the generator's recent values
  const future = path.join(outDir, "mock-future.kapevault");
  fs.writeFileSync(future, JSON.stringify(encryptWithKey(plain.key, plain.kdf, plain.salt, plain.data)));
  await web.getByRole("button", { name: "Close vault" }).click();
  await web.locator("#file").setInputFiles(future);
  await web.getByLabel("Master password").fill(MASTER);
  await web.getByRole("button", { name: "Open" }).click();
  await web.getByRole("button", { name: /Mock router/ }).click({ timeout: 20000 });
  check("a field from a later version shows under its own name", await shows(web.getByText("Admin pin")));
  check("and stays masked until shown", !(await web.content()).includes("0917 000 1234") && (await shows(web.getByRole("button", { name: "Show admin pin" }))));
  await web.getByRole("button", { name: /Mock Tita Rosa GCash/ }).click();
  check("an old vault's payee (a kind since removed) still reads plainly", (await shows(web.getByText("09171234567"))) && (await shows(web.getByText("Confirmed by call"))));
  await web.getByRole("button", { name: /Mock Passport/ }).click();
  check("a thing's room, spot and grab priority read plainly", (await shows(web.getByText("Mock blue folder, top shelf"))) && (await shows(web.getByText("Mock Bedroom"))) && (await shows(web.getByText("Grab first"))));
  await web.getByRole("button", { name: /Mock Home Router/ }).click();
  check("a device's sticker fields read plainly", (await shows(web.getByText("Mock_Home_2.4G"))) && (await shows(web.getByText("Mock AX10", { exact: true }))) && (await shows(web.getByText("Router", { exact: true }))));
  check("its admin and Wi-Fi passwords stay masked until shown", !(await web.content()).includes("mock-admin-77") && !(await web.content()).includes("mockwifi-4821") && (await shows(web.getByRole("button", { name: "Show Wi-Fi password" }))) && (await shows(web.getByRole("button", { name: "Show admin password" }))));
  const labelPhoto = web.locator("img[alt='Label photo']");
  check("the label photo is hidden like the passwords", !(await labelPhoto.count()) && !(await web.locator(".field-value", { hasText: "data:image" }).count()));
  await web.getByRole("button", { name: "Show label photo" }).click();
  check("Show draws it as a picture, not as text", (await shows(labelPhoto)) && (await labelPhoto.evaluate((img) => img.complete && img.naturalWidth === 160)));
  await web.getByRole("button", { name: "Show the label photo larger" }).click();
  check("a click shows the photo larger", (await web.getByRole("button", { name: "Show the label photo larger" }).getAttribute("aria-pressed")) === "true");
  await web.getByRole("button", { name: "Show Wi-Fi password" }).click();
  check("Show reveals the Wi-Fi password only", (await shows(web.getByText("mockwifi-4821"))) && !(await web.content()).includes("mock-admin-77"));
  await web.getByRole("button", { name: /Mock SSS contribution/ }).click();
  check("a due date from an old backup still reads plainly: agency, next date, schedule, payments, website login", (await shows(web.locator(".field-value", { hasText: "SSS" }).first())) && (await shows(web.getByText("2026-10-31"))) && (await shows(web.getByText("Every month, by the last day"))) && (await shows(web.getByText("MOCK-PRN-0001, amount 1,500, for 2026-09-30"))) && (await shows(web.locator(".field-value", { hasText: "Mock Codes Login" }))));
  // Backup codes: nested secrets. An opener that does not know a nested field masks every part of it.
  check("a nested field from a later version stays masked, codes and all", !(await web.content()).includes("5555 6666") && (await shows(web.getByRole("button", { name: "Show admin codes - codes 1 - code" }))));
  await web.getByRole("button", { name: /Mock Codes Login/ }).click();
  check("backup codes: the count and the paper copy read plainly", (await shows(web.getByText("1 of 2 left, set 2026-09-26"))) && (await shows(web.getByText("the desk drawer, printed 2026-09-01"))) && (await shows(web.getByText("Printed copy (out of date)"))));
  check("every backup code is masked until shown", !(await web.content()).includes("9876 5432") && !(await web.content()).includes("8765 4321") && (await shows(web.getByText("Backup code 2 (used)"))));
  await web.getByRole("button", { name: "Show backup code 1" }).click();
  check("Show reveals that one code only", (await shows(web.getByText("9876 5432"))) && !(await web.content()).includes("8765 4321"));
  check("a security question reads plainly, its answer is masked", (await shows(web.getByText("Mock first pet?"))) && !(await web.content()).includes("mock velvet otter 38"));
  await web.getByRole("button", { name: "Show answer 1" }).click();
  check("Show reveals the answer", await shows(web.getByText("mock velvet otter 38")));
  check("an account being closed says so plainly", await shows(web.getByText("Asked to delete 2026-09-26 (follow up 2026-10-26)")));
  check("who an item is held for reads plainly", (await shows(web.locator(".field-label", { hasText: "Held for" }))) && (await shows(web.locator(".field-value", { hasText: "Mock Lola" }))));
  // Generated passwords sit beside the items, not in one: the page shows them as one more item, masked.
  await web.getByRole("button", { name: /Generated passwords/ }).click();
  check("generated passwords: every value is masked until shown", !(await web.content()).includes("Mock-Generated-Pass-77") && (await shows(web.getByRole("button", { name: /^Show generated/ }))));
  await web.getByRole("button", { name: /^Show generated/ }).first().click();
  check("Show reveals that one value", await shows(web.getByText("Mock-Generated-Pass-77")));
  // Scrolled to the bottom, the list heading stays in the sticky block, drawn on top of the list.
  await web.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const headingOnTop = await web.locator("#list-title").evaluate((h) => {
    const box = h.getBoundingClientRect();
    return window.scrollY > 0 && box.top >= 0 && document.elementFromPoint(box.left + 4, box.top + box.height / 2) === h;
  });
  check("scrolled down, the list heading is never hidden behind the search bar", headingOnTop);

  check("the page made zero network requests", requests.length === 0, requests.join(", "));
  check("no page errors (opener)", pageErrors.length === 0, pageErrors.join(" | "));
  await browser.close();

  for (const dir of [dataDir, outDir, otherDir, sameDir, newerDir]) fs.rmSync(dir, { recursive: true, force: true });
  process.exitCode = report() ? 0 : 1;
})().catch((e) => {
  report();
  console.log("CRASH:", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(1);
});
