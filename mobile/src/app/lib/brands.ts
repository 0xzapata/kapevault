// Made from the PC's src/features/brands/brands.ts by scripts/brands-sync.mjs - change it there, then run the script.
import catalog from "./brands.json";
import { createMatcher } from "./brand-match";
import type { Entry } from "../host/types";

export interface Brand {
  slug: string;
  name: string;
  group: string;
  logo: string;
}

// Logos are bundled with the app (downloaded once by scripts/fetch-logos.mjs), so nothing loads at runtime.
const files = import.meta.glob("../assets/logos/*", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const logoFor = (slug: string) => Object.entries(files).find(([p]) => p.split("/").pop()?.replace(/\.\w+$/, "") === slug)?.[1];

export const BRANDS: Brand[] = catalog.flatMap((b) => {
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

// A payee's logo is its provider's: a name picked in the form ("GCash"), else detected in a typed one.
// Never from the title - "Tita Maya" is a person, not the Maya wallet.
export function providerBrand(provider: string): Brand | null {
  const name = provider.trim().toLowerCase();
  return BRANDS.find((b) => b.name.toLowerCase() === name) ?? detectIn(provider);
}

export const NO_BRAND = "none";

// entry.brand: undefined = auto-detect, "none" = no logo, otherwise a chosen slug.
export function brandForEntry(entry: Entry): Brand | null {
  if (entry.kind === "payee") return providerBrand(entry.provider);
  if (entry.kind === "thing" || entry.kind === "id") return null; // keeps its glyph, even a thing titled "Google Pixel box" or a "Company ID"
  if (entry.brand === NO_BRAND) return null;
  if (entry.brand) return bySlug.get(entry.brand) ?? null;
  const link = entry.kind === "login" || entry.kind === "key" ? entry.url : entry.kind === "link" ? entry.location : "";
  return detectBrand(link, entry.kind === "device" ? `${entry.title} ${entry.model}` : entry.title); // a device's maker is often only in its model
}

export function brandBySlug(slug: string): Brand | null {
  return bySlug.get(slug) ?? null;
}
