// The restore step with many backups on a phone-sized screen: the button and step dots stay on screen,
// the list scrolls. Needs the mobile vite dev server on :5199.
const { chromium } = require("./browser.cjs");
const out = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (const [w, h] of [[360, 640], [412, 915]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await page.goto("http://localhost:5199/?mock&firstrun&backups=30");
    await page.getByRole("button", { name: "Restore from backup" }).click();
    await page.getByRole("button", { name: "Type the keys instead" }).click();
    const inputs = page.locator("input");
    await inputs.nth(0).fill("https://0123abcd.r2.cloudflarestorage.com/mock-bucket");
    await inputs.nth(1).fill("mock-key");
    await inputs.nth(2).fill("mock-secret");
    await page.getByRole("button", { name: "Connect" }).click();
    const button = page.getByRole("button", { name: "Use this backup" });
    await button.waitFor();
    const box = await button.boundingBox();
    const list = page.getByRole("radiogroup", { name: "Backups" });
    const scroll = await list.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
    const radios = await page.getByRole("radio").count();
    await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.getByRole("radio").last().click();
    const lastPicked = await page.getByRole("radio").last().getAttribute("aria-checked");
    await list.evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({ path: `${out}/backup-list-${w}x${h}.png` });
    const onScreen = box && box.y >= 0 && box.y + box.height <= h;
    results.push({ viewport: `${w}x${h}`, radios, button: box && Math.round(box.y + box.height), onScreen, listScrolls: scroll.scroll > scroll.client, lastPicked });
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 1));
  process.exit(results.every((r) => r.onScreen && r.listScrolls && r.radios === 30 && r.lastPicked === "true") ? 0 : 1);
})();
