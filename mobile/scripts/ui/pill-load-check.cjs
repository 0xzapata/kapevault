// Does the tab pill keep moving while the page's main thread is busy (as when React renders the new tab
// on a phone)? Screencast frames come from the compositor: a composited (transform) animation keeps
// producing frames during a main-thread block; a main-thread one (clip-path) freezes until it ends.
// Also samples the pill's edges every animation frame (unblocked) to find the biggest per-frame jump.
const { chromium } = require("./browser.cjs");
const BLOCK_MS = 600;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto("http://localhost:5199/?mock&nofingerprint");
  const pw = page.locator("input[type=password]").first();
  await pw.fill("demo");
  await pw.press("Enter");
  await page.getByRole("tab", { name: "Items" }).waitFor();
  await page.waitForTimeout(600);

  // 1. Unblocked: the pill's painted edges every frame through Items -> Settings.
  await page.evaluate(() => {
    window.__edges = [];
    const pill = () => {
      const parts = [...document.querySelectorAll("[data-pill]")];
      if (parts.length) {
        const boxes = parts.map((p) => p.getBoundingClientRect());
        return { l: Math.min(...boxes.map((b) => b.left)), r: Math.max(...boxes.map((b) => b.right)) };
      }
      const el = document.querySelector(".tab-pill");
      const px = getComputedStyle(el).clipPath.match(/-?[\d.]+px/g).map(parseFloat);
      const b = el.getBoundingClientRect();
      return { l: b.left + px[3], r: b.right - px[1] };
    };
    const start = performance.now();
    const tick = (t) => {
      window.__edges.push({ t: Math.round(t - start), ...pill() });
      if (t - start < 900) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.waitForTimeout(1000);
  const edges = await page.evaluate(() => window.__edges);
  let maxJump = 0;
  for (let i = 1; i < edges.length; i++) maxJump = Math.max(maxJump, Math.abs(edges[i].l - edges[i - 1].l), Math.abs(edges[i].r - edges[i - 1].r));
  const moving = edges.filter((e, i) => i && (Math.abs(e.l - edges[i - 1].l) > 0.5 || Math.abs(e.r - edges[i - 1].r) > 0.5));
  const settleMs = moving.length ? moving[moving.length - 1].t : 0;

  // 2. Blocked: back to Items, then a 600 ms busy loop; count compositor frames during the block.
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", (f) => {
    frames.push(f.metadata.timestamp * 1000);
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  // Only the tab bar animates in this run: the content fade (also composited) would add frames of its own.
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      return animate.call(this, keyframes, this.closest("nav") ? options : { duration: 0 });
    };
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 30, everyNthFrame: 1 });
  await page.waitForTimeout(300);
  await page.getByRole("tab", { name: "Items" }).click();
  const block = await page.evaluate((ms) => {
    const start = Date.now();
    while (Date.now() - start < ms) {}
    return { start, end: Date.now() };
  }, BLOCK_MS);
  await page.waitForTimeout(500);
  const during = frames.filter((t) => t > block.start + 30 && t < block.end).length;
  // Control: the same block with nothing animating - frames the compositor sends anyway.
  const quiet = await page.evaluate((ms) => {
    const start = Date.now();
    while (Date.now() - start < ms) {}
    return { start, end: Date.now() };
  }, BLOCK_MS);
  await page.waitForTimeout(300);
  await cdp.send("Page.stopScreencast");
  const control = frames.filter((t) => t > quiet.start + 30 && t < quiet.end).length;

  await browser.close();
  if (process.argv.includes("--frames")) {
    for (let i = 1; i < Math.min(edges.length, 34); i++) {
      const [e, p] = [edges[i], edges[i - 1]];
      console.log(`${e.t}ms  l ${Math.round(e.l)} (${Math.round(e.l - p.l)})  r ${Math.round(e.r)} (${Math.round(e.r - p.r)})  w ${Math.round(e.r - e.l)}`);
    }
  }
  console.log(JSON.stringify({ framesSampled: edges.length, maxJumpPxPerFrame: Math.round(maxJump), settleMs, compositorFramesDuringBlock: during, controlFramesNoAnimation: control, blockMs: BLOCK_MS }, null, 1));
})();
