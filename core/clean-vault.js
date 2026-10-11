// Every vault is read as untrusted when it is opened. A restored backup or a synced snapshot may have
// been made by someone else, and the import and form rules never saw it: one malformed field made the
// page's view throw on every unlock (and sync carried it to every device), and a photo that was not a
// JPEG reached an <img>. Here each item keeps only fields of the type its kind stores - a field that is
// not is dropped, never guessed at - and a vault too deeply nested to save again is refused.
// Fields this version does not know are kept (a newer device's), inside the depth limit.
// A checker drops only a WRONG TYPE, never a value it does not recognise: a newer version's
// `signIn: "passkey"` dropped here was stamped as this device's edit by repair() and synced back
// as a deletion to every device (SECURITY-AUDIT-2026-09-28.md, review of the fixes: R-M1). The page falls back for a
// value it does not know. `photo` is the one exception: only a JPEG data URL is ever drawn.
import { KINDS } from "./entries.js";
import { cleanPhoto } from "./devices.js";
import { parseR2Url } from "./r2.js";
import { MAX_SPACE_PHOTO_BYTES } from "./spaces.js";
/** @import { VaultData } from "./entries.js" */

// Deeper than any vault KAPEVault writes (entries > item > backup codes > paper copy is 5).
export const MAX_DEPTH = 24;
const MAX_ID = 128;
// Every name Object.prototype has, plus "prototype": as an id or a field it reads as a function on a plain map.
const RESERVED = new Set([...Object.getOwnPropertyNames(Object.prototype), "prototype"]);

/** @param {unknown} v @returns {v is Record<string, any>} */
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v) => typeof v === "string";
const isId = (v) => isText(v) && v.length > 0 && v.length <= MAX_ID && !RESERVED.has(v);

// Each check answers the value to keep, or undefined to drop the field.
const text = (v) => (isText(v) ? v : undefined);
const smallInt = (v) => (Number.isInteger(v) && v >= 0 && v < 1000 ? v : undefined);
const listOf = (row) => (v) => (Array.isArray(v) ? v.map(row).filter((r) => r !== undefined) : undefined);
const recordOf = (fields) => (v) => (isRecord(v) ? keep(v, fields) : undefined);
const photoUnder = (/** @type {number | undefined} */ max) => (/** @type {unknown} */ v) => {
  try {
    return cleanPhoto(v, max);
  } catch {
    return undefined;
  }
};
const photo = photoUnder(undefined);

// Copies `value` with every known field checked; unknown fields ride along as they are.
/** @param {any} value @param {Record<string, (v: any) => any>} fields @returns {Record<string, any>} */
function keep(value, fields) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [name, field] of Object.entries(value)) {
    if (RESERVED.has(name)) continue;
    const checked = Object.hasOwn(fields, name) ? fields[name](field) : field;
    if (checked !== undefined) out[name] = checked;
  }
  return out;
}

// A list row is kept only with its one required text field (a history row without its password is none).
const row = (required, fields) => (v) => (isRecord(v) && isText(v[required]) ? keep(v, fields) : undefined);
const history = listOf(row("password", { password: text, changedAt: text }));
const recoveryCodes = (v) => {
  const set = recordOf({ codes: listOf(row("code", { code: text, used: (u) => (typeof u === "boolean" ? u : undefined) })), setAt: text, paper: listOf(row("where", { where: text, printedAt: text, outdatedAt: text })) })(v);
  return set?.codes ? set : undefined;
};
const genHistory = listOf(row("value", { value: text, at: text })); // core/generated.js
const questions = listOf(row("question", { question: text, answer: text }));
const lifecycle = (v) => (isRecord(v) && isText(v.state) ? keep(v, { state: text, requestedAt: text, followUpAt: text, goneAt: text }) : undefined);

const COMMON = {
  spaceId: text,
  title: text,
  tags: listOf(text),
  favorite: (v) => (typeof v === "boolean" ? v : undefined),
  notes: text,
  updatedAt: text,
  lastUsedAt: (v) => (Number.isFinite(v) ? v : undefined),
  brand: text,
  heldFor: text,
  trashedAt: text,
};
const BY_KIND = {
  login: { username: text, password: text, url: text, signIn: text, viaEntryId: text, totp: text, passwordChangedAt: text, history, recoveryCodes, questions, lifecycle },
  note: { body: text },
  key: { keyId: text, secret: text, url: text, expires: text },
  link: { linkType: text, location: text },
  thing: { room: text, spot: text, grab: smallInt, expires: text },
  device: { type: text, model: text, serial: text, imei: text, mac: text, adminUrl: text, adminUser: text, adminPassword: text, ssid: text, wifiPassword: text, photo },
  id: { idType: text, idNumber: text, photo },
};

// How deep a value nests, counted without recursion (a crafted file can nest 200,000 levels).
function tooDeep(value) {
  /** @type {[unknown, number][]} */
  const stack = [[value, 0]];
  while (stack.length) {
    const [v, depth] = /** @type {[unknown, number]} */ (stack.pop());
    if (typeof v !== "object" || v === null) continue;
    if (depth >= MAX_DEPTH) return true;
    for (const child of Object.values(v)) stack.push([child, depth + 1]);
  }
  return false;
}

// The R2 connection rides inside the vault, so a hostile backup could point every auto-backup (ciphertext
// plus the key ID) at its own host. Kept only when it is a real R2 bucket with both keys as text.
const cloud = (v) => {
  const target = isRecord(v) ? parseR2Url(`${v.endpoint}/${v.bucket}`) : null;
  return target && target.endpoint === v.endpoint && target.bucket === v.bucket && isText(v.accessKeyId) && isText(v.secretAccessKey) ? v : undefined;
};

/**
 * A decrypted vault, made safe to use. Throws when it is not a vault at all or nests too deeply.
 * @param {unknown} data @returns {VaultData}
 */
export function cleanVault(data) {
  if (!isRecord(data) || !Array.isArray(data.entries) || !Array.isArray(data.spaces) || tooDeep(data)) throw new Error("That vault's contents are damaged.");
  /** @type {any[]} */
  const spaces = data.spaces.filter((s) => isRecord(s) && isId(s.id) && isText(s.name)).map((s) => keep(s, { kind: text, photo: photoUnder(MAX_SPACE_PHOTO_BYTES) }));
  const seen = new Set();
  /** @type {any[]} */
  const entries = [];
  for (const e of data.entries) {
    if (!isRecord(e) || !isId(e.id) || !isText(e.kind) || seen.has(e.id)) continue;
    seen.add(e.id);
    entries.push(keep(e, { ...COMMON, ...(KINDS.includes(e.kind) ? BY_KIND[e.kind] : {}) }));
  }
  /** @type {Record<string, any>} */
  const out = {};
  for (const [name, value] of Object.entries(data)) if (!RESERVED.has(name)) out[name] = value;
  if (Object.hasOwn(out, "cloud") && cloud(out.cloud) === undefined) delete out.cloud;
  if (Object.hasOwn(out, "syncLog") && !Array.isArray(out.syncLog)) delete out.syncLog;
  if (Object.hasOwn(out, "genHistory")) {
    const kept = genHistory(out.genHistory);
    if (kept === undefined) delete out.genHistory;
    else out.genHistory = kept;
  }
  return { ...out, spaces, entries };
}
