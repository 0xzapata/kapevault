import { ArrowSquareOut, Clock, Copy, FolderSimple, Key, MapPin, PencilSimple, Star, User } from "@phosphor-icons/react";
import type { MenuItem } from "@/components/Menu";
import { keys } from "@/lib/platform";
import { isGone } from "@/features/closing/lib/lifecycle";
import { copyCode, copySecretOf, copyUsername, entryCopies, linkOf, openEntry, openLabel, type CopySlot } from "../lib/entry-actions";
import type { Entry } from "../types";

type ItemAction = (e: Entry) => Promise<string | null>;

// The row menu's copies: the keyboard shortcut each slot shares with the keyboard map.
const MENU_COPY: Record<Exclude<CopySlot, "imei">, { run: ItemAction; shortcut: string[] }> = {
  secret: { run: copySecretOf, shortcut: ["mod", "shift", "C"] },
  username: { run: copyUsername, shortcut: ["mod", "C"] },
  totp: { run: copyCode, shortcut: ["mod", "alt", "C"] },
};

function copyIcon(entry: Entry, slot: CopySlot) {
  if (slot === "totp") return <Clock size={14} />;
  if (slot === "secret") return entry.kind === "note" ? <Copy size={14} /> : <Key size={14} />;
  if (entry.kind === "login" || entry.kind === "key") return <User size={14} />;
  return entry.kind === "thing" ? <MapPin size={14} /> : <Copy size={14} />;
}

export interface RowMenuActions {
  act: (action: ItemAction, entry: Entry) => void; // runs it and reports it in a toast
  onEdit: (entry: Entry) => void;
  onToggleFavorite: (id: string) => void;
  onMove: (entry: Entry) => void;
  canMove: boolean; // there is another space to move it to
}

// A list row's right-click / "..." menu: its copies and Open, then Edit, favorite and Move.
export function rowMenu(entry: Entry, { act, onEdit, onToggleFavorite, onMove, canMove }: RowMenuActions): MenuItem[] {
  if (entry.trashedAt) return []; // in the Trash: nothing copies, opens or changes it
  const items: MenuItem[] = [];
  for (const copy of entryCopies(entry)) {
    if (copy.slot === "imei") continue; // the IMEI is copied from the detail pane only
    const { run, shortcut } = MENU_COPY[copy.slot];
    // The menu names the 2FA copy "Copy 2FA code" (quick search and the pills say "Copy code").
    items.push({ label: copy.slot === "totp" ? "Copy 2FA code" : copy.label, icon: copyIcon(entry, copy.slot), shortcut: keys(...shortcut), onSelect: () => act(run, entry) });
  }
  // The menu opens a link with a plain "Open" (quick search says "Open link" / "Open folder").
  if (linkOf(entry)) items.push({ label: entry.kind === "link" ? "Open" : openLabel(entry), icon: <ArrowSquareOut size={14} />, shortcut: keys("mod", "O"), onSelect: () => act(openEntry, entry) });
  if (isGone(entry)) return items; // a closed account: nothing changes it
  if (items.length) items.push("separator");
  items.push(
    { label: "Edit", icon: <PencilSimple size={14} />, shortcut: keys("mod", "E"), onSelect: () => onEdit(entry) },
    { label: entry.favorite ? "Remove from favorites" : "Add to favorites", icon: <Star size={14} />, shortcut: keys("mod", "D"), onSelect: () => onToggleFavorite(entry.id) },
    { label: "Move to...", icon: <FolderSimple size={14} />, disabled: !canMove, onSelect: () => onMove(entry) },
  );
  return items;
}
