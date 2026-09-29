// Tab bar screenshots of the pill at rest and mid-stretch, light and dark: seams, cap shape, icon colour.
const { chromium } = require("./browser.cjs");
const out = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  for (const dark of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: dark ? "dark" : "light" });
    await page.goto("http://localhost:5199/?mock&nofingerprint");
    const pw = page.locator("input[type=password]").first();
    await pw.fill("demo");
    await pw.press("Enter");
    await page.getByRole("tab", { name: "Items" }).waitFor();
    if (dark) await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    await page.waitForTimeout(500);
    const bar = page.locator("nav[role=tablist]");
    const name = dark ? "dark" : "light";
    await bar.screenshot({ path: `${out}/pill-${name}-rest.png` });
    // Freeze the flight mid-stretch: pause every running pill animation at 130 ms.
    await page.getByRole("tab", { name: "Settings" }).click();
    await page.evaluate(() => document.getAnimations().forEach((a) => (a.pause(), (a.currentTime = 130))));
    await bar.screenshot({ path: `${out}/pill-${name}-mid.png` });
    await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
    await page.waitForTimeout(200);
    await bar.screenshot({ path: `${out}/pill-${name}-end.png` });
    await page.close();
  }
  await browser.close();
  console.log("ok");
})();
