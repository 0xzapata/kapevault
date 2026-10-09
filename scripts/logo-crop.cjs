// node scripts/logo-crop.cjs <in.svg> <out.svg> x0,y0,x1,y1 [pad=0.04] [square]
// Keeps only shapes whose bbox CENTER lies inside the fractional region of the rendered SVG, drops
// near-full-size background shapes, then sets a tight viewBox (plus pad) around what is left.
const { chromium } = require("./playwright.cjs");
const fs = require("node:fs");
const [inp, out, region, padArg, sq] = process.argv.slice(2);
const [x0, y0, x1, y1] = region.split(",").map(Number);
const pad = Number(padArg ?? 0.04);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(`<body style="margin:0">${fs.readFileSync(inp, "utf8").replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/g, "")}</body>`);
  const res = await p.evaluate(({ x0, y0, x1, y1, pad, sq }) => {
    const svg = document.querySelector("svg");
    const vb = svg.viewBox.baseVal?.width ? svg.viewBox.baseVal : { x: 0, y: 0, width: svg.width.baseVal.value, height: svg.height.baseVal.value };
    const rootInv = svg.getScreenCTM().inverse();
    const shapes = [...svg.querySelectorAll("path,rect,circle,ellipse,polygon,polyline,line,text,image,use")].filter((e) => !e.closest("defs,clipPath,mask,pattern,symbol,linearGradient,radialGradient"));
    const box = (e) => {
      const bb = e.getBBox(), m = rootInv.multiply(e.getScreenCTM());
      const pts = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      return { x: Math.min(...xs), y: Math.min(...ys), X: Math.max(...xs), Y: Math.max(...ys) };
    };
    let keep = { x: Infinity, y: Infinity, X: -Infinity, Y: -Infinity }, dropped = 0, kept = 0;
    for (const e of shapes) {
      const r = box(e);
      const cx = (r.x + r.X) / 2, cy = (r.y + r.Y) / 2;
      const fx = (cx - vb.x) / vb.width, fy = (cy - vb.y) / vb.height;
      const isBg = (r.X - r.x) > vb.width * 0.97 && (r.Y - r.y) > vb.height * 0.97;
      if (isBg || fx < x0 || fx > x1 || fy < y0 || fy > y1 || r.X - r.x === 0) { e.remove(); dropped++; continue; }
      kept++;
      keep = { x: Math.min(keep.x, r.x), y: Math.min(keep.y, r.y), X: Math.max(keep.X, r.X), Y: Math.max(keep.Y, r.Y) };
    }
    let w = keep.X - keep.x, h = keep.Y - keep.y, cx = keep.x + w / 2, cy = keep.y + h / 2;
    if (sq) w = h = Math.max(w, h);
    const P = Math.max(w, h) * pad;
    w += 2 * P; h += 2 * P;
    const r2 = (n) => Math.round(n * 100) / 100;
    svg.setAttribute("viewBox", `${r2(cx - w / 2)} ${r2(cy - h / 2)} ${r2(w)} ${r2(h)}`);
    svg.removeAttribute("width"); svg.removeAttribute("height"); svg.removeAttribute("style"); svg.removeAttribute("class");
    // drop empty groups
    for (let i = 0; i < 3; i++) svg.querySelectorAll("g").forEach((g) => { if (!g.querySelector("path,rect,circle,ellipse,polygon,polyline,line,text,image,use")) g.remove(); });
    return { kept, dropped, svg: svg.outerHTML };
  }, { x0, y0, x1, y1, pad, sq: !!sq });
  await b.close();
  const clean = res.svg.replace(/<metadata[\s\S]*?<\/metadata>/g, "").replace(/<title>[\s\S]*?<\/title>/g, "").replace(/\s+id="[^"]*"/g, (m) => m).replace(/\n\s*\n/g, "\n");
  fs.writeFileSync(out, clean.startsWith("<svg") && !/xmlns=/.test(clean.slice(0, 200)) ? clean.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"') : clean);
  console.log(out, `kept ${res.kept} dropped ${res.dropped}`, `${fs.statSync(out).size}B`);
})();
