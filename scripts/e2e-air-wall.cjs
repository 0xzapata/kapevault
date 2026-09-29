// End-to-end checks for Air Wall (Settings > Security) in every state, driven by the test-only
// KAPEVAULT_AIRWALL_FAKE (no UAC prompt, no firewall change, no network). Part of npm run e2e.
// The courier itself (R2 through the system curl) is proved by the cloud checks in e2e.cjs.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHarness, shows, gone } = require("./e2e-harness.cjs");

const SHOTS = path.join(os.tmpdir(), "kapevault-e2e-v2");
fs.mkdirSync(SHOTS, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-airwall-"));
const { check, launch: launchWith, report } = createHarness();
const MASTER = "mock kettle harbor pass";
const SWITCH = "Keep KAPEVault offline";

(async () => {
  // Opens the vault (creating it on the first launch) and Settings > Security.
  async function openSecurity(fake) {
    const run = await launchWith({ KAPEVAULT_DATA_DIR: dataDir, ...(fake && { KAPEVAULT_AIRWALL_FAKE: fake }) });
    const { page } = run;
    await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
    if (await page.getByPlaceholder("Confirm master password").isVisible()) await page.getByPlaceholder("Confirm master password").fill(MASTER);
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Settings" }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("dialog").getByRole("tab", { name: "Security" }).click();
    return { ...run, dialog: page.getByRole("dialog") };
  }
  const toggle = (dialog, checked) => dialog.getByRole("switch", { name: SWITCH, checked });
  const testButton = (dialog) => dialog.getByRole("button", { name: "Test", exact: true });

  // ---- Off -> Test gets through -> switch on -> Test is blocked -> switch off
  let { app, page, errors, dialog } = await openSecurity("off");
  check("Air Wall row shows, switched off", await shows(toggle(dialog, false)));
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

  // ---- A rule left for another copy of the app
  ({ app, page, errors, dialog } = await openSecurity("other"));
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

  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = report() ? 0 : 1;
})().catch((e) => {
  report();
  console.log("CRASH:", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(1);
});
