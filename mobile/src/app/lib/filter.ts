// Which items a list shows and in what order: the PC's filter-entries.ts, same rules. What a search reads
// and how a list sorts are the PC's own code (lib/search.ts, made by scripts/sync-shared.mjs); the views
// and scopes around them are the phone's (no Closed or Closing view).
import type { Entry, Space } from "../host/types";
import { isGone, personKey } from "./entries";
import { searchText, sortEntries, titleScore } from "./search";

export type ViewFilter = "all" | "favorites" | "login" | "totp" | "note" | "key" | "link" | "thing" | "device" | "security" | "id";
export type SortOrder = "recent" | "title" | "edited";
export const SORT_LABELS: Record<SortOrder, string> = { recent: "Recently used", title: "Title", edited: "Date edited" };

// What a list is: a smart view, a space, or a person's items.
export type ListScope = { view: ViewFilter } | { spaceId: string } | { heldFor: string };

function matchesView(e: Entry, view: ViewFilter): boolean {
  if (isGone(e)) return false;
  switch (view) {
    case "all":
      return true;
    case "favorites":
      return e.favorite;
    case "totp":
      return e.kind === "login" && e.hasTotp;
    case "security":
      return e.issues.length > 0;
    default:
      return e.kind === view;
  }
}

function inScope(e: Entry, scope: ListScope) {
  if ("view" in scope) return matchesView(e, scope.view);
  if (isGone(e)) return false;
  if ("spaceId" in scope) return e.spaceId === scope.spaceId;
  return personKey(e.heldFor) === personKey(scope.heldFor);
}

// A search looks through the list on screen, like the PC's; best title match first.
export function filterEntries(entries: Entry[], spaces: Space[], scope: ListScope, query: string, sort: SortOrder): Entry[] {
  const names = new Map(spaces.map((s) => [s.id, s.name]));
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const matched = entries.filter((e) => inScope(e, scope) && words.every((w) => searchText(e, names.get(e.spaceId) ?? "").includes(w)));
  const sorted = sortEntries(matched, sort);
  if (!q) return sorted;
  const scores = new Map(sorted.map((e) => [e.id, titleScore(e.title, words, q)]));
  return sorted.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
}

export function countIn(entries: Entry[], scope: ListScope) {
  return entries.filter((e) => inScope(e, scope)).length;
}
