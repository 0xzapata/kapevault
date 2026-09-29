// Restore from a file on the mock host at phone size, light and dark: from first run (a junk file is
// refused before the password step, a backup file asks for its password and opens), and from Settings;
// plus the "No backup yet" sync line and Settings row of a vault with no R2. Screens for each step.
// Needs the mobile vite dev server on :5199 (UI_PORT names another port).
const { chromium } = require("./browser.cjs");
const out = process.argv[2];
const junk = { name: "holiday.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not a vault") };
const backup = { name: "KAPEVault backup.kapevault", mimeType: "application/octet-stream", buffer: Buffer.from('{"format":"kapevault","version":1}') };

(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (const scheme of ["light", "dark"]) {
    const r = { scheme };
    const errors = [];
    const newPage = async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://localhost:${process.env.UI_PORT || 5199}/?mock&firstrun`);
      return page;
    };
    const shot = (page, name) => page.screenshot({ path: `${out}/${name}-${scheme}.png` });

    // First run > Restore from backup > Use a file instead.
    let page = await newPage();
    await page.getByRole("button", { name: "Restore from backup" }).click();
    await page.getByRole("button", { name: "Use a file instead" }).click();
    r.fileStep = await page.getByRole("button", { name: "Choose file" }).isVisible();
    await page.waitForTimeout(400);
    await shot(page, "restore-file-pick");
    const input = page.locator("input[type=file]");
    // A file that cannot be read (Drive offline) says so and stays on the pick step.
    await page.evaluate(() => {
      const text = File.prototype.text;
      File.prototype.text = function () {
        File.prototype.text = text;
        return Promise.reject(new Error("mock offline"));
      };
    });
    await input.setInputFiles(backup);
    r.unreadable = await page.getByRole("alert").filter({ hasText: "Could not read that file" }).waitFor({ timeout: 3000 }).then(() => true, () => false);
    r.unreadableStaysOnPick = await page.getByRole("button", { name: "Choose file" }).isVisible();
    await input.setInputFiles(junk);
    r.junkRefused = await page.getByRole("alert").filter({ hasText: "not a KAPEVault backup" }).isVisible();
    r.junkStaysOnPick = await page.getByRole("button", { name: "Choose file" }).isVisible();
    await input.setInputFiles(backup);
    await page.getByText("Master password for KAPEVault backup.kapevault").waitFor();
    await page.waitForTimeout(400);
    await shot(page, "restore-file-password");
    const pw = page.locator("input[type=password]");
    await pw.fill("wrong");
    await pw.press("Enter");
    r.wrongRefused = await page.getByRole("alert").filter({ hasText: "Wrong master password" }).waitFor({ timeout: 3000 }).then(() => true, () => false);
    await pw.fill("demo");
    await pw.press("Enter");
    await page.getByRole("button", { name: "Not now" }).click();
    r.opened = await page.getByRole("tab", { name: "Items" }).waitFor({ timeout: 3000 }).then(() => true, () => false);
    await page.close();

    // A new vault with no R2: the sync line and Settings say No backup yet; Settings restores from a file.
    page = await newPage();
    const pws = page.locator("input[type=password]");
    await pws.nth(0).fill("Lantern-Mango-Quiet-47");
    await pws.nth(1).fill("Lantern-Mango-Quiet-47");
    await pws.nth(1).press("Enter");
    await page.getByRole("button", { name: "Not now" }).click();
    await page.getByRole("tab", { name: "Items" }).waitFor();
    await page.waitForTimeout(400);
    r.noBackupLine = await page.getByRole("button", { name: /No backup yet/ }).isVisible();
    await shot(page, "no-backup-line");
    await page.getByRole("tab", { name: "Settings" }).click();
    const row = page.getByRole("button", { name: "Restore from a file" });
    await row.scrollIntoViewIfNeeded();
    r.noBackupRow = await page.getByRole("button", { name: /Connect to R2.*No backup yet/ }).isVisible();
    await page.waitForTimeout(300);
    await shot(page, "settings-backup");
    await row.click();
    r.fromSettings = await page.getByRole("button", { name: "Choose file" }).isVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    r.cancelBack = await page.getByRole("button", { name: "Restore from a file" }).isVisible();
    // Back on Settings once: after a lock the phone opens on the items again.
    await page.getByRole("tab", { name: "Items" }).click();
    await page.getByRole("button", { name: "Show sidebar" }).click();
    await page.getByRole("button", { name: "Lock vault" }).click();
    await pws.first().fill("Lantern-Mango-Quiet-47");
    await pws.first().press("Enter");
    r.unlockOpensItems = await page.getByRole("tab", { name: "Items", selected: true }).waitFor({ timeout: 3000 }).then(() => true, () => false);
    r.errors = errors;
    results.push(r);
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 1));
  const ok = results.every((r) => r.fileStep && r.junkRefused && r.junkStaysOnPick && r.wrongRefused && r.opened && r.noBackupLine && r.noBackupRow && r.fromSettings && r.cancelBack && r.unreadable && r.unreadableStaysOnPick && r.unlockOpensItems && r.errors.length === 0);
  process.exit(ok ? 0 : 1);
})();
