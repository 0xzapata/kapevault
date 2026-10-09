import { Buildings, Code, Cpu, DeviceMobile, Devices, EnvelopeSimple, FileText, GoogleDriveLogo, IdentificationCard, Key, Laptop, Link, NotePencil, Package, SecurityCamera, WifiHigh } from "@phosphor-icons/react";
import appIcon from "../assets/app-icon.svg";
import { useBlobUrl } from "./photo";
import { brandBySlug, brandForEntry, type Brand } from "../lib/brands";
import { signInOption } from "../lib/sign-in";
import type { Entry, EntryKind, SignInMethod } from "../host/types";

// One tint per item type, from the Apple system colours (the PC's EntryIcon).
const KIND_TONE: Record<EntryKind, string> = {
  login: "from-icon-top to-icon-bottom",
  link: "from-icon-top to-icon-bottom",
  note: "from-sys-orange to-sys-orange",
  key: "from-sys-purple to-sys-indigo",
  thing: "from-sys-brown to-sys-brown",
  device: "from-sys-cyan to-sys-blue",
  id: "from-sys-pink to-sys-pink",
};
const KIND_GLYPH = { login: Key, note: NotePencil, key: Code, link: Link, thing: Package, device: Devices, id: IdentificationCard };
const LINK_GLYPH = { web: Link, drive: GoogleDriveLogo, doc: FileText }; // a folder is drawn as FolderArt
export const DEVICE_GLYPH = { router: WifiHigh, cctv: SecurityCamera, phone: DeviceMobile, laptop: Laptop, other: Cpu };

function glyphFor(e: Entry) {
  // A newer version's type falls back to the plain glyph (an unknown key used to blank the whole screen).
  if (e.kind === "link") return Object.hasOwn(LINK_GLYPH, e.linkType) ? LINK_GLYPH[e.linkType as keyof typeof LINK_GLYPH] : LINK_GLYPH.web;
  if (e.kind === "device") return Object.hasOwn(DEVICE_GLYPH, e.type) ? DEVICE_GLYPH[e.type] : DEVICE_GLYPH.other;
  return KIND_GLYPH[e.kind];
}

// A kind's own tile, without an item (the New item kind tiles).
export function KindTile({ kind, className = "size-7 rounded-[8px]", size = 15 }: { kind: EntryKind; className?: string; size?: number }) {
  const Icon = KIND_GLYPH[kind];
  return (
    <span className={`${className} grid shrink-0 place-items-center bg-linear-to-b ${KIND_TONE[kind]} text-on-accent shadow-tile`}>
      <Icon size={size} weight={kind === "key" || kind === "link" ? "bold" : "fill"} />
    </span>
  );
}

// A Finder-style folder (the PC's FolderArt): back panel with a tab, lighter front panel, from tokens.
function FolderArt({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 80 64" aria-hidden="true">
      <path d="M4 10a6 6 0 0 1 6-6h18.5a6 6 0 0 1 4.6 2.2L37 11h33a6 6 0 0 1 6 6v37a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z" fill="var(--color-folder-back)" />
      <path d="M4 22a6 6 0 0 1 6-6h60a6 6 0 0 1 6 6v32a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z" fill="var(--color-folder-front)" />
      <path d="M4 22a6 6 0 0 1 6-6h60a6 6 0 0 1 6 6v1.5H4z" fill="var(--color-folder-lip)" />
    </svg>
  );
}

// A brand's logo at `size` px, or its first letter on the Monogram gradient when it has none (the PC's BrandLogo).
export function BrandLogo({ brand, size }: { brand: Brand; size: number }) {
  if (brand.logo) return <img src={brand.logo} alt="" draggable={false} style={{ width: size, height: size }} className="object-contain" />;
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.45 }} className="grid shrink-0 place-items-center rounded-full bg-linear-to-b from-mono-top to-mono-bottom font-semibold text-on-accent">
      {brand.name.charAt(0).toUpperCase()}
    </span>
  );
}

// App-icon style tiles: a brand logo on paper, a Finder folder for local folders, or a system-tinted
// glyph. On a selected (blue) row the glyph tile goes translucent white; a logo keeps its paper so its
// colours stay true.
export function EntryIcon({ entry, size, inverted = false }: { entry: Entry; size: "sm" | "lg"; inverted?: boolean }) {
  const brand = brandForEntry(entry);
  const box = `${size === "lg" ? "size-[88px] rounded-[22px]" : "size-10 rounded-[11px]"} grid shrink-0 place-items-center`;
  if (brand) {
    return (
      <div className={`${box} border border-line bg-paper shadow-tile`}>
        <BrandLogo brand={brand} size={size === "lg" ? 48 : 22} />
      </div>
    );
  }
  if (entry.kind === "link" && entry.linkType === "folder") {
    return (
      <div className={box}>
        <FolderArt size={size === "lg" ? 84 : 38} />
      </div>
    );
  }
  const Icon = glyphFor(entry);
  const tone = inverted ? "bg-on-accent/20 text-on-accent" : `bg-linear-to-b ${KIND_TONE[entry.kind]} text-on-accent shadow-tile`;
  return (
    <div className={`${box} ${tone}`}>
      <Icon size={size === "lg" ? 40 : 19} weight={entry.kind === "key" || entry.kind === "link" ? "bold" : "fill"} />
    </div>
  );
}

const SIGN_IN_GLYPH = { password: Key, "email-link": EnvelopeSimple, sso: Buildings } as const;

// How a login signs in (the PC's SignInMark): the provider's logo (Google, Apple...) or a glyph for
// password / email link / SSO.
export function SignInMark({ method, size = 16 }: { method: SignInMethod; size?: number }) {
  const option = signInOption(method);
  const logo = option.brand ? brandBySlug(option.brand) : null;
  if (logo) return <BrandLogo brand={logo} size={size} />;
  const Glyph = SIGN_IN_GLYPH[method as keyof typeof SIGN_IN_GLYPH] ?? Key;
  return <Glyph size={size} weight="bold" className="text-accent" />;
}

// KAPEVault's logo: an espresso cup from above, latte art poured as a keyhole (the PC's AppIcon).
export function AppIcon({ size }: { size: number }) {
  return (
    <span className="inline-grid shrink-0 rounded-[22.5%] shadow-icon" style={{ width: size, height: size }}>
      <img src={appIcon} width={size} height={size} alt="" draggable={false} />
    </span>
  );
}

// Contacts-style initials for a space or a person, or the space's own photo when it has one.
export function Monogram({ name, photo }: { name: string; photo?: string }) {
  const url = useBlobUrl(photo ?? null);
  if (url) return <img src={url} alt="" draggable={false} className="size-[22px] shrink-0 rounded-full object-cover" />;
  const letters = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-linear-to-b from-mono-top to-mono-bottom text-[9.5px] font-semibold tracking-wide text-on-accent">{letters}</span>;
}
