// Component harness: renders real components (EntryForm, and the modal fixtures) on the Vite dev server with a fake
// window.kapevault (stub.ts), then clicks through scenarios in Playwright at 400x560 and 1440x900.
// Use it when App.tsx is mid-rebuild or to test a component fast. Run: node scripts/component-harness/run.mjs
// Shots land in scripts/component-harness/shots (gitignored). Swap main.tsx to mount another component.
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const slash = (p) => p.replaceAll("\\", "/");
const HERE = slash(path.dirname(fileURLToPath(import.meta.url)));
const PROJECT = slash(path.resolve(HERE, "../..")); // the checkout this script sits in, so a worktree tests itself
const MODULES = slash(realpathSync(PROJECT + "/node_modules")); // a worktree links the main checkout's
const req = createRequire(PROJECT + "/package.json");
const { createServer } = await import(pathToFileURL(req.resolve("vite")).href);
const { chromium } = createRequire(import.meta.url)("../playwright.cjs");

const server = await createServer({
  configFile: PROJECT + "/vite.config.ts",
  root: PROJECT,
  cacheDir: HERE + "/.vite-cache",
  logLevel: "error",
  resolve: { dedupe: ["react", "react-dom", "@phosphor-icons/react"] },
  server: { port: 1499, strictPort: false, hmr: false, fs: { allow: [PROJECT, HERE, MODULES] } },
});
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@fs/${HERE}/main.tsx"></script></body></html>`;

const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " - " + extra : ""}`);

const browser = await chromium.launch();
async function open(scenario, width, height, ready = (page) => page.getByRole("dialog")) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => results.push("PAGEERROR " + e.message));
  page.on("console", (m) => m.type() === "error" && results.push("CONSOLE " + m.text()));
  await page.route(base + "/harness.html*", (r) => r.fulfill({ contentType: "text/html", body: html }));
  await page.goto(`${base}/harness.html?s=${scenario}`);
  await ready(page).waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
  return page;
}
const noOverflow = (page) =>
  page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const wide = [...d.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > d.getBoundingClientRect().right + 0.5 && el.getClientRects().length);
    return { page: document.documentElement.scrollWidth <= innerWidth, dialog: d.scrollWidth <= d.clientWidth, wide: wide.slice(0, 5).map((el) => el.outerHTML.slice(0, 90)) };
  });
const shot = (page, name) => page.screenshot({ path: `${HERE}/shots/${name}.png` });

// The sheet is a modal: the app behind is inert, Tab and Shift+Tab go round inside
{
  const page = await open("new", 1440, 900);
  const inDialog = () => page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")));
  check("sheet: focus starts inside, the app behind is inert", (await inDialog()) && (await page.locator("[data-behind]").evaluate((b) => b.closest("[inert]") !== null)));
  let inside = true;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(i < 20 ? "Tab" : "Shift+Tab");
    inside = inside && (await inDialog());
  }
  check("sheet: Tab and Shift+Tab never leave it", inside);
  await page.close();
}

// What Tab reaches (src/lib/focus.ts): every stop in order and nothing else; an audio's own controls
// come before Tab goes back round (a preview's media was unreachable, Tab wrapped at Close preview)
const activeName = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a?.getAttribute("aria-label") ?? (a?.textContent?.trim() || a?.tagName);
  });
{
  const page = await open("modal", 1440, 900);
  const stops = await page.evaluate(() => window.__tabStops());
  const want = ["First", "Link", "Zero", "Editable", "More", "Radio one", "Frame", "Audio"];
  check("tab stops: every reachable control, in order, and nothing else", JSON.stringify(stops) === JSON.stringify(want), JSON.stringify(stops));
  await page.getByRole("button", { name: "First" }).focus();
  const seen = [];
  for (let i = 0; i < 20 && seen.at(-1) !== "First"; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(30);
    seen.push(await activeName(page));
  }
  check("tab: the audio's controls are reachable, then Tab comes round to the first control", seen.includes("Audio") && seen.at(-1) === "First" && !seen.includes("BODY"), seen.join(" > "));
  await page.keyboard.press("Shift+Tab");
  check("shift+tab from the first control goes to the audio", (await activeName(page)) === "Audio");

  // The app behind stays inert as it changes: a sibling mounted after the sheet opened is inert too,
  // but a sheet opened over it is not (it takes over, and makes this one inert in turn)
  await page.evaluate(() => window.__showLate());
  await page.locator("[data-late]").waitFor();
  await page.waitForTimeout(50);
  check("inert: a sibling mounted while the sheet is open is inert", await page.locator("[data-late]").evaluate((b) => b.closest("[inert]") !== null));
  await page.evaluate(() => window.__openSecond());
  const second = page.getByRole("dialog", { name: "Second" });
  await second.waitFor();
  await page.waitForTimeout(100);
  check(
    "inert: a sheet opened over it takes the focus and the first goes inert",
    (await second.evaluate((d) => d.closest("[inert]") === null && d.contains(document.activeElement))) &&
      (await page.getByRole("dialog", { name: "Fixture" }).evaluate((d) => d.closest("[inert]") !== null)),
  );
  // The photo viewer portals to body and makes all of #root inert: the toast region must not be in it
  await page.evaluate(() => window.__openPhoto());
  await page.getByRole("dialog", { name: "Label photo" }).waitFor();
  await page.waitForTimeout(100);
  check("inert: toasts are still announced while the photo viewer is open", await page.locator("[aria-live]").first().evaluate((r) => r.closest("[inert]") === null));
  await page.close();
}

// Closing a sheet whose opener is gone never drops the focus on <body> (returnFocus, src/lib/focus.ts)
{
  const page = await open("return", 1440, 900, (p) => p.getByRole("button", { name: "Actions" }));
  const sheetGone = () => page.getByRole("dialog").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Open sheet" }).click();
  await page.keyboard.press("Escape");
  await sheetGone();
  check("return: a sheet opened from a menu hands focus to what had it before the menu", (await activeName(page)) === "Actions");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await sheetGone();
  check("return: the opener remounted meanwhile, its replacement (same data-focus-key) gets it", (await activeName(page)) === "Edit");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Remove" }).click();
  await sheetGone();
  check("return: the opener is gone for good, the data-focus-home gets it", (await activeName(page)) === "Home list");

  // ConfirmDelete: Cancel, or a confirm that did not delete, unmounts the focused button - the quiet
  // Delete takes the focus back
  const quietDelete = page.getByRole("button", { name: "Delete", exact: true });
  await quietDelete.click();
  await page.getByRole("button", { name: "Cancel" }).click();
  check("confirm delete: Cancel hands focus back to Delete", (await activeName(page)) === "Delete");
  await quietDelete.click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await quietDelete.waitFor();
  check("confirm delete: a delete that did not happen hands focus back to Delete", (await activeName(page)) === "Delete");

  // With a password step (a kept copy of a vault): the field takes the focus, Confirm waits for it,
  // and a refused delete keeps the step open with the field emptied and focused
  const removeCopy = page.getByRole("button", { name: "Delete copy" });
  await removeCopy.click();
  const copyPw = page.getByLabel("Its master password");
  const focusedPw = () => copyPw.evaluate((el) => el === document.activeElement);
  check("password delete: the password field takes the focus", await focusedPw());
  check("password delete: Confirm waits for a password", await page.getByRole("button", { name: "Confirm delete" }).isDisabled());
  await copyPw.fill("mock wrong pass");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => (window.__tried ?? []).length === 1);
  await page.waitForTimeout(50);
  check("password delete: Enter confirms with the typed password", (await page.evaluate(() => window.__tried)).join() === "mock wrong pass");
  check("password delete: refused, the step stays with the field empty and focused", (await copyPw.inputValue()) === "" && (await focusedPw()));
  await page.getByRole("button", { name: "Cancel" }).click();
  check("password delete: Cancel hands focus back to its quiet button", (await activeName(page)) === "Delete copy");
  await page.close();
}

for (const [w, h] of [[400, 560], [1440, 900]]) {
  const page = await open("new", w, h);
  const dialog = page.getByRole("dialog");
  for (const k of ["Login", "Secure note", "API key", "File link"]) {
    await dialog.getByRole("button", { name: k, exact: true }).click();
    const o = await noOverflow(page);
    check(`${w}px ${k}: no overflow`, o.page && o.dialog && o.wide.length === 0, JSON.stringify(o.wide));
    await shot(page, `${w}-${k.replace(" ", "-")}`);
  }
  await dialog.getByRole("button", { name: "Login", exact: true }).click();
  await dialog.getByPlaceholder("GitHub").fill("Test");
  const pw = dialog.getByText("Password", { exact: true }).locator("..").locator("input");
  await pw.fill("abc");
  await page.waitForTimeout(250);
  check(`${w}px meter label shows`, await dialog.getByText("Very weak").isVisible());
  await dialog.getByRole("button", { name: "Generate password" }).click();
  const pop = page.getByRole("group", { name: "Password generator" });
  await pop.waitFor();
  await page.waitForTimeout(300);
  const box = await pop.boundingBox();
  check(`${w}px popover inside window`, box.x >= 0 && box.y >= 0 && box.x + box.width <= w && box.y + box.height <= h, JSON.stringify(box));
  await shot(page, `${w}-generator`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  check(`${w}px Escape closes popover only`, (await pop.count()) === 0 && (await page.getByRole("dialog").count()) === 1);
  check(`${w}px focus back on Generate`, await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Generate password"));
  await dialog.getByRole("button", { name: "Generate password" }).click();
  await pop.getByRole("switch", { name: "Symbols" }).click();
  await pop.getByLabel("Length").fill("32");
  const preview = await pop.locator("p.font-mono").innerText();
  check(`${w}px options apply (32, no symbols)`, preview.length === 32 && /^[A-Za-z0-9]+$/.test(preview), preview);
  await pop.getByRole("button", { name: "Use password" }).click();
  check(`${w}px use fills + shows`, (await pw.inputValue()) === preview && (await pw.getAttribute("type")) === "text");
  check(`${w}px options persisted`, await page.evaluate(() => JSON.parse(localStorage.getItem("kapevault.generator")).length === 32));
  await dialog.getByRole("button", { name: "Generate password" }).click();
  await dialog.getByPlaceholder("https://", { exact: true }).click();
  check(`${w}px outside click closes`, (await pop.count()) === 0);
  // 2FA
  const totp = dialog.getByLabel("2FA setup key");
  await totp.fill("nonsense");
  await totp.blur();
  await page.waitForTimeout(100);
  check(`${w}px 2FA blur error`, await dialog.getByText("That is not a valid 2FA setup key.").isVisible());
  await dialog.getByRole("button", { name: "Scan QR code" }).click();
  check(`${w}px scanning label`, await dialog.getByRole("button", { name: "Scanning..." }).isVisible());
  await dialog.getByText("Found: GitHub (me)").waitFor();
  check(`${w}px scan fills`, (await totp.inputValue()).startsWith("otpauth://"));
  await shot(page, `${w}-login-filled`);
  // Ctrl+Enter submits, Saving... shows
  await totp.press("Control+Enter");
  check(`${w}px Saving... while busy`, await dialog.getByRole("button", { name: "Saving..." }).isDisabled());
  await page.waitForFunction(() => window.__saved.length === 1);
  const saved = await page.evaluate(() => window.__saved[0]);
  check(`${w}px saved login input`, saved.kind === "login" && saved.password === preview && saved.totp.startsWith("otpauth://"), JSON.stringify(saved));
  await page.close();
}

// Edit login: stored password loads, 2FA set-up row, history note, removal, error text
{
  const page = await open("login", 400, 560);
  const dialog = page.getByRole("dialog");
  const pw = dialog.getByText("Password", { exact: true }).locator("..").locator("input");
  check("edit loads stored password", (await pw.inputValue()) === "old-password-1");
  check("2FA set up row", await dialog.getByText("2FA code is set up").isVisible());
  check("no history note before change", (await dialog.getByText("The old password moves to Password history.").count()) === 0);
  await pw.fill("new-password-2");
  check("history note after change", await dialog.getByText("The old password moves to Password history.").isVisible());
  await dialog.getByRole("button", { name: "Remove" }).click();
  check("remove state", await dialog.getByText("2FA code will be removed when you save.").isVisible());
  await shot(page, "400-edit-login");
  await dialog.getByPlaceholder("GitHub").fill("bad");
  await dialog.getByRole("button", { name: "Save" }).click();
  await dialog.getByText("That is not a valid 2FA setup key.").waitFor();
  check("validation error stripped of IPC prefix", true);
  await dialog.getByPlaceholder("GitHub").fill("locked");
  await dialog.getByRole("button", { name: "Save" }).click();
  await dialog.getByText(/Could not save/).waitFor();
  check("generic error for locked", true);
  await dialog.getByPlaceholder("GitHub").fill("GitHub");
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.waitForFunction(() => window.__saved.length === 1);
  const saved = await page.evaluate(() => window.__saved[0]);
  check("removed 2FA sends empty string", saved.totp === "" && saved.password === "new-password-2", JSON.stringify(saved));
  await page.close();
}
// Every kind's fields feed the same save: what a kind switch keeps, the checks in order, each kind's input
{
  const page = await open("new", 1440, 900);
  const dialog = page.getByRole("dialog");
  const kindTile = (name) => dialog.getByRole("group", { name: "Kind of item" }).getByRole("button", { name, exact: true });
  const save = async () => {
    await dialog.getByRole("button", { name: "Save" }).click();
    await page.waitForFunction((n) => window.__saved.length === n, (await page.evaluate(() => window.__saved.length)) + 1);
    return page.evaluate(() => window.__saved.at(-1));
  };
  await dialog.getByText("Username or email").locator("..").locator("input").fill("mock.user");
  await dialog.getByPlaceholder("https://", { exact: true }).fill("https://mock.example.com");
  await kindTile("API key").click();
  check("kinds: a login's website is the API key's link", (await dialog.getByLabel("Link", { exact: true }).inputValue()) === "https://mock.example.com");
  await kindTile("Login").click();
  check("kinds: back on Login, the username is still there", (await dialog.getByText("Username or email").locator("..").locator("input").inputValue()) === "mock.user");

  await kindTile("Payee").click();
  await dialog.getByRole("button", { name: "Save" }).click();
  check("payee: who comes first", await dialog.getByText("Add who this payee is.").isVisible());
  await dialog.getByPlaceholder("Mama", { exact: true }).fill("Mock Tita");
  await dialog.getByRole("button", { name: "Save" }).click();
  check("payee: then where the money goes", await dialog.getByText("Pick where the money goes.").isVisible());
  await dialog.getByRole("button", { name: "GCash", exact: true }).click();
  await dialog.getByText("Account or mobile number").locator("..").locator("input").fill("09171234567");
  let saved = await save();
  check("payee: saved untitled as who + provider", saved.kind === "payee" && saved.title === "Mock Tita GCash" && saved.who === "Mock Tita" && saved.provider === "GCash" && saved.number === "09171234567" && saved.password === undefined, JSON.stringify(saved));

  await kindTile("Thing").click();
  await dialog.getByPlaceholder("Passport", { exact: true }).fill("Mock Passport");
  await dialog.getByRole("button", { name: "Save" }).click();
  check("thing: a spot is needed", await dialog.getByText("Say where it is kept.").isVisible());
  await dialog.getByPlaceholder("Blue folder, top shelf of the cabinet").fill("Mock drawer");
  await dialog.getByRole("radio", { name: "Grab first" }).click();
  saved = await save();
  check("thing: room, spot and grab saved", saved.kind === "thing" && saved.spot === "Mock drawer" && saved.grab === 1 && saved.room === "", JSON.stringify(saved));

  await kindTile("File link").click();
  await dialog.getByPlaceholder(/drive.google.com/).fill("https://drive.example.com/mock");
  await dialog.getByPlaceholder("GitHub").fill("Mock folder");
  saved = await save();
  check("link: type and location saved", saved.kind === "link" && saved.linkType === "web" && saved.location === "https://drive.example.com/mock" && saved.title === "Mock folder", JSON.stringify(saved));
  await page.close();
}

// Picking the kind already chosen changes nothing: a typed 2FA key and a question were dropped from the
// save while their boxes still showed them. Switching away and back empties both, box and save alike.
{
  const page = await open("new", 1440, 900);
  const dialog = page.getByRole("dialog");
  const loginTile = dialog.getByRole("group", { name: "Kind of item" }).getByRole("button", { name: "Login", exact: true });
  await dialog.getByPlaceholder("GitHub").fill("Mock 2FA");
  await dialog.getByLabel("2FA setup key").fill("JBSWY3DPEHPK3PXP");
  await dialog.getByRole("button", { name: "Add question" }).click();
  await dialog.getByLabel("Question 1", { exact: true }).fill("Mock pet?");
  await dialog.getByLabel("Answer 1", { exact: true }).fill("Mock answer");
  await loginTile.click();
  await loginTile.press("Home");
  const kept = await dialog.getByLabel("2FA setup key").inputValue();
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.waitForFunction(() => window.__saved.length === 1);
  let saved = await page.evaluate(() => window.__saved[0]);
  check("same kind again: the 2FA key and the question still show and are saved", kept === "JBSWY3DPEHPK3PXP" && saved.totp === kept && saved.questions?.[0]?.answer === "Mock answer", JSON.stringify(saved));

  await dialog.getByRole("group", { name: "Kind of item" }).getByRole("button", { name: "Secure note", exact: true }).click();
  await loginTile.click();
  const box = await dialog.getByLabel("2FA setup key").inputValue();
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.waitForFunction(() => window.__saved.length === 2);
  saved = await page.evaluate(() => window.__saved[1]);
  check("away and back: the 2FA box is empty and nothing of it is saved", box === "" && saved.totp === undefined && saved.questions === undefined, JSON.stringify(saved));
  await page.close();
}

// Tile pickers: reopened, the Tab stop is the chosen tile again (not the one last arrowed to), and
// Escape on a tile closes only the picker (it closed the whole unsaved form)
{
  const page = await open("new", 1440, 900);
  const dialog = page.getByRole("dialog");
  const logoToggle = dialog.getByRole("button", { name: /^Auto: / });
  await logoToggle.click();
  await page.keyboard.press("Tab");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  const moved = await activeName(page);
  await logoToggle.click(); // Close
  await logoToggle.click(); // Change
  await page.keyboard.press("Tab");
  check("roving: reopened, Tab lands on the chosen tile, not the last one arrowed to", moved !== "Auto-detect" && (await activeName(page)) === "Auto-detect", moved);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check("logo picker: Escape on a tile closes only the picker", (await dialog.count()) === 1 && (await dialog.getByPlaceholder("Search logos").count()) === 0 && /^Auto: /.test(await activeName(page)));

  await dialog.getByRole("group", { name: "Kind of item" }).getByRole("button", { name: "Payee", exact: true }).click();
  await dialog.getByRole("button", { name: "GCash", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check("wallet picker: Escape on a tile closes only the picker", (await dialog.count()) === 1 && (await dialog.getByLabel("Search wallets and banks").count()) === 0);
  await page.close();
}

// Single-choice groups are radio groups with one Tab stop; the arrows, Home and End choose (useRovingTiles)
{
  const page = await open("new", 1440, 900);
  const dialog = page.getByRole("dialog");
  const signIn = dialog.getByRole("radiogroup", { name: "Sign in with" });
  const checked = (group) => group.locator("[aria-checked=true]").innerText();
  check("sign in with: one Tab stop, on the chosen method", (await signIn.locator("[tabindex='0']").count()) === 1 && (await signIn.getByRole("radio", { name: "Password" }).getAttribute("tabindex")) === "0");
  await signIn.getByRole("radio", { name: "Password" }).focus();
  await page.keyboard.press("End");
  const last = await checked(signIn);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  check("sign in with: End, Home and the arrows choose as they move", last === "Company SSO" && (await checked(signIn)) === "Google" && (await activeName(page)) === "Google", last);
  await dialog.getByRole("group", { name: "Kind of item" }).getByRole("button", { name: "Thing", exact: true }).click();
  const hurry = dialog.getByRole("radiogroup", { name: "In a hurry" });
  await hurry.getByRole("radio", { name: "If there is time" }).focus();
  await page.keyboard.press("ArrowLeft");
  check("in a hurry: the arrows choose", (await checked(hurry)) === "Grab first" && (await activeName(page)) === "Grab first");
  await page.close();
}

// Locked while the stored password loads: no uncaught error, the field stays empty, Save keeps the saved one
{
  const before = results.length;
  const page = await open("locked", 400, 560);
  const dialog = page.getByRole("dialog");
  await page.waitForTimeout(300);
  check("locked mid-edit: the failed load throws nothing", !results.slice(before).some((r) => r.startsWith("PAGEERROR") || r.startsWith("CONSOLE")), results.slice(before).join(" | "));
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.waitForFunction(() => window.__saved.length === 1);
  const saved = await page.evaluate(() => window.__saved[0]);
  check("locked mid-edit: Save sends no password, so the saved one stays", saved.password === undefined, JSON.stringify(saved));
  await page.close();
}
{
  const page = await open("note", 400, 560);
  const dialog = page.getByRole("dialog");
  check("note body loads", (await dialog.getByLabel("Note").inputValue()) === "stored note body");
  const o = await noOverflow(page);
  check("note edit no overflow", o.page && o.dialog && o.wide.length === 0, JSON.stringify(o.wide));
  await shot(page, "400-edit-note");
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.waitForFunction(() => window.__saved.length === 1);
  const saved = await page.evaluate(() => window.__saved[0]);
  check("note saves body", saved.kind === "note" && saved.body === "stored note body", JSON.stringify(saved));
  await page.close();
}
{
  const page = await open("key", 400, 560);
  const dialog = page.getByRole("dialog");
  const secret = dialog.getByText("Secret", { exact: true }).locator("..").locator("input");
  check("key secret loads masked", (await secret.inputValue()) === "sk_live_stored" && (await secret.getAttribute("type")) === "password");
  await dialog.getByRole("button", { name: "Show secret" }).click();
  check("show secret", (await secret.getAttribute("type")) === "text");
  await dialog.getByRole("button", { name: "No expiry" }).click();
  await shot(page, "400-edit-key");
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.waitForFunction(() => window.__saved.length === 1);
  const saved = await page.evaluate(() => window.__saved[0]);
  check("key saves", saved.kind === "key" && saved.secret === "sk_live_stored" && saved.expires === "" && saved.keyId === "pk_live_123", JSON.stringify(saved));
  await page.close();
}
// Popover flips above when the field sits near the bottom
{
  const page = await open("new", 1440, 900);
  await page.setViewportSize({ width: 700, height: 560 });
  const dialog = page.getByRole("dialog");
  const pwBox = dialog.locator("label").filter({ has: page.getByText("Password", { exact: true }) }).filter({ has: page.locator("input") });
  await dialog.evaluate((d) => (d.scrollTop = 0));
  await pwBox.evaluate((el) => {
    const d = el.closest('[role="dialog"]');
    d.scrollTop = el.offsetTop - d.clientHeight + 120; // field near the bottom edge
  });
  await dialog.getByRole("button", { name: "Generate password" }).click();
  await page.waitForTimeout(300);
  const pop = await page.getByRole("group", { name: "Password generator" }).boundingBox();
  const field = await pwBox.locator("input").boundingBox();
  check("popover flips above near bottom", pop.y + pop.height <= field.y + 1 && pop.y >= 0, JSON.stringify({ pop, field }));
  await shot(page, "700-flip");
  await page.close();
}

await browser.close();
await server.close();
console.log(results.join("\n"));
