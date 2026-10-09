// Bitwarden JSON export (unencrypted): { encrypted: false, folders, collections?, items }.
import { ImportRefused, collector, fieldLines } from "./common.js";

export const label = "Bitwarden (JSON)";

const ENCRYPTED = 'That Bitwarden export is encrypted. In Bitwarden, export again and choose ".json" (not ".json (Encrypted)").';

/** @param {any} json */
export function matches(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return false;
  // An encrypted export has no items, only `data` and the key check: it is still Bitwarden's, to refuse.
  if (json.encrypted === true || typeof json.encKeyValidation_DO_NOT_EDIT === "string") return true;
  return Array.isArray(json.items) && (Array.isArray(json.folders) || "encrypted" in json);
}

// Newer item types (bank account, driver's license, passport): their fields come in as a secure note, as
// a card or an identity does. Key = the cipher type, value = the property that holds its fields.
const OTHER_RECORDS = { 6: "bankAccount", 7: "driversLicense", 8: "passport" };

const names = (list) => new Map((Array.isArray(list) ? list : []).map((f) => [f?.id, typeof f?.name === "string" ? f.name : ""]));

// A custom field can hold a secret, so fields never go into a login's plain notes: they get their own
// secure note beside it.
function extraFields(c, row, item) {
  const fields = (Array.isArray(item.fields) ? item.fields : []).map((f) => [f?.name || "Field", f?.type === 2 ? (f.value === "true" ? "yes" : "no") : f?.value]);
  const body = fieldLines(fields);
  if (body) c.note(row, { title: `${item.name || "Item"} (extra fields)`, body });
}

/** @param {any} json */
export function parse(json) {
  if (json.encrypted === true || typeof json.encKeyValidation_DO_NOT_EDIT === "string") throw new ImportRefused(ENCRYPTED);
  const c = collector();
  const folders = names(json.folders);
  const collections = names(json.collections);
  json.items.forEach((item, n) => {
    const row = n + 1;
    if (!item || typeof item !== "object") return c.skip(row, "Not an item");
    if (item.deletedDate) return c.skip(row, "In the Bitwarden trash");
    const folder = folders.get(item.folderId) ?? "";
    const tags = (Array.isArray(item.collectionIds) ? item.collectionIds : []).map((id) => collections.get(id)).filter(Boolean);
    const common = { title: item.name, folder, tags, favorite: item.favorite === true };
    const notes = typeof item.notes === "string" ? item.notes : "";
    if (item.type === 1 && item.login) {
      const uris = (Array.isArray(item.login.uris) ? item.login.uris : []).map((u) => u?.uri).filter((u) => typeof u === "string" && u.trim());
      const more = uris.length > 1 ? `Other websites: ${uris.slice(1).join(", ")}` : "";
      c.login(row, { ...common, url: uris[0], username: item.login.username, password: item.login.password, totp: item.login.totp, notes: [notes.trim(), more].filter(Boolean).join("\n") });
      extraFields(c, row, item);
      // A passkey's private key has no place in KAPEVault: the login comes in, the file stays.
      if (Array.isArray(item.login.fido2Credentials) && item.login.fido2Credentials.length) c.skip(row, "Passkey left out");
    } else if (item.type === 2) {
      c.note(row, { ...common, body: notes });
    } else if (item.type === 3 && item.card) {
      const k = item.card;
      const card = fieldLines([["Cardholder", k.cardholderName], ["Brand", k.brand], ["Number", k.number], ["Expires", [k.expMonth, k.expYear].filter(Boolean).join("/")], ["Security code", k.code]]);
      c.counts.asNotes += 1;
      c.note(row, { ...common, body: [card, notes].filter(Boolean).join("\n\n") });
      extraFields(c, row, item);
    } else if (item.type === 4 && item.identity) {
      c.counts.asNotes += 1;
      c.note(row, { ...common, body: [fieldLines(Object.entries(item.identity)), notes].filter(Boolean).join("\n\n") });
      extraFields(c, row, item);
    } else if (item.type === 5 && item.sshKey) {
      // The private key is the secret; the fingerprint names it and the public key rides in the notes.
      const k = item.sshKey;
      const secret = typeof k.privateKey === "string" ? k.privateKey : "";
      if (!secret.trim()) return c.skip(row, "SSH key with no private key");
      const publicKey = typeof k.publicKey === "string" && k.publicKey.trim() ? `Public key: ${k.publicKey.trim()}` : "";
      c.key(row, { ...common, keyId: k.keyFingerprint, secret, notes: [publicKey, notes.trim()].filter(Boolean).join("\n") });
      extraFields(c, row, item);
    } else if (OTHER_RECORDS[item.type] && item[OTHER_RECORDS[item.type]]) {
      c.counts.asNotes += 1;
      c.note(row, { ...common, body: [fieldLines(Object.entries(item[OTHER_RECORDS[item.type]])), notes].filter(Boolean).join("\n\n") });
      extraFields(c, row, item);
    } else c.skip(row, "Unknown item type");
  });
  return c.result();
}
