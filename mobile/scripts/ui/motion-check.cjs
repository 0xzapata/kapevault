// The motion batch at phone size on the mock host: segmented thumb slides, sort menu exits, kind switch
// settles, theme change runs through a view transition, no page errors.
const { chromium } = require("./browser.cjs");
const out = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("http://localhost:5199/?mock&nofingerprint");
  const pw = page.locator("input[type=password]").first();
  await pw.fill("demo");
  await pw.press("Enter");
  await page.getByRole("tab", { name: "Items" }).waitFor();
  await page.waitForTimeout(400);
  const r = {};

  // Sort menu: after picking, it stays mounted with data-closing for its exit, then is gone.
  await page.getByRole("button", { name: /^Sort by/ }).click();
  await page.getByRole("menu", { name: "Sort by" }).waitFor();
  await page.waitForTimeout(250);
  await page.getByRole("menuitemradio").nth(1).click();
  await page.waitForTimeout(40);
  r.sortExitPlaying = await page.evaluate(() => Boolean(document.querySelector("[data-closing] .drop")) && Number(getComputedStyle(document.querySelector("[data-closing] .drop")).opacity) < 1);
  await page.waitForTimeout(300);
  r.sortGoneAfter = (await page.getByRole("menu", { name: "Sort by" }).count()) === 0;

  // New item: switching kind settles the fields in.
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.waitForTimeout(400);
  const tiles = page.getByRole("group", { name: "Kind of item" }).getByRole("button");
  r.kindTiles = await tiles.count();
  r.settleBeforePick = await page.evaluate(() => Boolean(document.querySelector('[role="group"][aria-label="Kind of item"] ~ .settle')));
  await tiles.nth(1).click();
  await page.waitForTimeout(30);
  r.settleAfterPick = await page.evaluate(() => {
    const el = document.querySelector('[role="group"][aria-label="Kind of item"] ~ .settle');
    return Boolean(el) && el.getAnimations().length > 0;
  });
  // Device kind has a Segmented "Type": the thumb slides.
  const deviceTile = tiles.filter({ hasText: /device/i });
  if (await deviceTile.count()) {
    await deviceTile.first().click();
    await page.waitForTimeout(300);
    const seg = page.getByRole("radiogroup", { name: "Type" });
    const thumb = seg.locator(".seg-thumb");
    const before = await thumb.evaluate((el) => el.getBoundingClientRect().left);
    await seg.getByRole("radio").nth(2).click();
    await page.waitForTimeout(60);
    const mid = await thumb.evaluate((el) => el.getBoundingClientRect().left);
    await page.waitForTimeout(400);
    const after = await thumb.evaluate((el) => el.getBoundingClientRect().left);
    const target = await seg.getByRole("radio").nth(2).evaluate((el) => el.getBoundingClientRect().left);
    r.segThumb = { before: Math.round(before), mid: Math.round(mid), after: Math.round(after), target: Math.round(target) };
    r.segSlides = mid > before && mid < after && Math.abs(after - target) <= 1;
    await seg.screenshot({ path: `${out}/segmented.png` });
  }
  await page.getByRole("button", { name: "Cancel", exact: true }).last().click();
  await page.waitForTimeout(400);

  // Theme: Settings > Theme > Dark goes through startViewTransition.
  await page.evaluate(() => {
    window.__vt = 0;
    const orig = document.startViewTransition.bind(document);
    document.startViewTransition = (cb) => (window.__vt++, orig(cb));
  });
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^Theme/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole("radio", { name: /Dark/ }).click();
  await page.waitForTimeout(500);
  r.theme = await page.evaluate(() => document.documentElement.dataset.theme);
  r.viewTransitions = await page.evaluate(() => window.__vt);
  await page.screenshot({ path: `${out}/dark-settings.png` });
  r.errors = errors;
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
})();
