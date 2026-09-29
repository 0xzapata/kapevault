// Renders src/assets/app-icon.svg (the one source for the logo) into the Windows window/taskbar
// icon build/icon.ico (PNG frames, 16-256px), build/icon.png (1024px - electron-builder makes the
// macOS .icns from it), the tray icons, and a review sheet at %TEMP%\kapevault-icon.png showing every
// size on light and dark. Run after editing the SVG: `npm run icon`, then look at the sheet.
// Tray: build/tray.png + tray@2x.png (full colour, Windows) and build/trayTemplate.png + @2x
// (macOS menu bar). A template image must be black + alpha only - macOS tints it for light/dark -
// so it comes from TRAY_SILHOUETTE below, not the app icon. Edit both when the logo changes.
const { chromium } = require("./playwright.cjs");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const svg = fs.readFileSync(path.join(ROOT, "src", "assets", "app-icon.svg"), "utf8");
const svgUrl = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const OUT = path.join(ROOT, "build");

// The cup from above in black on a 32-unit grid (2 units = 1px at 16px, so edges land on whole
// pixels): saucer ring, handle at 3 o'clock, cup rim ring, keyhole standing in the coffee. The
// centre is x=15 so the 2-unit keyhole slot covers one whole pixel column instead of two grey halves.
const TRAY_SILHOUETTE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <mask id="cut"><rect width="32" height="32" fill="#fff"/><circle cx="15" cy="16" r="7" fill="#000"/></mask>
  <circle cx="15" cy="16" r="12" fill="none" stroke="#000" stroke-width="2"/>
  <rect x="24" y="14" width="6" height="4" rx="2"/>
  <circle cx="15" cy="16" r="9" mask="url(#cut)"/>
  <circle cx="15" cy="14.5" r="2.5"/><rect x="14" y="15" width="2" height="5"/>
</svg>`;
const trayUrl = "data:image/svg+xml;base64," + Buffer.from(TRAY_SILHOUETTE).toString("base64");

// ICO container: 6-byte header, one 16-byte entry per frame, then the PNG bytes. 256 is stored as 0.
function toIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = 6 + frames.length * 16;
  const entries = frames.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size % 256, 0);
    e.writeUInt8(size % 256, 1);
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  async function render(size, url = svgUrl) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>*{margin:0}img{display:block;width:${size}px;height:${size}px}</style><img src="${url}">`);
    await page.locator("img").evaluate((img) => img.decode());
    return page.screenshot({ omitBackground: true });
  }

  // Fails the run if a template PNG has any visible pixel that is not pure black.
  async function assertTemplate(png, name) {
    const colored = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && (d[i] || d[i + 1] || d[i + 2])) n++;
      return n;
    }, png.toString("base64"));
    if (colored) throw new Error(`${name}: ${colored} pixels are not black - a template image must be black + alpha`);
  }

  const frames = [];
  for (const size of ICO_SIZES) frames.push({ size, png: await render(size) });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "icon.ico"), toIco(frames));
  fs.writeFileSync(path.join(OUT, "icon.png"), await render(1024));

  const tray = { "tray.png": await render(16), "tray@2x.png": await render(32) };
  const template = { "trayTemplate.png": await render(16, trayUrl), "trayTemplate@2x.png": await render(32, trayUrl) };
  for (const [name, png] of Object.entries(template)) await assertTemplate(png, name);
  for (const [name, png] of Object.entries({ ...tray, ...template })) fs.writeFileSync(path.join(OUT, name), png);

  // Review sheet: each rendered frame at 1x on a light and a dark strip, the tray icons at 1x and
  // blown up to 128px with hard pixels, plus a big one. On dark the template is inverted, which is
  // what macOS does to it in a dark menu bar.
  const imgs = frames.map((f) => `<img src="data:image/png;base64,${f.png.toString("base64")}" width=${f.size} height=${f.size}>`).join("");
  const trayTags = (set, cls) =>
    Object.values(set)
      .map((png, i) => {
        const src = `data:image/png;base64,${png.toString("base64")}`;
        return `<img class="${cls}" src="${src}" width=${16 * (i + 1)}><img class="${cls} px" src="${src}" width=128>`;
      })
      .join("");
  const trayRow = trayTags(template, "tpl") + trayTags(tray, "");
  await page.setViewportSize({ width: 900, height: 700 });
  await page.setContent(`<style>body{margin:0;font:12px sans-serif}.strip{display:flex;align-items:end;gap:18px;padding:20px}.light{background:#f3f3f3}.dark{background:#1c1c1c}.px{image-rendering:pixelated}.dark .tpl{filter:invert(1)}</style>
    <div class="strip light">${imgs}</div><div class="strip dark">${imgs}</div>
    <div class="strip light">${trayRow}</div><div class="strip dark">${trayRow}</div>
    <div class="strip light"><img src="${svgUrl}" width=300 height=300></div>`);
  const sheet = path.join(os.tmpdir(), "kapevault-icon.png");
  await page.screenshot({ path: sheet, fullPage: true });
  await browser.close();
  console.log(`build/icon.ico (${ICO_SIZES.join(", ")}px), build/icon.png (1024px), build/${Object.keys({ ...tray, ...template }).join(", build/")}, sheet: ${sheet}`);
})();
