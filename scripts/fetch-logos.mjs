// Downloads brand logos listed in src/features/brands/brands.json into src/assets/logos/.
// Run once per new brand: `node scripts/fetch-logos.mjs` (skips logos already on disk; --force re-downloads).
// Sources, best first: svgl (full-colour SVG), Simple Icons (brand-colour SVG), a site's own icon.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "src", "assets", "logos");
const brands = JSON.parse(fs.readFileSync(path.join(root, "src", "features", "brands", "brands.json"), "utf8"));
const force = process.argv.includes("--force");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36" };

fs.mkdirSync(outDir, { recursive: true });

async function get(url) {
  const res = await fetch(url, { headers: UA, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return { type: res.headers.get("content-type") ?? "", body: Buffer.from(await res.arrayBuffer()) };
}

// A site's own icon: prefer an SVG <link rel=icon>, else the largest PNG icon it declares.
async function siteIcon(site) {
  const html = (await get(site)).body.toString("utf8");
  const links = [...html.matchAll(/<link[^>]+>/gi)].map((m) => m[0]).filter((l) => /rel=["'][^"']*icon/i.test(l));
  const href = (l) => new URL(l.match(/href=["']([^"']+)/i)?.[1] ?? "", site).href;
  const svg = links.find((l) => /\.svg|image\/svg/i.test(l));
  if (svg) return get(href(svg));
  const size = (l) => Number(l.match(/sizes=["'](\d+)/i)?.[1] ?? 0);
  const png = links.filter((l) => /\.png/i.test(l)).sort((a, b) => size(b) - size(a))[0];
  if (png) return get(href(png));
  return get(`https://www.google.com/s2/favicons?domain=${new URL(site).hostname}&sz=128`);
}

function download(source) {
  if (source.svgl) return get(`https://svgl.app/library/${source.svgl}`);
  if (source.si) return get(`https://cdn.simpleicons.org/${source.si}`);
  if (source.url) return get(source.url);
  if (source.favicon) return siteIcon(source.favicon);
  throw new Error("no source");
}

const existing = (slug) => fs.readdirSync(outDir).find((f) => f.replace(/\.\w+$/, "") === slug);

for (const brand of brands) {
  if (brand.source.local) continue;
  if (existing(brand.slug) && !force) continue;
  try {
    const { type, body } = await download(brand.source);
    const isSvg = type.includes("svg") || body.subarray(0, 200).toString().includes("<svg");
    const ext = isSvg ? "svg" : type.includes("png") ? "png" : type.includes("icon") ? "ico" : "png";
    fs.writeFileSync(path.join(outDir, `${brand.slug}.${ext}`), body);
    console.log(`ok    ${brand.slug}.${ext}`);
  } catch (err) {
    console.log(`FAIL  ${brand.slug}  ${err.message}`);
  }
}
