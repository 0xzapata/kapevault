// End-to-end checks for Where Is It: the thing kind through the form (title and room
// suggestions, grab priority), the Things list, search by room and spot, the detail, Evacuate (order,
// ticks, close), the printed grab list, and the New item kind picker at the widest and the narrowest
// window - every kind still creatable. Part of npm run e2e. Throwaway vault, mock names only.
// Page screenshots (light + dark) in %TEMP%\kapevault-e2e-v2.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHarness, shows, gone, clip, opened, waitFor } = require("./e2e-harness.cjs");

const SHOTS = path.join(os.tmpdir(), "kapevault-e2e-v2");
fs.mkdirSync(SHOTS, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-things-"));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-things-out-"));
const { check, launch, report } = createHarness();
const MASTER = "mock kettle harbor pass";
const KINDS = ["Login", "Secure note", "API key", "File link", "Payee", "Thing", "Device", "ID"];

(async () => {
  const { app, page, errors } = await launch({ KAPEVAULT_DATA_DIR: dataDir });
  const dialog = page.getByRole("dialog");
  const aside = page.locator("aside[aria-label='Vault navigation']");
  const search = page.locator("[data-search]:visible").first();
  const rows = page.locator("section[aria-label='Items'] li[class='group']");
  const picker = dialog.getByRole("group", { name: "Kind of item" });
  const tile = (name) => picker.getByRole("button", { name, exact: true });
  const field = (label) => dialog.getByText(label, { exact: true }).locator("..").locator("input");
  const resize = (w, h) => app.evaluate(({ BrowserWindow }, [a, b]) => BrowserWindow.getAllWindows()[0].setContentSize(a, b), [w, h]).then(() => page.waitForTimeout(300));
  const theme = (t) => page.evaluate((name) => window.kapevault.setSettings({ theme: name }), t).then(() => page.waitForTimeout(400));
  const shot = async (name) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    await theme("dark");
    await page.screenshot({ path: path.join(SHOTS, `${name}-dark.png`) });
    await theme("classic");
  };
  const tops = async () => Promise.all(KINDS.map(async (k) => Math.round((await tile(k).boundingBox()).y)));

  await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
  await page.getByPlaceholder("Confirm master password").fill(MASTER);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Nothing here yet").waitFor({ timeout: 15000 });
  await resize(1440, 900);
  check("no Things list before there is a thing", !(await aside.getByText("Things", { exact: true }).isVisible()));

  // ---- The kind picker, wide: even rows of tiles, one Tab stop, arrow keys choose
  await page.getByRole("button", { name: "New" }).click();
  await page.waitForTimeout(400);
  check("the picker offers every kind", (await picker.getByRole("button").count()) === KINDS.length && (await shows(tile("Thing"))));
  check("wide: two rows of four", new Set(await tops()).size === 2 && (await tile("Payee").boundingBox()).x === (await tile("Login").boundingBox()).x);
  check("one Tab stop: only the chosen kind is tabbable", (await picker.locator("button[tabindex='0']").count()) === 1 && (await tile("Login").getAttribute("tabindex")) === "0");
  await tile("Login").focus();
  await page.keyboard.press("ArrowRight");
  check("ArrowRight chooses the next kind and moves focus", (await tile("Secure note").getAttribute("aria-pressed")) === "true" && (await tile("Secure note").evaluate((b) => b === document.activeElement)));
  await page.keyboard.press("End");
  check("End chooses the last kind (ID)", (await tile("ID").getAttribute("aria-pressed")) === "true" && (await shows(dialog.getByRole("button", { name: /Add a photo/ }))));
  await page.keyboard.press("ArrowRight");
  check("the arrows wrap around to the first kind", (await tile("Login").getAttribute("aria-pressed")) === "true");
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowLeft"); // ID, Device, Thing, Payee
  await page.waitForTimeout(100);
  check("arrowing onto Payee keeps focus on the picker (not its Who field)", (await tile("Payee").getAttribute("aria-pressed")) === "true" && (await tile("Payee").evaluate((b) => b === document.activeElement)));
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(100);
  check("and off it again", (await tile("Thing").getAttribute("aria-pressed")) === "true" && (await tile("Thing").evaluate((b) => b === document.activeElement)));
  await shot("things-picker-wide");
  await tile("Thing").click();

  // ---- A thing through the form: suggestions, validation, grab priority
  check("the title suggests common things", (await dialog.locator("datalist option[value='Passport']").count()) === 1 && (await dialog.locator("datalist option[value='PSA birth certificate']").count()) === 1);
  check("a thing has no logo picker", !(await dialog.getByText("Logo", { exact: true }).isVisible()));
  check("grab priority starts at If there is time", (await dialog.getByRole("radio", { name: "If there is time" }).getAttribute("aria-checked")) === "true");
  await dialog.getByPlaceholder("Passport").fill("Mock Passport");
  await dialog.getByRole("button", { name: "Save" }).click();
  check("a thing needs its spot", await shows(dialog.getByText("Say where it is kept.")));
  await field("Room (optional)").fill("Mock Bedroom");
  await field("Where exactly").fill("Mock blue folder, top shelf of the cabinet");
  await dialog.getByRole("radio", { name: "Grab first" }).click();
  await shot("things-form");
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  const main = page.locator("main");
  check("the detail shows the thing", (await shows(main.locator("h1", { hasText: "Mock Passport" }))) && (await shows(main.getByText("Thing ·", { exact: false }))));
  check("room, spot and grab priority are on the card", (await shows(main.getByText("Mock Bedroom"))) && (await shows(main.getByText("Mock blue folder, top shelf of the cabinet"))) && (await shows(main.getByText("Grab first"))));
  await main.getByRole("button", { name: "Copy spot" }).first().click();
  check("Copy spot copies where it is", await waitFor(async () => (await clip(app)) === "Mock blue folder, top shelf of the cabinet"));
  check("the Things list appears once there is a thing", await shows(aside.getByText("Things", { exact: true })));
  await shot("things-detail");

  // ---- An ID's expiry: under More options, on the card, and flagged like a key's but with its own advice
  const inTenDays = new Date(Date.now() + 10 * 86400000).toLocaleDateString("en-CA"); // local, like the app
  check("a thing with no expiry shows no Expires row", !(await main.getByText("Expires", { exact: true }).isVisible()));
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const expires = dialog.getByLabel("Expires (optional)");
  check("a thing's expiry waits under More options", !(await expires.isVisible()));
  await dialog.getByRole("button", { name: "More options" }).click();
  await expires.fill(inTenDays);
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  check("the card shows when it expires", (await shows(main.getByText("Expires", { exact: true }))) && (await shows(main.getByText("(in 10 days)"))));
  check("an expiring ID is flagged", await shows(main.getByRole("region", { name: "Security issue" }).getByText("Expires in 10 days")));
  check("its advice is to renew it where it was issued", await shows(main.getByText("Renew it where it was issued, then update the date here.")));
  check("its fix is the date, not a password", await shows(main.getByRole("button", { name: "Update date" })));
  await shot("things-expiring");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  check("a saved expiry opens More options by itself", (await shows(expires)) && (await expires.inputValue()) === inTenDays);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await gone(dialog);

  await page.getByRole("button", { name: "New" }).click();
  await tile("Thing").click();
  check("rooms already used are suggested", (await dialog.locator("datalist option[value='Mock Bedroom']").count()) === 1);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await gone(dialog);

  await page.evaluate(async () => {
    const b = window.kapevault;
    const spaceId = (await b.view()).spaces[0].id;
    const thing = (title, room, spot, grab) => b.saveEntry({ kind: "thing", spaceId, title, room, spot, grab, tags: [], favorite: false, notes: "" });
    await thing("Mock Land title", "Mock Attic", "tin box behind the <b>fan</b>", 1);
    await thing("Mock YubiKey", "", "on my key ring", 1);
    await thing("Mock Spare keys", "Mock Kitchen", "hook by the back door", 2);
    await thing("Mock Photo albums", "Mock Sala", "bottom shelf", 3);
    await thing("Mock PSA birth certificate", "mock bedroom", "same blue folder", 1);
  });

  // ---- The Things list and search
  await aside.getByRole("button", { name: /^Things/ }).click();
  check("Things lists every thing", (await shows(page.locator("h2", { hasText: "Things" }))) && (await waitFor(async () => (await rows.count()) === 6)));
  check("a row says the room and the spot", await shows(rows.filter({ hasText: "Mock Kitchen · hook by the back door" })));
  await shot("things-list");
  await search.fill("mock attic");
  check("search finds by room", await waitFor(async () => (await rows.count()) === 1) && (await shows(rows.filter({ hasText: "Mock Land title" }))));
  await search.fill("key ring");
  check("search finds by spot", await waitFor(async () => (await rows.count()) === 1) && (await shows(rows.filter({ hasText: "Mock YubiKey" }))));
  check("Evacuate hides while searching", !(await page.getByRole("button", { name: "Evacuate", exact: true }).isVisible()));
  await search.fill("");

  // ---- Evacuate: grab order, ticks in memory only, close
  await page.getByRole("button", { name: "Evacuate", exact: true }).click();
  const evac = page.getByRole("dialog", { name: "Evacuate" });
  check("Evacuate opens full-window", await shows(evac.getByRole("heading", { name: "Evacuate" })));
  const order = await evac.locator("section li").evaluateAll((lis) => lis.map((li) => li.querySelector("span.block.text-\\[19px\\]")?.textContent));
  check(
    "sorted by grab priority, then room (none last), then title",
    JSON.stringify(order) === JSON.stringify(["Mock Land title", "Mock Passport", "Mock PSA birth certificate", "Mock YubiKey", "Mock Spare keys", "Mock Photo albums"]),
    order.join(", "),
  );
  check("each thing shows its spot", await shows(evac.getByText("tin box behind the <b>fan</b>")));
  check("things to leave have no tick", (await evac.getByRole("checkbox").count()) === 5 && !(await evac.getByRole("checkbox", { name: "Mock Photo albums" }).count()));
  check("the counter starts at 0 of 5", await shows(evac.getByText("0 of 5 packed")));
  const described = await evac.getByRole("checkbox", { name: "Mock Passport" }).evaluate((b) => b.getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id)?.textContent).join(", "));
  check("a tick is read with its room and spot, not the title alone", described === "Mock Bedroom, Mock blue folder, top shelf of the cabinet", described);
  await evac.getByRole("checkbox", { name: "Mock Passport" }).click();
  await evac.getByRole("checkbox", { name: "Mock YubiKey" }).click();
  check("a tick marks it packed", (await evac.getByRole("checkbox", { name: "Mock Passport" }).getAttribute("aria-checked")) === "true" && (await shows(evac.getByText("2 of 5 packed"))));
  await evac.getByRole("checkbox", { name: "Mock YubiKey" }).click();
  check("a second tick takes it back", (await evac.getByRole("checkbox", { name: "Mock YubiKey" }).getAttribute("aria-checked")) === "false" && (await shows(evac.getByText("1 of 5 packed"))));
  await evac.getByRole("checkbox", { name: "Mock YubiKey" }).focus();
  await page.keyboard.press("Space");
  check("Space ticks from the keyboard", (await evac.getByRole("checkbox", { name: "Mock YubiKey" }).getAttribute("aria-checked")) === "true");
  await evac.getByRole("checkbox", { name: "Mock Spare keys" }).focus();
  await page.keyboard.press("Tab");
  check("Tab goes round inside Evacuate", await evac.getByRole("button", { name: "Done" }).evaluate((b) => b === document.activeElement));
  await page.keyboard.press("Shift+Tab");
  check("and Shift+Tab back to the last tick", await evac.getByRole("checkbox", { name: "Mock Spare keys" }).evaluate((b) => b === document.activeElement));
  await evac.getByRole("heading", { name: "Evacuate" }).scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await shot("things-evacuate");
  await evac.getByRole("button", { name: "Done" }).click();
  check("Done closes it", await gone(evac));
  await page.getByRole("button", { name: "Evacuate", exact: true }).click();
  check("ticks are not saved: reopened, nothing is packed", await shows(evac.getByText("0 of 5 packed")));
  for (const name of ["Mock Passport", "Mock Land title", "Mock PSA birth certificate", "Mock YubiKey", "Mock Spare keys"]) await evac.getByRole("checkbox", { name }).click();
  check("all ticked: everything is packed", await shows(evac.getByText("Everything is packed.")));

  // ---- Print: the grab list PDF (capture the page it is printed from, stub the save dialog)
  await app.evaluate(({ app: a }) => {
    globalThis.__printed = [];
    a.on("browser-window-created", (_e, w) => w.webContents.on("did-finish-load", () => globalThis.__printed.push(decodeURIComponent(w.webContents.getURL()))));
  });
  const printed = () => app.evaluate(() => globalThis.__printed);
  const saveTo = (p) => app.evaluate(({ dialog: d }, f) => { d.showSaveDialog = async () => (f ? { canceled: false, filePath: f } : { canceled: true }); }, p);
  await saveTo(null);
  await evac.getByRole("button", { name: "Print grab list" }).click();
  check("a cancelled save dialog writes nothing", (await evac.isVisible()) && (await printed()).length === 0);
  const typed = path.join(outDir, "mock-grab-list.cmd"); // a typed name that is not a PDF is never what gets opened
  await saveTo(typed);
  await evac.getByRole("button", { name: "Print grab list" }).click();
  const pdf = `${typed}.pdf`;
  check("Print writes the PDF, always as .pdf", (await waitFor(() => fs.existsSync(pdf) && fs.readFileSync(pdf).subarray(0, 4).toString() === "%PDF", 10000)) && !fs.existsSync(typed));
  check("and opens it, ready to print", await waitFor(async () => (await opened(app)).some(([k, p]) => k === "path" && p === pdf)));
  check("a toast names the file", await shows(page.getByRole("status").filter({ hasText: "Saved mock-grab-list.cmd.pdf" })));
  const html = (await printed()).at(-1) ?? "";
  const at = (t) => html.indexOf(t);
  check("the printout lists every thing in grab order", ["Mock Land title", "Mock Passport", "Mock PSA birth certificate", "Mock YubiKey", "Mock Spare keys", "Mock Photo albums"].every((t, i, all) => at(t) > 0 && (i === 0 || at(all[i - 1]) < at(t))));
  check("vault text is escaped on the printout", html.includes("tin box behind the &lt;b&gt;fan&lt;/b&gt;") && !html.includes("<b>fan</b>"));
  await page.keyboard.press("Escape");
  check("Escape closes Evacuate", await gone(evac));

  // ---- The narrowest window: the picker fits, and every kind can still be made
  await resize(400, 720);
  await page.getByRole("button", { name: "New" }).click();
  await page.waitForTimeout(400);
  const box = await dialog.boundingBox();
  const inside = async () => (await Promise.all(KINDS.map((k) => tile(k).boundingBox()))).every((b) => b.x >= box.x && b.x + b.width <= box.x + box.width + 0.5 && b.width >= 60);
  check("400 px: every kind tile fits inside the sheet", await inside());
  check("400 px: the tiles wrap into rows of three", new Set(await tops()).size === 3 && (await tile("API key").boundingBox()).y === (await tile("Login").boundingBox()).y);
  const labelsFit = await picker.locator("button span.truncate").evaluateAll((spans) => spans.every((s) => s.scrollWidth <= s.clientWidth));
  check("400 px: no kind name is cut off", labelsFit);
  await shot("things-picker-narrow");
  await tile("Thing").click();
  await dialog.evaluate((d) => (d.scrollTop = 220)); // the grab choices clear the sticky footer
  await shot("things-form-400");
  const grabFits = await dialog.getByRole("radiogroup", { name: "In a hurry" }).locator("button").evaluateAll((bs) => bs.every((x) => x.scrollWidth <= x.clientWidth && x.scrollHeight <= x.clientHeight + 1));
  check("400 px: every grab choice reads in full", grabFits);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await gone(dialog);

  const make = {
    Login: async () => dialog.getByPlaceholder("GitHub").fill("Mock Narrow Login"),
    "Secure note": async () => {
      await dialog.getByPlaceholder("GitHub").fill("Mock Narrow Note");
      await dialog.getByLabel("Note", { exact: true }).fill("mock body");
    },
    "API key": async () => dialog.getByPlaceholder("GitHub").fill("Mock Narrow Key"),
    "File link": async () => {
      await dialog.getByPlaceholder("GitHub").fill("Mock Narrow Link");
      await dialog.getByPlaceholder("https://drive.google.com/... or D:\\Clients\\...").fill("https://example.com/mock");
    },
    Payee: async () => {
      await dialog.getByPlaceholder("Mama", { exact: true }).fill("Mock Narrow Payee");
      await dialog.getByRole("button", { name: "GCash", exact: true }).click();
      await dialog.getByText("Account or mobile number").locator("..").locator("input").fill("09181234567");
    },
    Thing: async () => {
      await dialog.getByPlaceholder("Passport").fill("Mock Narrow Thing");
      await field("Where exactly").fill("mock drawer");
    },
    Device: async () => dialog.getByPlaceholder("Home Wi-Fi router").fill("Mock Narrow Device"),
    ID: async () => {
      await dialog.locator("select").first().selectOption("Passport");
      await dialog.getByLabel("Title (optional)").fill("Mock Narrow ID");
    },
  };
  for (const kind of KINDS) {
    await page.getByRole("button", { name: "New" }).click();
    await page.waitForTimeout(300);
    await tile(kind).click();
    await make[kind]();
    await dialog.getByRole("button", { name: "Save" }).click();
    check(`400 px: a new ${kind} saves`, await gone(dialog));
    await page.getByRole("button", { name: "Back to list" }).click({ timeout: 3000 }).catch(() => {});
  }
  const kinds = await page.evaluate(async () => (await window.kapevault.view()).entries.filter((e) => e.title.startsWith("Mock Narrow")).map((e) => e.kind).sort());
  check("each landed as its own kind", JSON.stringify(kinds) === JSON.stringify(["device", "id", "key", "link", "login", "note", "payee", "thing"]), kinds.join(","));
  await resize(1440, 900);

  // ---- The last thing gone: the Things row and list go
  await aside.getByRole("button", { name: /^Things/ }).click();
  await page.evaluate(async () => {
    const b = window.kapevault;
    for (const e of (await b.view()).entries.filter((x) => x.kind === "thing")) await b.deleteEntry(e.id);
  });
  check("no things left: the Things row goes and the list falls back to All items", (await gone(aside.getByText("Things", { exact: true }))) && (await shows(page.locator("h2", { hasText: "All items" }))));

  check("no page errors", errors.length === 0, errors.join(" | "));
  await app.close();
  for (const dir of [dataDir, outDir]) fs.rmSync(dir, { recursive: true, force: true });
  process.exitCode = report() ? 0 : 1;
})().catch((e) => {
  report();
  console.log("CRASH:", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(1);
});
