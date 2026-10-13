// An item's rules: what each kind keeps, how a save cleans it, and the small changes made outside the
// form. Every change replaces top-level fields of `data` (entries, spaces) and never edits them in
// place, so the host can roll a failed save back to a shallow copy.
import { isRealDate, today } from "./dates.js";
import { DEVICE_TYPES, MAX_PHOTOS_BYTES, cleanImei, cleanMac, cleanPhoto } from "./devices.js";
import { cleanIdNumber, cleanIdType } from "./ids.js";
import { parseTotp } from "./totp.js";

/** @typedef {{ id: string, kind: string, spaceId: string, title: string, [field: string]: any }} Entry */
/** @typedef {{ id: string, name: string, kind: string, photo?: string }} Space "personal" (one per vault) or "client"; photo in place of its initials */
/** @typedef {{ spaces: Space[], entries: Entry[], [field: string]: any }} VaultData */

export const KINDS = ["login", "link", "note", "key", "thing", "device", "id"];
export const LINK_TYPES = ["web", "drive", "folder", "doc"];
export const SIGN_IN = ["password", "google", "microsoft", "apple", "github", "facebook", "email-link", "sso"];
export const GRAB = [1, 2, 3]; // a thing in a hurry: 1 grab first, 2 if there is time, 3 leave it
const DEFAULT_GRAB = 2;
export const HISTORY_LIMIT = 10; // a login's replaced passwords kept (merge.js keeps the same cap)
const MAX_QUESTIONS = 10;
const MAX_QUESTION_LENGTH = 300;
const MAX_ANSWER_LENGTH = 200;

/** @returns {string} */
export function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

// A key secret, trimmed, but one final newline stays when it had one: OpenSSH can refuse a private key without it.
function trimKeepingFinalNewline(text) {
  const body = text.trim();
  return body && /\n\s*$/.test(text) ? `${body}\n` : body;
}

// When an API key or a thing (a passport, a license) runs out: a real YYYY-MM-DD, or none. stored: the
// saved value, let through unchanged (an older import let in days like 2026-02-31).
function cleanExpiry(value, stored) {
  const expires = cleanText(value);
  if (expires && expires !== stored && !isRealDate(expires)) throw new Error("Expiry must be a date");
  return expires || undefined;
}

// When a login's password was last set. Pre-v2 logins fall back to their last edit.
function passwordAge(entry) {
  if (entry.kind !== "login" || !entry.password) return undefined;
  return entry.passwordChangedAt ?? entry.updatedAt;
}

// Security questions from the form: [{ question, answer?, from? }]. An answer left undefined is the
// stored one at index `from` (the form only has the answers it loaded), so reordering or removing a
// row never moves an answer onto another question. A row left empty is dropped.
function cleanQuestions(input, stored = []) {
  if (!Array.isArray(input)) throw new Error("Security questions: expected a list");
  const questions = [];
  for (const row of input) {
    if (!row || typeof row !== "object") throw new Error("Security questions: each needs a question");
    if (row.answer !== undefined && typeof row.answer !== "string") throw new Error("Security questions: an answer must be text");
    const question = cleanText(row.question);
    const answer = row.answer !== undefined ? row.answer.trim() : (stored[row.from]?.answer ?? "");
    if (!question && !answer) continue;
    if (!question) throw new Error("Security questions: each answer needs its question");
    if (question.length > MAX_QUESTION_LENGTH || answer.length > MAX_ANSWER_LENGTH) throw new Error("Security questions: that one is too long");
    questions.push({ question, answer });
  }
  if (questions.length > MAX_QUESTIONS) throw new Error(`Security questions: up to ${MAX_QUESTIONS}`);
  return questions.length ? questions : undefined;
}

// "" or missing = no 2FA. Anything else must parse; the stored form is the normalized otpauth URI.
function normalizeTotp(value) {
  const text = cleanText(value);
  return text ? parseTotp(text).uri : "";
}

/** @param {VaultData} data @param {string} id @returns {Entry} */
export function findEntry(data, id) {
  const entry = data.entries.find((e) => e.id === id);
  if (!entry) throw new Error("Item not found");
  return entry;
}

// In the Trash (trash.js): `trashedAt` is a UTC timestamp. Defined here so entries.js needs nothing from trash.js.
/** @param {Record<string, any>} entry */
export const isTrashed = (entry) => typeof entry?.trashedAt === "string" && entry.trashedAt !== "";

// An item in the Trash gives up no secret, copy, code or link (both apps read secrets through this, and
// the phone's autofill reads a login's password that way, so a trashed login is never filled).
export function findLiveEntry(data, id) {
  const entry = findEntry(data, id);
  if (isTrashed(entry)) throw new Error("This item is in the Trash. Restore it first");
  return entry;
}

// A closed account's tombstone is read only: nothing about it changes except deleting it. An item in
// the Trash is read only too until it is restored.
function refuseGone(entry) {
  if (entry.lifecycle?.state === "gone") throw new Error("This account is closed and read only");
  if (isTrashed(entry)) throw new Error("This item is in the Trash. Restore it first");
  return entry;
}

// A login that is still live (not a closed account's tombstone). notLogin: what to say when it is another kind.
/** @param {VaultData} data @param {string} id @param {string} notLogin @returns {Entry} */
export function liveLogin(data, id, notLogin) {
  const entry = findEntry(data, id);
  if (entry.kind !== "login") throw new Error(notLogin);
  return refuseGone(entry);
}

// A login another login signs in through (an OAuth account): saved, open, not itself.
function liveLoginId(data, id, selfId) {
  return data.entries.some((e) => e.id === id && e.kind === "login" && e.id !== selfId && e.lifecycle?.state !== "gone" && !isTrashed(e)) ? id : undefined;
}

// A device's label photo or an ID's: left undefined, the stored one stays.
const keptPhoto = (input, same) => (input.photo === undefined ? same?.photo : cleanPhoto(input.photo));

// Each kind's own fields on top of the shared ones (base). same: the stored item when the edit keeps its
// kind, else null. A secret field left undefined keeps the stored one; a refused value throws.
const KIND_FIELDS = {
  login(input, same, base, data) {
    const kept = same ? same.password : "";
    const password = typeof input.password === "string" ? input.password : kept;
    // A replaced password is kept as history, newest first, so a client's rotation never loses the old one.
    let history = same?.history ?? [];
    // Logins from before v2 have no passwordChangedAt; their last edit date is the best guess, and it
    // must be pinned now or this edit would reset the "not changed in a year" check.
    let passwordChangedAt = same ? passwordAge(same) : undefined;
    if (password !== kept) {
      // A UTC timestamp, as sync writes a password that lost (merge.js): one zone, so the rows sort by
      // time on every device. Rows from before are a local YYYY-MM-DD.
      if (kept) history = [{ password: kept, changedAt: new Date().toISOString() }, ...history].slice(0, HISTORY_LIMIT);
      passwordChangedAt = password ? today() : undefined;
    }
    const totp = typeof input.totp === "string" ? normalizeTotp(input.totp) : (same?.totp ?? "");
    // A newer version's value this one does not know is kept while the edit leaves it as it was.
    const signIn = SIGN_IN.includes(input.signIn) || (same && input.signIn === same.signIn) ? input.signIn : "password";
    const via = signIn !== "password" ? liveLoginId(data, input.viaEntryId, base.id) : undefined;
    // Questions not sent (an import, an older caller) stay as they are.
    const questions = input.questions === undefined ? same?.questions : cleanQuestions(input.questions, same?.questions);
    return { ...base, kind: "login", username: cleanText(input.username), password, url: cleanText(input.url), signIn, viaEntryId: via, totp: totp || undefined, history: history.length ? history : undefined, passwordChangedAt, recoveryCodes: same?.recoveryCodes, questions, lifecycle: same?.lifecycle };
  },
  note(input, same, base) {
    const body = typeof input.body === "string" ? input.body : (same?.body ?? "");
    return { ...base, kind: "note", body };
  },
  key(input, same, base) {
    // One final newline is kept: OpenSSH can refuse a pasted private key that ends without it.
    const secret = typeof input.secret === "string" ? trimKeepingFinalNewline(input.secret) : (same?.secret ?? "");
    return { ...base, kind: "key", keyId: cleanText(input.keyId), secret, url: cleanText(input.url), expires: cleanExpiry(input.expires, same?.expires) };
  },
  // Where a physical thing is kept (a passport, a land title), for the day you have to leave fast.
  thing(input, same, base) {
    const spot = cleanText(input.spot);
    if (!spot) throw new Error("Say where it is kept");
    const grab = input.grab === undefined ? DEFAULT_GRAB : input.grab;
    if (!GRAB.includes(grab) && grab !== same?.grab) throw new Error("Grab must be 1, 2 or 3");
    return { ...base, brand: undefined, kind: "thing", room: cleanText(input.room) || undefined, spot, grab, expires: cleanExpiry(input.expires, same?.expires) };
  },
  // A router, CCTV box or phone and what is printed on its sticker. The two passwords and the label
  // photo are secrets: left undefined, the stored ones stay (the form only has what it loaded).
  device(input, same, base) {
    const type = input.type === undefined ? "other" : input.type;
    if (!DEVICE_TYPES.includes(type) && type !== same?.type) throw new Error("Unknown device type");
    const kept = (field) => (typeof input[field] === "string" ? input[field] : (same?.[field] ?? ""));
    const text = (field) => cleanText(input[field]) || undefined;
    return {
      ...base,
      kind: "device",
      type,
      model: text("model"),
      serial: text("serial"),
      imei: cleanImei(input.imei),
      mac: cleanMac(input.mac),
      adminUrl: text("adminUrl"),
      adminUser: text("adminUser"),
      adminPassword: kept("adminPassword") || undefined,
      ssid: text("ssid"),
      wifiPassword: kept("wifiPassword") || undefined,
      photo: keptPhoto(input, same),
    };
  },
  // An identity card. The number and the photo are secrets: left undefined, the stored ones stay. No
  // brand: an ID keeps its card glyph.
  id(input, same, base) {
    const idNumber = typeof input.idNumber === "string" ? cleanIdNumber(input.idNumber) : same?.idNumber;
    return { ...base, brand: undefined, kind: "id", idType: cleanIdType(input.idType), idNumber, photo: keptPhoto(input, same) };
  },
  link(input, same, base) {
    const linkType = LINK_TYPES.includes(input.linkType) || (same && input.linkType === same.linkType) ? input.linkType : "web";
    return { ...base, kind: "link", linkType, location: cleanText(input.location) };
  },
};

// Adds or updates one entry. Returns the entry id.
// A secret field left undefined keeps the stored one (the form never received it unless revealed).
/** @param {VaultData} data @param {Record<string, any>} input @returns {string} */
export function upsertEntry(data, input) {
  const title = cleanText(input.title);
  if (!title) throw new Error("Title is required");
  if (!data.spaces.some((s) => s.id === input.spaceId)) throw new Error("Unknown space");
  if (!KINDS.includes(input.kind)) throw new Error("Unknown item type");

  const existing = data.entries.find((e) => e.id === input.id);
  if (existing) refuseGone(existing);
  const same = existing && existing.kind === input.kind ? existing : null;
  const base = {
    id: existing ? existing.id : globalThis.crypto.randomUUID(),
    spaceId: input.spaceId,
    title,
    tags: (input.tags ?? []).map(cleanText).filter(Boolean),
    favorite: Boolean(input.favorite),
    notes: typeof input.notes === "string" ? input.notes : "",
    updatedAt: today(),
    brand: typeof input.brand === "string" && /^[a-z0-9-]{1,40}$/.test(input.brand) ? input.brand : undefined,
    lastUsedAt: existing?.lastUsedAt,
    heldFor: cleanText(input.heldFor) || undefined, // the person this item is kept for ("Mama")
  };

  const entry = KIND_FIELDS[input.kind](input, same, base, data);

  // Every photo (a device's label, an ID) shares one cap, as stored.
  if (entry.photo && entry.photo !== same?.photo) {
    const others = data.entries.reduce((n, e) => n + (e.id !== entry.id && e.photo ? e.photo.length : 0), 0);
    if (others + entry.photo.length > MAX_PHOTOS_BYTES) throw new Error("There is no room for more photos. Remove a photo from another item first.");
  }

  data.entries = existing ? data.entries.map((e) => (e.id === entry.id ? entry : e)) : [...data.entries, entry];
  return entry.id;
}

/** Changes some fields of a stored item. @param {VaultData} data @param {string} id @param {Record<string, any>} changes */
export function patchEntry(data, id, changes) {
  return upsertEntry(data, { ...findEntry(data, id), ...changes });
}

// Drops entries and any sign-in links that pointed at them.
/** @param {VaultData} data @param {Set<string>} ids */
export function removeEntries(data, ids) {
  data.entries = data.entries
    .filter((e) => !ids.has(e.id))
    .map((e) => (ids.has(e.viaEntryId) ? { ...e, viaEntryId: undefined } : e));
}

/** @param {VaultData} data @param {string} id */
export function toggleFavorite(data, id) {
  refuseGone(findEntry(data, id));
  data.entries = data.entries.map((e) => (e.id === id ? { ...e, favorite: !e.favorite } : e));
}

/** @param {VaultData} data @param {string} id @param {string} spaceId */
export function moveEntry(data, id, spaceId) {
  refuseGone(findEntry(data, id));
  if (!data.spaces.some((s) => s.id === spaceId)) throw new Error("Unknown space");
  data.entries = data.entries.map((e) => (e.id === id ? { ...e, spaceId, updatedAt: today(), passwordChangedAt: passwordAge(e) } : e));
}

// Using an item (copy, open) feeds "Recently used". False when there is nothing to note: a tombstone
// keeps only what it was closed with (copying its username is not a use).
/** @param {VaultData} data @param {string} id @returns {boolean} */
export function touchEntry(data, id) {
  if (!data.entries.some((e) => e.id === id && e.lifecycle?.state !== "gone" && !isTrashed(e))) return false;
  data.entries = data.entries.map((e) => (e.id === id ? { ...e, lastUsedAt: Date.now() } : e));
  return true;
}

/** @param {VaultData} data @param {string} id */
export function clearHistory(data, id) {
  data.entries = data.entries.map((e) => (e.id === id && e.kind === "login" ? { ...e, history: undefined } : e));
}
