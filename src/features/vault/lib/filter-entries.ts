import type { Entry, Space, SortOrder, ViewFilter } from "../types";
import { signInOption } from "./sign-in.ts";
import { personKey } from "../../held-for/lib/held-for.ts";
import { isClosing, isGone } from "../../closing/lib/lifecycle.ts";
import { deviceTypeLabel } from "../../devices/lib/devices.ts";

interface FilterInput {
  entries: Entry[];
  spaces: Space[];
  view: ViewFilter;
  spaceId: string | null;
  heldFor?: string | null; // only the items kept for this person
  query: string;
  sort: SortOrder;
}

// Every searchable word of an entry, including its space name, so "northwind ghl" finds the client login,
// and who it is held for, so "mama" finds Mama's accounts.
// Secrets (passwords, note bodies, API key secrets, question answers, ID numbers) are never here - the page does not have them.
function searchText(entry: Entry, spaceName: string): string {
  let specific: string[];
  switch (entry.kind) {
    case "login":
      // Logins are findable by how you sign in too: "google" lists every Sign in with Google account.
      specific = [entry.username, entry.url, `${signInOption(entry.signIn).label} sign-in`, entry.hasTotp ? "2fa totp code" : "", ...entry.questions.map((q) => q.question)];
      break;
    case "key":
      specific = [entry.keyId, entry.url, "api key token"];
      break;
    case "note":
      specific = ["secure note"];
      break;
    case "thing":
      // "bedroom" lists what is kept there; "blue folder" finds the spot.
      specific = [entry.room, entry.spot, "thing"];
      break;
    case "device":
      // "wifi" or the Wi-Fi name finds the router; a serial or IMEI finds the phone.
      specific = [deviceTypeLabel(entry.type), entry.model, entry.serial, entry.imei, entry.mac, entry.ssid, entry.ssid || entry.hasWifiPassword ? "wifi wi-fi" : "", entry.adminUrl, entry.adminUser, "device"];
      break;
    case "id":
      specific = [entry.idType, "id"];
      break;
    default:
      specific = [entry.location];
  }
  return [entry.title, spaceName, entry.notes, entry.heldFor ?? "", ...entry.tags, ...specific].join(" ").toLowerCase();
}

// A closed account's tombstone shows only in Closed - never in other lists, counts or search.
export function matchesView(entry: Entry, view: ViewFilter): boolean {
  if (view === "trash") return entry.trashedAt !== undefined; // the Trash view reads VaultView.trash; no other view ever sees such an item
  if (view === "closed") return isGone(entry);
  if (isGone(entry)) return false;
  switch (view) {
    case "all":
      return true;
    case "favorites":
      return entry.favorite;
    case "totp":
      return entry.kind === "login" && entry.hasTotp;
    case "security":
      return entry.issues.length > 0;
    case "closing":
      return isClosing(entry);
    default:
      return entry.kind === view;
  }
}

// How well an entry's title answers the query: 3 title starts with it, 2 a title word starts with
// a query word, 1 the title contains one, 0 it matched some other field. Title hits rank first.
function titleScore(title: string, words: string[], query: string): number {
  const t = title.toLowerCase();
  if (t.startsWith(query)) return 3;
  const titleWords = t.split(/[\s\-_.@/]+/);
  if (words.some((w) => titleWords.some((tw) => tw.startsWith(w)))) return 2;
  if (words.some((w) => t.includes(w))) return 1;
  return 0;
}

const byTitle = (a: Entry, b: Entry) => a.title.localeCompare(b.title);

export function sortEntries(entries: Entry[], sort: SortOrder): Entry[] {
  const list = [...entries];
  switch (sort) {
    case "recent":
      // Used items first, newest use on top; never-used ones follow alphabetically.
      return list.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || byTitle(a, b));
    case "edited":
      return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || byTitle(a, b));
    default:
      return list.sort(byTitle);
  }
}

export function filterEntries({ entries, spaces, view, spaceId, heldFor, query, sort }: FilterInput): Entry[] {
  const spaceNames = new Map(spaces.map((s) => [s.id, s.name]));
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);

  const matched = entries
    .filter((e) => matchesView(e, view))
    .filter((e) => spaceId === null || e.spaceId === spaceId)
    .filter((e) => !heldFor || personKey(e.heldFor) === personKey(heldFor))
    .filter((e) => {
      const text = searchText(e, spaceNames.get(e.spaceId) ?? "");
      return words.every((w) => text.includes(w));
    });

  const sorted = sortEntries(matched, sort);
  if (!q) return sorted;
  // Searching: best title match first, the chosen order breaks ties (stable sort keeps it).
  const scores = new Map(sorted.map((e) => [e.id, titleScore(e.title, words, q)]));
  return sorted.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
}
