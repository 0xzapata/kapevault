// The liquid tab pill at phone size: frames through a switch (the pill must stretch toward the target,
// then settle exactly on it), a mid-flight retarget, and reduced motion (no animation, lands at once).
const { chromium } = require("./browser.cjs");
const out = process.argv[2];

async function home(browser, reduce) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: reduce ? "reduce" : "no-preference" });
  await page.goto("http://localhost:5199/?mock&nofingerprint");
  const pill = page.locator("input[type=password]").first();
  await pill.fill("demo");
  await pill.press("Enter");
  await page.getByRole("tab", { name: "Items" }).waitFor();
  await page.waitForTimeout(400);
  return page;
}
// The pill's painted box relative to the tab row, as { l } = offset of its left edge (three pieces, union).
const edges = (page) =>
  page.evaluate(() => {
    const row = document.querySelector("[data-pill]").parentElement.getBoundingClientRect();
    const boxes = [...document.querySelectorAll("[data-pill]")].map((p) => p.getBoundingClientRect());
    const l = Math.min(...boxes.map((b) => b.left)) - row.left;
    const r = Math.max(...boxes.map((b) => b.right)) - row.left;
    return { l: Math.round(l), r: Math.round(r), w: Math.round(r - l) };
  });
const tabBox = (page, name) => page.getByRole("tab", { name }).evaluate((b) => ({ l: b.offsetLeft, w: b.offsetWidth }));

(async () => {
  const browser = await chromium.launch();
  const page = await home(browser, false);
  const report = {};
  report.start = await edges(page);
  const bar = page.locator("nav[role=tablist]");
  await page.getByRole("tab", { name: "Security" }).click();
  const frames = [];
  for (let i = 0; i < 9; i++) {
    frames.push({ ms: i * 55, ...(await edges(page)) });
    if (i === 2) await bar.screenshot({ path: `${out}/tab-mid.png` });
    await page.waitForTimeout(55);
  }
  await page.waitForTimeout(300);
  report.frames = frames;
  report.end = await edges(page);
  const sec = await tabBox(page, "Security");
  report.endOnTarget = Math.abs(report.end.l - (sec.l + 7)) <= 1;
  report.maxWidth = Math.max(...frames.map((f) => f.w));
  report.stretched = report.maxWidth > sec.w; // wider than one tab's pill while travelling
  await bar.screenshot({ path: `${out}/tab-end.png` });
  await page.screenshot({ path: `${out}/tab-security.png` });

  // Retarget mid-flight: Settings, then Items 80 ms later; it must end on Items.
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.waitForTimeout(80);
  await page.getByRole("tab", { name: "Items" }).click();
  await page.waitForTimeout(700);
  const items = await tabBox(page, "Items");
  report.retargetOnItems = Math.abs((await edges(page)).l - (items.l + 7)) <= 1;
  report.selected = await page.getByRole("tab", { selected: true }).textContent();
  await page.close();

  const calm = await home(browser, true);
  await calm.getByRole("tab", { name: "Settings" }).click();
  await calm.waitForTimeout(30);
  const set = await tabBox(calm, "Settings");
  report.reducedLandsAtOnce = Math.abs((await edges(calm)).l - (set.l + 7)) <= 1;
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
})();
