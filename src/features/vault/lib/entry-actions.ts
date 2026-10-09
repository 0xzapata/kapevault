import { vaultApi } from "../../../lib/vault-api.ts";
import type { Entry } from "../types";

// Every copy an item offers, once. The keyboard map, the row menu, quick search and the detail pills
// all derive from this list. Every copy goes through the main process, which clears copied secrets
// after 30s and records the use.
//   secret   - mod+Shift+C: a password, a key's secret, a note, a Wi-Fi password, an ID number
//   username - mod+C: a username, a key ID, a thing's spot, a Wi-Fi name
//   totp     - mod+Alt+C: a login's 2FA code
//   imei     - a phone's IMEI (detail pills only)
export type CopySlot = "secret" | "username" | "totp" | "imei";

export interface EntryCopy {
  slot: CopySlot;
  label: string; // "Copy password"
  toast: string; // "Password copied - clears in 30s"
  run: () => Promise<unknown>;
}

const CLEARS = " - clears in 30s";

// In slot order: secret, username, totp, imei.
export function entryCopies(entry: Entry): EntryCopy[] {
  const id = entry.id;
  const text = (value: string) => () => vaultApi.copyText(value, id);
  const copies: EntryCopy[] = [];
  const add = (slot: CopySlot, label: string, toast: string, run: () => Promise<unknown>) => copies.push({ slot, label, toast, run });
  switch (entry.kind) {
    case "login":
      if (entry.hasPassword) add("secret", "Copy password", `Password copied${CLEARS}`, () => vaultApi.copyPassword(id));
      if (entry.username) add("username", "Copy username", "Username copied", text(entry.username));
      if (entry.hasTotp) add("totp", "Copy code", "2FA code copied", () => vaultApi.copyTotp(id));
      break;
    case "key":
      if (entry.hasSecret) add("secret", "Copy secret", `Secret copied${CLEARS}`, () => vaultApi.copySecret(id, "secret"));
      if (entry.keyId) add("username", "Copy key ID", "Key ID copied", text(entry.keyId));
      break;
    case "note":
      if (entry.hasBody) add("secret", "Copy note", `Note copied${CLEARS}`, () => vaultApi.copySecret(id, "body"));
      break;
    case "thing":
      add("username", "Copy spot", "Spot copied", text(entry.spot));
      break;
    case "device":
      if (entry.hasWifiPassword) add("secret", "Copy Wi-Fi password", `Wi-Fi password copied${CLEARS}`, () => vaultApi.copySecret(id, "wifiPassword"));
      if (entry.ssid) add("username", "Copy Wi-Fi name", "Wi-Fi name copied", text(entry.ssid));
      if (entry.imei) add("imei", "Copy IMEI", "IMEI copied", text(entry.imei));
      break;
    case "id":
      if (entry.hasNumber) add("secret", "Copy ID number", `ID number copied${CLEARS}`, () => vaultApi.copySecret(id, "idNumber"));
      break;
  }
  return copies;
}

export const copyIn = (entry: Entry, slot: CopySlot) => entryCopies(entry).find((c) => c.slot === slot);

// Runs one slot's copy. Returns the toast text, or null when the item has nothing in that slot.
async function runSlot(entry: Entry, slot: CopySlot): Promise<string | null> {
  const copy = copyIn(entry, slot);
  if (!copy) return null;
  await copy.run();
  return copy.toast;
}

export const copyUsername = (entry: Entry) => runSlot(entry, "username");
export const copySecretOf = (entry: Entry) => runSlot(entry, "secret");
export const copyCode = (entry: Entry) => runSlot(entry, "totp");

export function linkOf(entry: Entry): string {
  if (entry.kind === "link") return entry.location;
  if (entry.kind === "login" || entry.kind === "key") return entry.url;
  return entry.kind === "device" ? entry.adminUrl : "";
}

// The Open action's name in quick search. The row menu and the detail pill word a few kinds
// differently (see rowMenu in row-menu.tsx and QuickActions).
export function openLabel(entry: Entry): string {
  if (entry.kind === "link") return entry.linkType === "folder" ? "Open folder" : "Open link";
  return entry.kind === "device" ? "Open admin page" : "Open website";
}

export async function openEntry(entry: Entry): Promise<string | null> {
  const link = linkOf(entry);
  if (!link) return null;
  await vaultApi.openEntry(entry.id);
  return entry.kind === "link" && entry.linkType === "folder" ? "Opened the folder" : "Opened";
}

// Enter: the one thing you most likely opened this item to do. A link opens; anything else copies
// its secret, then its username, then opens its link - the first one it has.
export function primaryCopy(entry: Entry): EntryCopy | undefined {
  return entry.kind === "link" ? undefined : (copyIn(entry, "secret") ?? copyIn(entry, "username"));
}

export async function primaryAction(entry: Entry): Promise<string | null> {
  const copy = primaryCopy(entry);
  if (!copy) return openEntry(entry);
  await copy.run();
  return copy.toast;
}
