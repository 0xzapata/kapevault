// The vault file's header (FORMAT.md), the same rule on the PC and the phone. Encryption stays in each
// host (Node crypto on the PC, WebCrypto + JS scrypt on the phone); this is only what a file must look
// like before any key derivation. The Forever Opener keeps its own copy (electron/opener/opener-crypto.cjs,
// a standalone page); opener.test.cjs holds the two to the same verdicts.

/** Written as "kapevault"; "bovault" is the same format from before the app was renamed. */
const VAULT_FORMATS = ["kapevault", "bovault"];
/** OWASP scrypt baseline, the only settings KAPEVault has ever written. */
export const VAULT_KDF = /** @type {{ readonly name: "scrypt", readonly N: number, readonly r: number, readonly p: number }} */ (Object.freeze({ name: "scrypt", N: 2 ** 17, r: 8, p: 1 }));
/** The newest vault format this app reads: the header version, and the `minReader` its writers stamp in the data. */
export const READER_VERSION = 1;
/** The largest vault file. Saving refuses anything bigger, so every copy fits each way back in: a restore
 * from a file or R2, sync's download, and the Forever Opener (opener-page.js repeats it). */
export const MAX_VAULT_BYTES = 64 * 1024 * 1024;

/**
 * A vault, backup or sync object written by a newer KAPEVault than this one. Never repaired and never
 * saved over: an older app that rewrote it would drop what the newer one added (FORMAT.md, Newer files).
 */
export class NewerVaultError extends Error {
  constructor() {
    super("This vault was saved by a newer KAPEVault. Update this app to open it.");
    this.name = "NewerVaultError";
  }
}

/**
 * @typedef {{ format: string, version: 1, kdf: { name: "scrypt", N: number, r: number, p: number, salt: string },
 *   iv: string, tag: string, data: string }} VaultFile
 */

/**
 * A vault file (or a backup someone hands you) must look exactly like one KAPEVault writes before any
 * work starts: the KDF settings come from the file, and p = 2^20 or r = 1000 would make unlock run for
 * hours without ever failing. N is exactly 2^17: a lower one on a file opened by key (Windows Hello) was
 * saved back unnoticed. Base64 is canonical (padded, nothing else, re-encoding gives the same text), so
 * the PC, the phone and the Opener accept the same headers. A later header version comes first: it
 * carries its own exact KDF settings, which this app has no way to know, so it is "newer", not "damaged".
 * @param {any} file @returns {VaultFile} the same object
 * @throws {NewerVaultError} a header version above 1 @throws {Error} "Not a KAPEVault file"
 */
export function checkVaultFile(file) {
  if (VAULT_FORMATS.includes(file?.format) && typeof file.version === "number" && file.version > READER_VERSION) throw new NewerVaultError();
  const k = file?.kdf;
  const ok =
    VAULT_FORMATS.includes(file?.format) &&
    file.version === 1 &&
    k?.name === VAULT_KDF.name &&
    k.N === VAULT_KDF.N &&
    k.r === VAULT_KDF.r &&
    k.p === VAULT_KDF.p &&
    base64Length(k.salt) === 16 &&
    base64Length(file.iv) === 12 &&
    base64Length(file.tag) === 16 &&
    base64Length(file.data) >= 0;
  if (!ok) throw new Error("Not a KAPEVault file");
  return file;
}

/**
 * Bytes or text as read from disk, R2 or a picked file -> a checked vault file, or null when this app
 * cannot read it (not a vault file, or a newer one: isNewerVaultFile tells the two apart).
 * @param {string | Uint8Array | null | undefined} input @returns {VaultFile | null}
 */
export function parseVaultFile(input) {
  try {
    return checkVaultFile(readJson(input));
  } catch {
    return null;
  }
}

/** Is this a vault file from a newer KAPEVault (a header version above 1)? False for anything else. @param {string | Uint8Array | null | undefined} input */
export function isNewerVaultFile(input) {
  try {
    checkVaultFile(readJson(input));
    return false;
  } catch (e) {
    return e instanceof NewerVaultError;
  }
}

// ignoreBOM keeps a leading BOM, so JSON.parse refuses the bytes as it refuses the same text.
function readJson(input) {
  return JSON.parse(typeof input === "string" ? input : new TextDecoder("utf-8", { ignoreBOM: true }).decode(input ?? undefined));
}

// The decoded length of canonical base64, or -1.
function base64Length(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return -1;
  try {
    const binary = atob(value);
    return btoa(binary) === value ? binary.length : -1;
  } catch {
    return -1;
  }
}
