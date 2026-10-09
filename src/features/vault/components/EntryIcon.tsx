import { Code, Devices, FileText, GoogleDriveLogo, IdentificationCard, Key, Link, NotePencil, Package } from "@phosphor-icons/react";
import { brandForEntry } from "@/features/brands/brands";
import { BrandLogo } from "@/features/brands/BrandLogo";
import { FolderArt } from "@/features/files/components/FolderArt";
import { DEVICE_GLYPH } from "@/features/devices/components/DeviceIcon";
import type { Entry, EntryKind } from "../types";

const LINK_ICONS = { web: Link, drive: GoogleDriveLogo, doc: FileText };

// One tint per item type, from the Apple system colours - the same tones as the sidebar tiles.
const KIND_TONE = {
  login: "from-icon-top to-icon-bottom",
  link: "from-icon-top to-icon-bottom",
  note: "from-sys-orange to-sys-orange",
  key: "from-sys-purple to-sys-indigo",
  thing: "from-sys-brown to-sys-brown",
  device: "from-sys-cyan to-sys-blue",
  id: "from-sys-pink to-sys-pink",
};

const KIND_GLYPH = { login: Key, note: NotePencil, key: Code, link: Link, thing: Package, device: Devices, id: IdentificationCard };

interface EntryIconProps {
  entry: Entry;
  size: "sm" | "lg";
  inverted?: boolean;
}

const BOX = { sm: "size-10 rounded-[11px]", lg: "size-[88px] rounded-[22px]" };

function glyphFor(entry: Entry) {
  // A newer version's type falls back to the plain glyph (an unknown key used to blank the whole screen).
  if (entry.kind === "link") return Object.prototype.hasOwnProperty.call(LINK_ICONS, entry.linkType) ? LINK_ICONS[entry.linkType as keyof typeof LINK_ICONS] : LINK_ICONS.web;
  if (entry.kind === "device") return Object.prototype.hasOwnProperty.call(DEVICE_GLYPH, entry.type) ? DEVICE_GLYPH[entry.type] : DEVICE_GLYPH.other;
  return KIND_GLYPH[entry.kind];
}

// A kind's own tile, without an item (the New item kind picker).
export function KindTile({ kind, className = "size-8 rounded-[9px]" }: { kind: EntryKind; className?: string }) {
  const Icon = KIND_GLYPH[kind];
  return (
    <span className={`${className} grid shrink-0 place-items-center bg-linear-to-b ${KIND_TONE[kind]} text-on-accent shadow-tile`}>
      <Icon size={17} weight="fill" />
    </span>
  );
}

// App-icon style tiles: a brand logo on white, a Finder folder for local folders, or a
// system-tinted glyph. A logo keeps its white tile on a selected (blue) row so colours stay true.
export function EntryIcon({ entry, size, inverted = false }: EntryIconProps) {
  const brand = brandForEntry(entry);
  const box = `${BOX[size]} grid shrink-0 place-items-center`;

  if (brand) {
    return (
      <div className={`${box} border border-line bg-paper shadow-tile`}>
        <BrandLogo brand={brand} size={size === "lg" ? 48 : 22} marked />
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
      <Icon size={size === "lg" ? 40 : 19} weight="fill" />
    </div>
  );
}
