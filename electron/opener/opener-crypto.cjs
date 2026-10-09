// The Forever Opener's crypto: the same scrypt -> AES-256-GCM as vault-crypto.cjs, in plain browser
// JavaScript (WebCrypto for AES-GCM, core/scrypt.js for the key), so a vault file opens in any modern
// browser with no KAPEVault installed. This file is inlined into the opener page by opener.cjs, after
// core/scrypt.js, and tested in Node (opener.test.cjs) - keep it dependency-free.

// Mirrors checkVaultFile() in core/vault-format.js (vault-crypto.cjs re-exports it): the KDF settings come from the file, so a file with
// p = 2^20 would never finish opening. Checked before any work starts.
const OPENER_FORMATS = ["kapevault", "bovault"]; // "bovault" = saved before the app was renamed
const MAX_N = 2 ** 17;

// Canonical base64 only, as vault-crypto.cjs and the phone read it: atob alone skips spaces and missing
// padding, so the three readers disagreed on the same header.
function base64Bytes(value) {
  if (typeof value !== "string" || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  try {
    const binary = atob(value);
    return btoa(binary) === value ? Uint8Array.from(binary, (c) => c.charCodeAt(0)) : null;
  } catch {
    return null;
  }
}

// A header version above 1 is a later KAPEVault's file: it carries its own KDF settings, so it is "newer",
// not "not a vault" (core/vault-format.js checks it first, the same way). Still refused; only the words differ.
function isNewerFile(file) {
  return OPENER_FORMATS.includes(file?.format) && typeof file.version === "number" && file.version > 1;
}

function checkOpenerFile(file) {
  const k = file?.kdf;
  const sized = (v, bytes) => base64Bytes(v)?.length === bytes;
  return (
    OPENER_FORMATS.includes(file?.format) &&
    file.version === 1 &&
    k?.name === "scrypt" &&
    k.N === MAX_N &&
    k.r === 8 &&
    k.p === 1 &&
    sized(k.salt, 16) &&
    sized(file.iv, 12) &&
    sized(file.tag, 16) &&
    typeof file.data === "string"
  );
}

// scrypt (core/scrypt.js) is inlined just above this file in the page; Node tests load it by path.
// @ts-ignore - in the page `scrypt` is that inlined function, so this is a plain read of it.
const deriveKey = typeof module === "object" ? require("../../core/scrypt.js").scrypt : scrypt;
// A pause every 1024 rounds repaints the progress bar (see STEP_ROUNDS in core/scrypt.js).
const OPENER_STEP_ROUNDS = 1024;

// The decoded vault, or null when the password is wrong or the file was altered (GCM's tag).
// Throws when the file is not a KAPEVault vault at all, or is a newer one's. The password is NFC-normalised like the app.
async function openVault(file, password, step) {
  if (isNewerFile(file)) throw new Error("Newer KAPEVault vault file");
  const data = checkOpenerFile(file) && base64Bytes(file.data); // decoded first: no scrypt for a bad file
  if (!data) throw new Error("Not a KAPEVault vault file");
  const tag = /** @type {Uint8Array} */ (base64Bytes(file.tag));
  const secret = new TextEncoder().encode(password.normalize("NFC"));
  const raw = await deriveKey(secret, base64Bytes(file.kdf.salt), file.kdf, 32, step, OPENER_STEP_ROUNDS);
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  raw.fill(0);
  // WebCrypto takes the 16-byte tag appended to the ciphertext.
  const sealed = new Uint8Array(data.length + 16);
  sealed.set(data);
  sealed.set(tag, data.length);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: /** @type {Uint8Array} */ (base64Bytes(file.iv)), tagLength: 128 }, key, sealed);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

if (typeof module === "object") module.exports = { checkOpenerFile, isNewerFile, openVault };
