// Made from the PC's src/features/vault/lib/filter-entries.ts by scripts/brands-sync.mjs - change it there, then run the script.
import type { Entry } from "../host/types";
import type { SortOrder } from "./filter";
import { signInOption } from "./sign-in";
import { deviceTypeLabel } from "./entries";

export function searchText(entry: Entry, spaceName: string): string {
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
    case "payee":
      specific = [entry.who, entry.relation, entry.provider, entry.number, entry.accountName, "payee"];
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

export function titleScore(title: string, words: string[], query: string): number {
  const t = title.toLowerCase();
  if (t.startsWith(query)) return 3;
  const titleWords = t.split(/[\s\-_.@/]+/);
  if (words.some((w) => titleWords.some((tw) => tw.startsWith(w)))) return 2;
  if (words.some((w) => t.includes(w))) return 1;
  return 0;
}

export const byTitle = (a: Entry, b: Entry) => a.title.localeCompare(b.title);

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
