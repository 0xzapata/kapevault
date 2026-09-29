// How items are named and described, as the PC says it (src/features/vault/lib, devices, things). The
// values each list offers are core's (the ones a save keeps); the words are the page's.
import { DEVICE_TYPES as DEVICE_VALUES, GRAB as GRAB_VALUES, LINK_TYPES as LINK_VALUES } from "@core";
import type { DeviceType, Entry, EntryKind, GrabPriority, Issue, LinkType, SignInMethod } from "../host/types";
import { formatDay, formatNumber } from "./format";
import { signInOption } from "./sign-in";

// The kind picker, in the phone's order (core's KINDS in another; kinds.test.mjs holds the two sets equal).
export const KINDS: { value: EntryKind; label: string }[] = [
  { value: "login", label: "Login" },
  { value: "note", label: "Secure note" },
  { value: "key", label: "API key" },
  { value: "link", label: "File link" },
  { value: "payee", label: "Payee" },
  { value: "thing", label: "Thing" },
  { value: "device", label: "Device" },
  { value: "id", label: "ID" },
];

// The ways to sign in are the PC's list: SIGN_IN_OPTIONS in lib/sign-in.ts, made from it by brands-sync.
export const signInLabel = (m: SignInMethod) => signInOption(m).label;

const LINK_LABELS: Record<LinkType, string> = { web: "Web link", drive: "Google Drive", folder: "Local folder", doc: "Document" };
export const LINK_TYPES = (LINK_VALUES as LinkType[]).map((value) => ({ value, label: LINK_LABELS[value] }));

const DEVICE_LABELS: Record<DeviceType, string> = { router: "Router", cctv: "CCTV / NVR", phone: "Phone", laptop: "Laptop", other: "Other" };
export const DEVICE_TYPES = (DEVICE_VALUES as DeviceType[]).map((value) => ({ value, label: DEVICE_LABELS[value] }));
export const deviceTypeLabel = (t: DeviceType) => DEVICE_TYPES.find((o) => o.value === t)?.label ?? "Other";
const deviceName = (t: DeviceType) => (t === "other" ? "Device" : deviceTypeLabel(t));

const GRAB_LABELS: Record<GrabPriority, string> = { 1: "Grab first", 2: "If there is time", 3: "Leave it" };
export const GRAB = (GRAB_VALUES as GrabPriority[]).map((value) => ({ value, label: GRAB_LABELS[value] }));
export const grabLabel = (g: GrabPriority) => GRAB.find((o) => o.value === g)?.label ?? "";

export const isGone = (e: Entry) => e.kind === "login" && e.lifecycle?.state === "gone";

// "Login", "Google sign-in", "Secure note", "Router".
export function kindLabel(e: Entry): string {
  switch (e.kind) {
    case "login":
      if (isGone(e)) return "Closed account";
      return e.signIn === "password" ? "Login" : `${signInLabel(e.signIn)} sign-in`;
    case "note":
      return "Secure note";
    case "key":
      return "API key";
    case "link":
      return LINK_TYPES.find((t) => t.value === e.linkType)?.label ?? "Link";
    case "payee":
      return "Payee";
    case "thing":
      return "Thing";
    case "device":
      return deviceName(e.type);
    case "id":
      return "ID";
  }
}

// The line under a list row's title.
export function subtitle(e: Entry): string {
  switch (e.kind) {
    case "link":
      return e.location;
    case "note":
      return "Secure note";
    case "key":
      return e.keyId || "API key";
    case "payee":
      return `${e.provider} · ${formatNumber(e.number)}`;
    case "thing":
      return e.room ? `${e.room} · ${e.spot}` : e.spot;
    case "device":
      return [deviceName(e.type), e.model || e.ssid].filter(Boolean).join(" · ");
    case "id":
      return e.title === e.idType ? "ID" : e.idType; // the PC's idSubtitle
    default: {
      if (e.lifecycle?.goneAt) return `Closed ${formatDay(e.lifecycle.goneAt)}`;
      if (e.signIn === "password") return e.username;
      const via = `${signInLabel(e.signIn)} sign-in`;
      return e.username ? `${via} - ${e.username}` : via;
    }
  }
}

export const isSerious = (i: Issue) => i.type === "reused" || i.type === "weak" || i.type === "expired" || (i.type === "codes" && i.left === 0);

// "3 reused · 2 weak" for the Security list's count line.
export function issueSummary(entries: Entry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) for (const i of e.issues) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);
  const names: Record<string, string> = { reused: "reused", weak: "weak", old: "old", expired: "expired", expiring: "expiring soon", codes: "low on backup codes" };
  return Object.keys(names)
    .filter((k) => counts.get(k))
    .map((k) => `${counts.get(k)} ${names[k]}`)
    .join(" · ");
}

// Everyone something is held for, A-Z; "Mama" and "mama " are one person.
export const personKey = (name: string | undefined) => (name ?? "").trim().toLowerCase();
export function peopleHeldFor(entries: Entry[]) {
  const people = new Map<string, { name: string; count: number }>();
  for (const e of entries) {
    const key = personKey(e.heldFor);
    if (!key) continue;
    const p = people.get(key);
    if (p) p.count += 1;
    else people.set(key, { name: e.heldFor!.trim(), count: 1 });
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// The item's own link (website, admin page, location), if it has one.
export function linkOf(e: Entry): string {
  if (e.kind === "login" || e.kind === "key") return e.url;
  if (e.kind === "link") return e.location;
  if (e.kind === "device") return e.adminUrl;
  return "";
}
