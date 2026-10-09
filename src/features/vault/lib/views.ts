import type { EntryKind, ViewFilter } from "../types";

// Every smart list, in sidebar order: its sidebar label, the list's heading, its glyph tint, and
// whether its row (and the list) goes away once nothing is in it. Which items belong to a view is
// matchesView (filter-entries.ts); a new item made in a kind's own list starts as that kind.
export interface ViewDef {
  id: ViewFilter;
  label: string; // sidebar row
  heading: string; // above the list
  tone: string; // a --color-sys-* token
  hideWhenEmpty?: boolean;
  newKind?: EntryKind;
}

export const VIEWS: ViewDef[] = [
  { id: "all", label: "All items", heading: "All items", tone: "--color-sys-blue" },
  { id: "favorites", label: "Favorites", heading: "Favorites", tone: "--color-sys-orange" },
  { id: "login", label: "Logins", heading: "Logins", tone: "--color-sys-teal" },
  { id: "totp", label: "2FA codes", heading: "2FA codes", tone: "--color-sys-indigo" },
  { id: "note", label: "Notes", heading: "Secure notes", tone: "--color-sys-orange", newKind: "note" },
  { id: "key", label: "API keys", heading: "API keys", tone: "--color-sys-purple", newKind: "key" },
  { id: "link", label: "File links", heading: "File links", tone: "--color-sys-green", newKind: "link" },
  { id: "thing", label: "Things", heading: "Things", tone: "--color-sys-brown", hideWhenEmpty: true, newKind: "thing" },
  { id: "device", label: "Devices", heading: "Devices", tone: "--color-sys-cyan", hideWhenEmpty: true, newKind: "device" },
  { id: "id", label: "IDs", heading: "IDs", tone: "--color-sys-pink", hideWhenEmpty: true, newKind: "id" },
  { id: "security", label: "Security", heading: "Security", tone: "--color-sys-red" }, // gray while there is nothing to fix
  { id: "closing", label: "Closing", heading: "Closing", tone: "--color-sys-orange", hideWhenEmpty: true },
  { id: "closed", label: "Closed", heading: "Closed", tone: "--color-sys-gray", hideWhenEmpty: true },
  { id: "trash", label: "Trash", heading: "Trash", tone: "--color-sys-gray", hideWhenEmpty: true }, // its row sits at the foot of the sidebar, not with the smart lists
];

const BY_ID = new Map(VIEWS.map((v) => [v.id, v]));

// A view by id; an id this version does not know reads as All items.
export const viewOf = (id: ViewFilter): ViewDef => BY_ID.get(id) ?? VIEWS[0];
