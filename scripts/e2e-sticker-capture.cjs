// End-to-end checks for Sticker Capture: the device kind through the form (type
// fields first, More details, validation), "Scan a label" with the fake OCR (pick and paste into the
// review: from-label hints, nothing saved until Save), the detail (reveal/copy the Wi-Fi password,
// open the admin page, the label photo hidden until shown, then large), an empty device's Scan a label, every device type,
// search, the Devices list, and main refusing to copy a photo. Part of npm run e2e. Throwaway vault,
// fake OCR (KAPEVAULT_OCR_FAKE), mock names only. Page screenshots (light + dark) in %TEMP%\kapevault-e2e-v2.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHarness, shows, gone, clip, opened, waitFor } = require("./e2e-harness.cjs");
const { renderSticker } = require("./mock-sticker.cjs");

const SHOTS = path.join(os.tmpdir(), "kapevault-e2e-v2");
fs.mkdirSync(SHOTS, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-devices-"));
const { check, launch, report } = createHarness();
const MASTER = "mock kettle harbor pass";

(async () => {
  const sticker = await renderSticker(path.join(dataDir, "mock-sticker.png"));
  const { app, page, errors } = await launch({ KAPEVAULT_DATA_DIR: dataDir, KAPEVAULT_OCR_FAKE: "label" });
  const dialog = page.getByRole("dialog", { name: /item/ });
  const aside = page.locator("aside[aria-label='Vault navigation']");
  const main = page.locator("main");
  const search = page.locator("[data-search]:visible").first();
  const rows = page.locator("section[aria-label='Items'] li[class='group']");
  // A field by the start of its label: the label also holds the "from label" hint once a scan filled it.
  const labelled = (label) => dialog.locator("label").filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`) });
  const input = (label) => labelled(label).locator("input");
  const hint = (label) => labelled(label).getByText("from label", { exact: true });
  const typeButton = (name) => dialog.getByRole("radiogroup", { name: "Type" }).getByRole("radio", { name, exact: true });
  const ocr = (mode) => app.evaluate((_e, m) => (process.env.KAPEVAULT_OCR_FAKE = m), mode); // main reads it on every scan
  const view = () => page.evaluate(() => window.kapevault.view());
  const devices = async () => (await view()).entries.filter((e) => e.kind === "device");
  const theme = (t) => page.evaluate((name) => window.kapevault.setSettings({ theme: name }), t).then(() => page.waitForTimeout(400));
  const shot = async (name) => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    await theme("dark");
    await page.screenshot({ path: path.join(SHOTS, `${name}-dark.png`) });
    await theme("classic");
  };
  const newDevice = async () => {
    await page.getByRole("button", { name: "New" }).click();
    await dialog.getByRole("group", { name: "Kind of item" }).getByRole("button", { name: "Device", exact: true }).click();
  };
  const pickPhoto = async (button) => {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }), button.click()]);
    await chooser.setFiles(sticker);
  };

  await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
  await page.getByPlaceholder("Confirm master password").fill(MASTER);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Nothing here yet").waitFor({ timeout: 15000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  check("no Devices list before there is a device", !(await aside.getByText("Devices", { exact: true }).isVisible()));

  // ---- The form: the scan card first, then the type and the fields that type needs
  await newDevice();
  check("the kind picker offers Device", await shows(dialog.getByRole("button", { name: "Scan a label" })));
  check("a new device starts as a router", (await typeButton("Router").getAttribute("aria-checked")) === "true");
  check(
    "a router asks for Wi-Fi and admin details first",
    (await shows(input("Wi-Fi name"))) && (await shows(input("Wi-Fi password"))) && (await shows(input("Admin page"))) && (await shows(input("Admin username"))) && (await shows(input("Admin password"))),
  );
  check("model, serial, IMEI and MAC wait under More details", !(await input("Model").isVisible()) && !(await input("IMEI").isVisible()));
  await dialog.getByRole("button", { name: "More details" }).click();
  check("More details shows the rest", (await shows(input("Model"))) && (await shows(input("MAC address"))) && (await shows(input("IMEI"))));
  check("and the focus lands in the first of them", await input("Model").evaluate((el) => el === document.activeElement));
  await typeButton("Phone").click();
  check("a phone asks for IMEI and serial first", (await shows(input("IMEI"))) && (await input("IMEI").getAttribute("placeholder")) === "Dial *#06# to see it");
  await typeButton("Router").click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await gone(dialog);

  // ---- Scan a label: pick a photo -> the review (fields filled, "from label") -> nothing saved until Save
  await newDevice();
  await shot("devices-form");
  await pickPhoto(dialog.getByRole("button", { name: "Scan a label" }));
  check("the scan says what it found", await shows(dialog.getByText("Found 8 details")));
  check("and asks to check it against the photo", await shows(dialog.getByText("Check each one against the photo.")));
  check("the photo is kept as a thumbnail", await shows(dialog.getByRole("button", { name: "Show the label photo larger" })));
  check("the title is made from the label", (await input("Title").inputValue()) === "TP-Link Archer C6" && (await shows(hint("Title"))));
  check(
    "every read value is filled in with a from-label hint",
    (await input("Wi-Fi name").inputValue()) === "Mock_Home_2.4G" && (await input("Wi-Fi password").inputValue()) === "mockwifi-4821" && (await input("Admin page").inputValue()) === "http://tplinkwifi.net" && (await shows(hint("Wi-Fi password"))) && (await shows(hint("Admin page"))),
  );
  check("details under More details open when the scan filled them", (await input("MAC address").inputValue()) === "50:C7:BF:12:34:56" && (await input("Serial number").inputValue()) === "2231MOCK09876");
  check("the Wi-Fi password is hidden until shown", (await input("Wi-Fi password").getAttribute("type")) === "password");
  await dialog.getByRole("button", { name: "Show Wi-Fi password" }).click();
  check("Show turns it to text", (await input("Wi-Fi password").getAttribute("type")) === "text");
  check("the type shows it came from the label", await shows(dialog.getByRole("radiogroup", { name: "Type" }).locator("..").getByText("from label", { exact: true })));
  await input("Admin username").fill("mockadmin");
  check("editing a value drops its hint", !(await hint("Admin username").count()) && (await hint("Admin password").count()) === 1);
  check("nothing is saved before Save", (await devices()).length === 0);
  await dialog.getByRole("button", { name: "Show the label photo larger" }).click();
  const viewer = page.getByRole("dialog", { name: "Label photo" });
  check("the photo opens large, in the app", (await shows(viewer.locator("img"))) && (await viewer.locator("img").evaluate((img) => img.naturalWidth > 600)));
  await page.keyboard.press("Escape");
  check("Escape closes only the photo; the form stays", (await gone(viewer)) && (await dialog.isVisible()));
  await dialog.evaluate((d) => (d.scrollTop = 0));
  await shot("devices-scan-review");
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);

  // ---- The detail
  const [router] = await devices();
  check("saved as a router with every field", router?.type === "router" && router.ssid === "Mock_Home_2.4G" && router.mac === "50:C7:BF:12:34:56" && router.adminUser === "mockadmin" && router.hasWifiPassword && router.hasAdminPassword && router.hasPhoto);
  check("the page never holds the passwords or the photo", !JSON.stringify(await view()).includes("mockwifi-4821") && !JSON.stringify(await view()).includes("data:image"));
  check("the detail says Router and shows the TP-Link logo", (await shows(main.getByText("Router ·", { exact: false }))) && (await shows(main.locator("img[data-brand='tp-link']"))));
  check("the Wi-Fi name reads plainly, both passwords are masked", (await shows(main.getByText("Mock_Home_2.4G", { exact: true }))) && !(await main.getByText("mockwifi-4821").count()) && !(await main.getByText("mock-admin-77").count()));
  const wifiRow = main.locator("div.border-b", { hasText: "Wi-Fi password" });
  await wifiRow.getByRole("button", { name: "Reveal" }).click();
  check("Reveal shows the Wi-Fi password only", (await shows(main.getByText("mockwifi-4821"))) && !(await main.getByText("mock-admin-77").count()));
  await main.getByRole("button", { name: "Copy Wi-Fi password", exact: true }).click();
  check("the Copy Wi-Fi password pill copies it", await waitFor(async () => (await clip(app)) === "mockwifi-4821"));
  await main.locator("div.border-b", { hasText: "Admin password" }).getByRole("button", { name: "Copy admin password (clears in 30s)" }).click();
  check("the admin password copies from its row", await waitFor(async () => (await clip(app)) === "mock-admin-77"));
  await main.getByRole("button", { name: "Open admin page" }).click();
  check("Open admin page opens the router's page", await waitFor(async () => (await opened(app)).some(([k, u]) => k === "external" && u === "http://tplinkwifi.net/")));
  const thumb = main.getByRole("button", { name: "Show the label photo larger" });
  check("the label photo is hidden like the passwords (it shows them)", (await shows(main.getByRole("button", { name: "Show photo" }))) && !(await thumb.count()));
  await main.getByRole("button", { name: "Show photo" }).click();
  check("Show photo shows it under the card", (await shows(thumb.locator("img"))) && (await thumb.locator("img").evaluate((img) => img.naturalWidth > 0)));
  await shot("devices-detail");
  await thumb.click();
  check("a click shows it large", await shows(viewer.locator("img")));
  await shot("devices-photo-large");
  await viewer.getByRole("button", { name: "Close photo" }).click();
  check("Close photo closes it", await gone(viewer));
  check("a photo is never copied", await page.evaluate((id) => window.kapevault.copySecret(id, "photo").then(() => false, () => true), router.id));

  // ---- The Devices list, search, the keyboard
  check("the Devices list appears once there is a device", await shows(aside.getByText("Devices", { exact: true })));
  await aside.getByRole("button", { name: /^Devices/ }).click();
  check("a row says the type and the model", await shows(rows.filter({ hasText: "Router · Archer C6" })));
  await search.fill("50:C7:BF");
  check("search finds a device by its MAC", await waitFor(async () => (await rows.count()) === 1));
  await search.fill("wifi");
  check("\"wifi\" finds the router", await waitFor(async () => (await rows.count()) === 1));
  await search.fill("");
  await rows.first().click();
  await page.keyboard.press("Control+Shift+C");
  check("Ctrl+Shift+C copies the Wi-Fi password", await waitFor(async () => (await clip(app)) === "mockwifi-4821"));

  // ---- Paste a photo (Ctrl+V) into a device being typed by hand: only empty fields are filled
  await newDevice();
  await input("Wi-Fi name").fill("Mock_Typed_Name");
  // A real OS clipboard image, as a screenshot tool leaves it.
  await app.evaluate(({ clipboard, ClipboardItem }, png) => clipboard.write([new ClipboardItem({ "image/png": new Blob([Buffer.from(png, "base64")], { type: "image/png" }) })]), fs.readFileSync(sticker).toString("base64"));
  await input("Title").fill("Mock Office Router");
  await input("Title").focus();
  await page.keyboard.press("Control+V");
  check("Ctrl+V with a photo on the clipboard scans it", (await shows(dialog.getByText("Found 8 details"))) && (await shows(dialog.getByRole("button", { name: "Show the label photo larger" }))));
  check("a typed title and Wi-Fi name are kept", (await input("Title").inputValue()) === "Mock Office Router" && (await input("Wi-Fi name").inputValue()) === "Mock_Typed_Name" && !(await hint("Wi-Fi name").count()));
  check("empty fields are filled", (await input("Wi-Fi password").inputValue()) === "mockwifi-4821");
  await dialog.getByRole("button", { name: "Remove photo" }).click();
  check("Remove photo brings back Scan a label", await shows(dialog.getByRole("button", { name: "Scan a label" })));
  await ocr("blank");
  await pickPhoto(dialog.getByRole("button", { name: "Scan a label" }));
  check("a photo with nothing readable says so in one line", (await shows(dialog.getByText("No details found"))) && (await shows(dialog.getByText("Type them in below."))));
  await ocr("unavailable");
  await pickPhoto(dialog.getByRole("button", { name: "Scan again" }));
  check("no OCR on this PC: says so, keeps the photo", (await shows(dialog.getByText("This PC can't read text from photos. Type the details below."))) && (await shows(dialog.getByRole("button", { name: "Show the label photo larger" }))));
  await ocr("label");
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  const office = (await devices()).find((d) => d.title === "Mock Office Router");
  check("saved with the typed values and the photo", office?.ssid === "Mock_Typed_Name" && office.hasWifiPassword && office.hasPhoto);

  // ---- Edit keeps the stored secrets and photo; Remove photo removes it
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  check(
    "editing keeps the saved photo hidden like the passwords, not even loaded",
    (await shows(dialog.getByRole("button", { name: "Show photo" }))) && !(await dialog.locator("img[alt='Label photo']").count()),
  );
  await dialog.getByRole("button", { name: "Show photo" }).click();
  const formThumb = dialog.getByRole("button", { name: "Show the label photo larger" });
  check("Show photo loads it into the form, and it takes the focus", (await shows(formThumb.locator("img"))) && (await formThumb.evaluate((b) => b === document.activeElement)));
  await input("Title").fill("Mock Office Router 2");
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  const edited = (await devices()).find((d) => d.title === "Mock Office Router 2");
  check("an edit keeps both passwords and the photo", edited?.hasWifiPassword && edited.hasPhoto && (await page.evaluate((id) => window.kapevault.getSecret(id, "wifiPassword"), edited.id)) === "mockwifi-4821");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.getByRole("button", { name: "Remove photo" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  check("Remove photo + Save drops the photo", !(await devices()).find((d) => d.id === edited.id).hasPhoto);

  // ---- An empty device: one button, Scan a label, straight into the review
  await page.evaluate(async () => {
    const b = window.kapevault;
    await b.saveEntry({ kind: "device", spaceId: (await b.view()).spaces[0].id, title: "Mock Garage Camera", type: "cctv", tags: [], favorite: false, notes: "" });
  });
  await rows.filter({ hasText: "Mock Garage Camera" }).click();
  check("an empty device offers Scan a label", (await shows(main.getByText("Nothing from the sticker yet"))) && (await shows(main.getByRole("button", { name: "Scan a label" }))));
  await shot("devices-empty");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }), main.getByRole("button", { name: "Scan a label" }).click()]);
  check("it opens the edit form and the photo picker at once", await shows(page.getByRole("dialog", { name: "Edit item" })));
  await chooser.setFiles(sticker);
  check("the scan lands in the review", await shows(dialog.getByText("Found 8 details")));
  check("a title already given is kept", (await input("Title").inputValue()) === "Mock Garage Camera");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await gone(dialog);
  check("Cancel saves nothing", (await devices()).find((d) => d.title === "Mock Garage Camera").hasPhoto === false);

  // ---- Every type, with the fields it asks for; IMEI is checked
  const make = {
    "CCTV / NVR": async () => {
      await input("Admin page").fill("192.168.1.64");
      await input("Serial number").fill("DS-MOCK0001");
    },
    Phone: async () => {
      await input("IMEI").fill("356789101234564");
      await dialog.getByRole("button", { name: "Save" }).click();
      check("a mistyped IMEI is refused in plain words", await shows(dialog.getByText("IMEI has a mistyped digit. Check it against the box.")));
      await input("IMEI").fill("35 678910 123456 3");
    },
    Laptop: async () => {
      await dialog.getByRole("button", { name: "More details" }).click();
      await input("MAC address").fill("50-C7-BF");
      await dialog.getByRole("button", { name: "Save" }).click();
      check("a short MAC address is refused in plain words", await shows(dialog.getByText("MAC address must be 12 letters and numbers (0-9, A-F).")));
      await input("MAC address").fill("");
      await input("Serial number").fill("MOCKLAPTOP1");
    },
    Other: async () => input("Model").fill("Mock Printer 1"),
  };
  for (const [type, fill] of Object.entries(make)) {
    await newDevice();
    await typeButton(type).click();
    await input("Title").fill(`Mock ${type}`);
    await fill();
    await dialog.getByRole("button", { name: "Save" }).click();
    check(`a ${type} saves`, await gone(dialog));
  }
  const byTitle = async (t) => (await devices()).find((d) => d.title === t);
  check("each landed as its type", (await byTitle("Mock CCTV / NVR"))?.type === "cctv" && (await byTitle("Mock Phone"))?.imei === "356789101234563" && (await byTitle("Mock Laptop"))?.type === "laptop" && (await byTitle("Mock Other"))?.type === "other");
  await rows.filter({ hasText: "Mock Phone" }).click();
  check("a phone's detail offers Copy IMEI", await shows(main.getByRole("button", { name: "Copy IMEI" })));
  check("a device of type Other is called Device", (await rows.filter({ hasText: "Mock Other" }).innerText()).includes("Device · Mock Printer 1"));

  // ---- The narrowest window: the review still reads in full
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(400, 720));
  await page.waitForTimeout(300);
  await newDevice();
  await pickPhoto(dialog.getByRole("button", { name: "Scan a label" }));
  await shows(dialog.getByText("Found 8 details"));
  const typesFit = await dialog.getByRole("radiogroup", { name: "Type" }).locator("button").evaluateAll((bs) => bs.every((b) => b.scrollWidth <= b.clientWidth && b.scrollHeight <= b.clientHeight + 1));
  check("400 px: every type reads in full", typesFit);
  const box = await dialog.boundingBox();
  const inside = async (loc) => {
    const b = await loc.boundingBox();
    return b.x >= box.x && b.x + b.width <= box.x + box.width + 0.5;
  };
  check("400 px: the photo row and its buttons fit", (await inside(dialog.getByRole("button", { name: "Remove photo" }))) && (await inside(dialog.getByText("Check each one against the photo."))));
  await dialog.evaluate((d) => (d.scrollTop = 200));
  await shot("devices-review-400");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await gone(dialog);

  check("no page errors", errors.length === 0, errors.join(" | "));
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = report() ? 0 : 1;
})().catch((e) => {
  report();
  console.log("CRASH:", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(1);
});
