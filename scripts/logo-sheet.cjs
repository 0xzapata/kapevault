// Contact sheet of every bundled logo on a checkerboard, to confirm each is transparent and not a
// wordmark before keeping it. Run after fetch-logos: `npm run logos:check` -> %TEMP%\kapevault-logos.png
const { chromium } = require("./playwright.cjs");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = path.resolve(__dirname, "..", "src", "assets", "logos");
const toUrl = (p) => "file:///" + p.split(path.sep).join("/");
const cells = fs
  .readdirSync(dir)
  .sort()
  .map((f) => `<div class=c><div class=t><img src="${toUrl(path.join(dir, f))}"></div><span>${f}</span></div>`)
  .join("");
const html = `<style>body{margin:0;font:11px sans-serif;display:grid;grid-template-columns:repeat(10,1fr);gap:6px;padding:8px;background:#fff}.c{text-align:center}.t{height:64px;display:grid;place-items:center;background:repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/12px 12px;border-radius:8px}img{width:44px;height:44px;object-fit:contain}span{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}</style>${cells}`;
const htmlPath = path.join(os.tmpdir(), "kapevault-logos.html");
const out = path.join(os.tmpdir(), "kapevault-logos.png");
fs.writeFileSync(htmlPath, html);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(toUrl(htmlPath));
  await page.waitForTimeout(800);
  const broken = await page.$$eval("img", (imgs) => imgs.filter((i) => !i.naturalWidth).map((i) => i.src.split("/").pop()));
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log(`${out}`, broken.length ? `BROKEN: ${broken.join(", ")}` : "(all logos load)");
})();
