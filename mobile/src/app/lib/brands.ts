// Made from the PC's src/features/brands/brands.ts by scripts/sync-shared.mjs - change it there, then run the script.
import catalog from "./brands.json";
import { createMatcher } from "./brand-match";
import type { Entry } from "../host/types";

export interface Brand {
  slug: string;
  name: string;
  group: string;
  logo?: string; // absent for a brand shown by name only ("logo": false in brands.json)
}

// A catalog entry with "logo": false is a brand with no logo file on purpose (a mark we may not ship, see
// NOTICE): it still matches by name and shows the letter tile. fetch-logos.mjs skips it. Every other entry
// needs a file in assets/logos; one without a file is left out of BRANDS.
// Logos are bundled with the app (downloaded once by scripts/fetch-logos.mjs), so nothing loads at runtime.
const files = import.meta.glob("../assets/logos/*", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const logoFor = (slug: string) => Object.entries(files).find(([p]) => p.split("/").pop()?.replace(/\.\w+$/, "") === slug)?.[1];

export const BRANDS: Brand[] = catalog.flatMap((b) => {
  if ("logo" in b && b.logo === false) return [{ slug: b.slug, name: b.name, group: b.group }];
  const logo = logoFor(b.slug);
  return logo ? [{ slug: b.slug, name: b.name, group: b.group, logo }] : [];
});

const bySlug = new Map(BRANDS.map((b) => [b.slug, b]));

const match = createMatcher(catalog);

function detectIn(text: string): Brand | null {
  const slug = match(text);
  return slug ? (bySlug.get(slug) ?? null) : null;
}

// The link is the stronger signal, so it wins over the title ("Client Slack" at gohighlevel.com is GHL).
export function detectBrand(link: string, title: string): Brand | null {
  return detectIn(link) ?? detectIn(title);
}

export const NO_BRAND = "none";

// entry.brand: undefined = auto-detect, "none" = no logo, otherwise a chosen slug.
export function brandForEntry(entry: Entry): Brand | null {
  if (entry.kind === "thing" || entry.kind === "id") return null; // keeps its glyph, even a thing titled "Google Pixel box" or a "Company ID"
  if (entry.brand === NO_BRAND) return null;
  if (entry.brand) return bySlug.get(entry.brand) ?? null;
  const link = entry.kind === "login" || entry.kind === "key" ? entry.url : entry.kind === "link" ? entry.location : "";
  return detectBrand(link, entry.kind === "device" ? `${entry.title} ${entry.model}` : entry.title); // a device's maker is often only in its model
}

export function brandBySlug(slug: string): Brand | null {
  return bySlug.get(slug) ?? null;
}
