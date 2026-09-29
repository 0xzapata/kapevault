// node scripts/logo-clip.cjs <in.svg> <out.svg> x0,y0,x1,y1 [pad] [sq]
// For logos drawn as ONE compound path: rasterise, find the painted pixel bbox inside the fractional
// region, and set the viewBox to it (the rest of the path is clipped away by the viewport).
// Also prints the column coverage profile so a clean gap between symbol and wordmark can be chosen.
const { chromium } = require("./playwright.cjs");
const fs = require("fs");
const [inp, out, region, padArg, sq] = process.argv.slice(2);
const [x0, y0, x1, y1] = region.split(",").map(Number);
const pad = Number(padArg ?? 0.04);
const src = fs.readFileSync(inp, "utf8").replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/g, "");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent("<body></body>");
  const r = await p.evaluate(async ({ src, x0, y0, x1, y1, pad, sq }) => {
    const doc = new DOMParser().parseFromString(src, "image/svg+xml");
    const svg = doc.documentElement;
    let vb = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    if (vb.length !== 4) vb = [0, 0, parseFloat(svg.getAttribute("width")), parseFloat(svg.getAttribute("height"))];
    const W = 2000, H = Math.round((2000 * vb[3]) / vb[2]);
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const cols = new Array(100).fill(0);
    let bx = W, by = H, BX = -1, BY = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] < 16) continue;
      cols[Math.floor((x / W) * 100)]++;
      if (x < x0 * W || x > x1 * W || y < y0 * H || y > y1 * H) continue;
      bx = Math.min(bx, x); by = Math.min(by, y); BX = Math.max(BX, x); BY = Math.max(BY, y);
    }
    const s = vb[2] / W;
    let w = (BX - bx + 1) * s, h = (BY - by + 1) * s, cx = vb[0] + (bx + (BX - bx + 1) / 2) * s, cy = vb[1] + (by + (BY - by + 1) / 2) * s;
    if (sq) w = h = Math.max(w, h);
    const P = Math.max(w, h) * pad; w += 2 * P; h += 2 * P;
    const r2 = (n) => Math.round(n * 100) / 100;
    return { vb: `${r2(cx - w / 2)} ${r2(cy - h / 2)} ${r2(w)} ${r2(h)}`, profile: cols.map((n) => (n ? (n > 400 ? "#" : "+") : ".")).join("") };
  }, { src, x0, y0, x1, y1, pad, sq: !!sq });
  await b.close();
  let outSvg = src.replace(/<svg\b[^>]*>/, (tag) => {
    let t = tag.replace(/\s(width|height|viewBox|style|x|y|enable-background)="[^"]*"/g, "");
    return t.replace(/<svg/, `<svg viewBox="${r.vb}"`);
  });
  outSvg = outSvg.replace(/<metadata[\s\S]*?<\/metadata>/g, "").replace(/<title>[\s\S]*?<\/title>/g, "");
  fs.writeFileSync(out, outSvg.trim() + "\n");
  console.log(out.split("/").pop(), "viewBox", r.vb, fs.statSync(out).size + "B");
  console.log("  cols", r.profile);
})();
