// Bulk add from an import file: { space: "<client name>", ...entry fields, via: "<title of the login it
// signs in through>" }. Clients are created by name; an item already in that client (same kind + title)
// is skipped, so importing the same file twice adds nothing. All or nothing.
import { isRealDate } from "./dates.js";
import { DEVICE_TYPES, cleanImei, cleanMac, cleanPhoto } from "./devices.js";
import { dueToNotes } from "./due-to-note.js";
import { cleanIdNumber, cleanIdType } from "./ids.js";
import { GRAB, KINDS, LINK_TYPES, SIGN_IN, cleanText, upsertEntry } from "./entries.js";
import { parseTotp } from "./totp.js";
/** @import { VaultData } from "./entries.js" */

const MAX_IMPORT_ITEMS = 5000; // far above real use; stops a crafted file freezing the app

// An import file is deleted after import, so a field that would be silently blanked (a password
// typed as a number, kind "Login") must stop the whole import instead.
const IMPORT_TEXT_FIELDS = ["space", "title", "username", "password", "url", "location", "notes", "via", "totp", "body", "keyId", "secret", "expires", "who", "relation", "provider", "number", "accountName", "heldFor", "room", "spot", "type", "model", "serial", "imei", "mac", "adminUrl", "adminUser", "adminPassword", "ssid", "wifiPassword", "idType", "idNumber"];

function checkImportItem(item, i, checkFolder) {
  const where = `Item ${i + 1}`;
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${where} is not an entry.`);
  if (!KINDS.includes(item.kind)) throw new Error(`${where}: kind must be "login", "link", "note", "key", "payee", "thing", "device" or "id".`);
  for (const field of IMPORT_TEXT_FIELDS) {
    if (item[field] !== undefined && typeof item[field] !== "string") throw new Error(`${where}: ${field} must be text.`);
  }
  if (typeof item.title !== "string" || !item.title.trim()) throw new Error(`${where} has no title.`);
  if (item.tags !== undefined && !(Array.isArray(item.tags) && item.tags.every((t) => typeof t === "string"))) throw new Error(`${where}: tags must be a list of text.`);
  if (item.signIn !== undefined && !SIGN_IN.includes(item.signIn)) throw new Error(`${where}: unknown signIn "${String(item.signIn).slice(0, 20)}".`);
  if (item.linkType !== undefined && !LINK_TYPES.includes(item.linkType)) throw new Error(`${where}: unknown linkType.`);
  if (item.expires && !isRealDate(item.expires)) throw new Error(`${where}: expires must be YYYY-MM-DD.`);
  if (item.grab !== undefined && !GRAB.includes(item.grab)) throw new Error(`${where}: grab must be 1, 2 or 3.`);
  if (item.kind === "thing" && !cleanText(item.spot)) throw new Error(`${where}: a thing needs its spot.`);
  if (item.kind === "device" && item.type !== undefined && !DEVICE_TYPES.includes(item.type)) throw new Error(`${where}: type must be ${DEVICE_TYPES.map((t) => `"${t}"`).join(", ")}.`);
  try {
    if (item.kind === "device") {
      cleanImei(item.imei);
      cleanMac(item.mac);
    }
    if (item.kind === "id") {
      cleanIdType(item.idType);
      cleanIdNumber(item.idNumber);
    }
    if ((item.kind === "device" || item.kind === "id") && item.photo !== undefined) cleanPhoto(item.photo);
  } catch (e) {
    throw new Error(`${where}: ${e.message}.`);
  }
  // An import file can come from someone else. A network folder would make Windows send the user's
  // password hash to that server the moment the item is opened (on whichever device it ends up), so it
  // is refused by name before the host looks at the path at all.
  const location = cleanText(item.location);
  if (item.kind === "link" && location) {
    if (/^[\\/]{2}/.test(location)) throw new Error(`${where}: network folders (\\\\server\\...) cannot be imported. Add them by hand.`);
    checkFolder(location, where);
  }
  if (item.totp) {
    try {
      parseTotp(item.totp);
    } catch (e) {
      throw new Error(`${where}: ${e.message}`);
    }
  }
}

// An ID left untitled is named after its type, as the form names it.
function titleId(item) {
  const untitled = item?.kind === "id" && (item.title === undefined || (typeof item.title === "string" && !item.title.trim()));
  return untitled && typeof item.idType === "string" ? { ...item, title: item.idType.trim() } : item;
}

// checkFolder(location, where): the host's own rule for a local folder link, after the name checks (the
// PC refuses a whole drive or the home folder, judged by the real path on its disk). It throws to stop
// the import.
/**
 * @param {VaultData} data
 * @param {unknown} file the import file's entries
 * @param {(location: string, where: string) => void} [checkFolder]
 * @returns {{ added: number, skipped: number }}
 */
export function importEntries(data, file, checkFolder = () => {}) {
  if (!Array.isArray(file) || file.length === 0) throw new Error("The file has no items to import.");
  if (file.length > MAX_IMPORT_ITEMS) throw new Error(`The file has ${file.length} items; KAPEVault imports up to ${MAX_IMPORT_ITEMS} at a time.`);
  const items = dueToNotes(file).map(titleId); // dueToNotes: a file made while due dates existed
  const before = { spaces: data.spaces, entries: data.entries };
  const same = (a, b) => cleanText(a).toLowerCase() === cleanText(b).toLowerCase();
  let added = 0;
  try {
    const links = [];
    items.forEach((item, i) => checkImportItem(item, i, checkFolder)); // every item is checked before anything changes
    items.forEach((item) => {
      const spaceName = cleanText(item.space);
      let space = spaceName ? data.spaces.find((s) => same(s.name, spaceName)) : data.spaces.find((s) => s.kind === "personal");
      if (!space) {
        space = { id: globalThis.crypto.randomUUID(), name: spaceName, kind: "client" };
        data.spaces = [...data.spaces, space];
      }
      const kind = item.kind;
      // A closed account's tombstone never blocks signing up there again.
      if (data.entries.some((e) => e.spaceId === space.id && e.kind === kind && same(e.title, item.title) && e.lifecycle?.state !== "gone")) return;
      const id = upsertEntry(data, { ...item, id: undefined, kind, spaceId: space.id, viaEntryId: undefined });
      added += 1;
      if (kind === "login" && cleanText(item.via)) links.push({ id, spaceId: space.id, via: item.via });
    });
    // Second pass: "via" names another login in the same client, which may come later in the file
    // (the account an OAuth login signs in through).
    for (const { id, spaceId, via } of links) {
      const target = data.entries.find((e) => e.kind === "login" && e.spaceId === spaceId && e.id !== id && e.lifecycle?.state !== "gone" && same(e.title, via));
      if (target) data.entries = data.entries.map((e) => (e.id === id && e.signIn !== "password" ? { ...e, viaEntryId: target.id } : e));
    }
  } catch (e) {
    data.spaces = before.spaces;
    data.entries = before.entries;
    throw e;
  }
  return { added, skipped: items.length - added };
}
