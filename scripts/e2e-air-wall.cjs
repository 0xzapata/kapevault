// End-to-end checks for Air Wall (Settings > Security) in every state, driven by the test-only
// KAPEVAULT_AIRWALL_FAKE (no UAC prompt, no firewall change, no network), and for the opt-in update
// check (Settings > General) driven by KAPEVAULT_UPDATE_FAKE. Part of npm run e2e.
// The courier itself (R2 through the system curl) is proved by the cloud checks in e2e.cjs.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHarness, shows, gone } = require("./e2e-harness.cjs");

const SHOTS = path.join(os.tmpdir(), "kapevault-e2e-v2");
fs.mkdirSync(SHOTS, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-airwall-"));
const { check, launch: launchWith, report } = createHarness();
const MASTER = "mock kettle harbor pass orbit gazelle";
const SWITCH = "Keep KAPEVault offline";

(async () => {
  // Opens the vault (creating it on the first launch). "Settings" is exact: the Air Wall notice's
  // "Open Settings" button would match it too.
  async function unlock(fake) {
    const run = await launchWith({ KAPEVAULT_DATA_DIR: dataDir, ...(fake && { KAPEVAULT_AIRWALL_FAKE: fake }) });
    const { page } = run;
    await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
    if (await page.getByPlaceholder("Confirm master password").isVisible()) await page.getByPlaceholder("Confirm master password").fill(MASTER);
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor({ timeout: 15000 });
    return run;
  }
  // ...and Settings > Security.
  async function openSecurity(fake) {
    const run = await unlock(fake);
    await run.page.getByRole("button", { name: "Settings", exact: true }).click();
    await run.page.getByRole("dialog").getByRole("tab", { name: "Security" }).click();
    return { ...run, dialog: run.page.getByRole("dialog") };
  }
  const NOTICE = "Keep KAPEVault offline protects another copy of the app.";
  const toggle = (dialog, checked) => dialog.getByRole("switch", { name: SWITCH, checked });
  const testButton = (dialog) => dialog.getByRole("button", { name: "Test", exact: true });

  // ---- Off -> Test gets through -> switch on -> Test is blocked -> switch off
  let { app, page, errors, dialog } = await openSecurity("off");
  check("Air Wall row shows, switched off", await shows(toggle(dialog, false)));
  check("no 'another copy' notice while Air Wall is simply off", (await page.getByText(NOTICE, { exact: false }).count()) === 0);
  check("the row says cloud backup still works", await shows(dialog.getByText("Cloud backup still works.", { exact: false })));
  check("status says off", await shows(dialog.getByText("Not blocked", { exact: true })));
  await testButton(dialog).click();
  check("Test while off: it got through", await shows(dialog.getByRole("status").filter({ hasText: "It got through." })));
  await toggle(dialog, false).click();
  check("switching on turns Air Wall on", await shows(toggle(dialog, true)));
  check("status says Windows blocks this app", await shows(dialog.getByText("Blocked by Windows", { exact: true })));
  check("an old test answer is cleared when the rule changes", await gone(dialog.getByText("It got through.")));
  await testButton(dialog).click();
  check("Test while on: Windows blocked it", await shows(dialog.getByRole("status").filter({ hasText: "Windows blocked it." })));
  await page.screenshot({ path: path.join(SHOTS, "air-wall-on.png") });
  await toggle(dialog, true).click();
  check("switching off turns Air Wall off", await shows(toggle(dialog, false)) && (await shows(dialog.getByText("Not blocked", { exact: true }))));
  check("no page errors (off/on)", errors.length === 0, errors.join(" | "));
  await app.close();

  // ---- A rule left for another copy of the app: said outside Settings on unlock, then fixed there
  ({ app, page, errors } = await unlock("other"));
  check("on unlock, a rule for another copy is announced outside Settings", await shows(page.getByText(NOTICE, { exact: false })));
  await page.getByRole("button", { name: "Open Settings" }).click();
  dialog = page.getByRole("dialog");
  check("Open Settings lands on Security with the Air Wall switch", await shows(toggle(dialog, false)));
  check("a rule for another copy is named as such", await shows(dialog.getByText("Set for another copy of KAPEVault")));
  check("it shows which copy and how to move it", await shows(dialog.getByText("turn on to use this copy", { exact: false })));
  await toggle(dialog, false).click();
  check("switching on moves the rule to this copy", await shows(dialog.getByText("Blocked by Windows", { exact: true })));
  check("no page errors (other)", errors.length === 0, errors.join(" | "));
  await app.close();

  // ---- The rule is there but Windows Firewall is off (a third-party firewall, or turned off)
  ({ app, page, errors, dialog } = await openSecurity("unenforced"));
  check("a rule the firewall does not enforce is not called on", await shows(dialog.getByText("Windows Firewall is off", { exact: true })));
  check("the switch still shows the rule, so it can be removed", await shows(toggle(dialog, true)));
  await testButton(dialog).click();
  check("Test there: it got through, check the firewall", await shows(dialog.getByRole("status").filter({ hasText: "Turn on Windows Firewall." })));
  check("no page errors (unenforced)", errors.length === 0, errors.join(" | "));
  await app.close();

  // ---- No fake: an unpacked run is electron.exe, never a rule target
  ({ app, page, errors, dialog } = await openSecurity(null));
  check("an unpacked run says only the installed app can be walled off", await shows(dialog.getByText("Works only in the installed app.")));
  check("the switch is disabled there", await toggle(dialog, false).isDisabled());
  check("and there is no Test button", (await testButton(dialog).count()) === 0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "How KAPEVault protects you" }).click();
  check("the trust page explains Air Wall", await shows(page.getByRole("dialog").getByText("Windows can keep KAPEVault offline")));
  check("no page errors (unpacked)", errors.length === 0, errors.join(" | "));
  await app.close();

  // ---- Check for updates (Settings > General), with KAPEVAULT_UPDATE_FAKE standing in for GitHub. Each run
  // gets its own folder: an answer is remembered for a day, so a second launch would not ask again.
  const UPDATES = "Check for updates";
  async function openUpdates(fake) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-updates-"));
    const run = await launchWith({ KAPEVAULT_DATA_DIR: dir, KAPEVAULT_UPDATE_FAKE: fake });
    const { page } = run;
    await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
    await page.getByPlaceholder("Confirm master password").fill(MASTER);
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("dialog").getByRole("tab", { name: "General" }).click();
    return { ...run, dir, dialog: page.getByRole("dialog") };
  }
  const updateSwitch = (dialog, checked) => dialog.getByRole("switch", { name: UPDATES, checked });

  let up = await openUpdates("newer");
  check("Check for updates is there and off by default", await shows(updateSwitch(up.dialog, false)));
  check("its helper line says what is asked and what is not sent", await shows(up.dialog.getByText("Asks GitHub once a day whether a newer KAPEVault is out. Nothing about your vault is sent.")));
  check("off: no release line, no failure line", (await up.dialog.getByText(/is out$|Could not check|Up to date/).count()) === 0);
  await updateSwitch(up.dialog, false).click();
  check("switching on shows a newer release", await shows(up.dialog.getByText(/^KAPEVault \d+\.\d+\.\d+ is out$/)));
  await up.dialog.getByRole("button", { name: "See what is new" }).click();
  const links = await up.app.evaluate(() => globalThis.__opened);
  check("its button opens only the project's releases page", links.length === 1 && links[0][0] === "external" && links[0][1].startsWith("https://github.com/brewed-ops/kapevault/releases"), JSON.stringify(links));
  await updateSwitch(up.dialog, true).click();
  check("switching off hides the line again", await gone(up.dialog.getByText(/is out$/)));
  check("no page errors (newer)", up.errors.length === 0, up.errors.join(" | "));
  await up.app.close();
  fs.rmSync(up.dir, { recursive: true, force: true });

  up = await openUpdates("same");
  await updateSwitch(up.dialog, false).click();
  check("up to date says so, with a date", await shows(up.dialog.getByText(/^Up to date · last checked /)));
  check("and offers no download", (await up.dialog.getByRole("button", { name: "See what is new" }).count()) === 0);

  // ---- Open source licences (Settings > General > About): the four shipped texts, read by main
  await up.dialog.getByRole("button", { name: "View" }).click();
  const licences = up.page.getByRole("dialog", { name: "Open source licences" });
  check("Open source licences opens its own sheet", await shows(licences));
  for (const name of ["LICENSE", "LICENSE-EXCEPTION", "NOTICE", "THIRD-PARTY-NOTICES"]) {
    check(`${name} has its heading`, await shows(licences.getByRole("heading", { name, exact: true })));
  }
  check("it names the licence and the version", await shows(licences.getByText(/^KAPEVault \d+\.\d+\.\d+\. KAPEVault is free software under the GNU GPL v3\. See LICENSE\.$/)));
  check("the GPL text is there", await shows(licences.getByText("GNU GENERAL PUBLIC LICENSE").first()));
  await licences.getByRole("button", { name: "Done" }).click();
  check("Done closes it", await gone(licences));
  check("Settings is back on General", await shows(up.page.getByRole("dialog", { name: "Settings" }).getByRole("switch", { name: UPDATES })));
  await up.app.close();
  fs.rmSync(up.dir, { recursive: true, force: true });

  up = await openUpdates("fail");
  await updateSwitch(up.dialog, false).click();
  check("a failed check says Could not check, quietly", await shows(up.dialog.getByRole("status").filter({ hasText: "Could not check" })));
  check("no error dialog opened over Settings", (await up.page.getByRole("dialog").count()) === 1 && (await up.page.getByRole("alertdialog").count()) === 0);
  check("the switch stays on", await shows(updateSwitch(up.dialog, true)));
  check("no page errors (fail)", up.errors.length === 0, up.errors.join(" | "));
  await up.app.close();
  fs.rmSync(up.dir, { recursive: true, force: true });

  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = report() ? 0 : 1;
})().catch((e) => {
  report();
  console.log("CRASH:", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(1);
});
