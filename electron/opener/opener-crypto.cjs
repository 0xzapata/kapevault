// The Forever Opener's crypto: the same scrypt -> AES-256-GCM as vault-crypto.cjs, in plain browser
// JavaScript (WebCrypto for PBKDF2 and AES-GCM, scrypt's Salsa20/8 mixing by hand), so a vault file
// opens in any modern browser with no KAPEVault installed. This file is inlined into the opener page
// by opener.cjs and tested in Node against crypto.scrypt (opener.test.cjs) - keep it dependency-free.

// Mirrors checkVaultFile() in vault-crypto.cjs: the KDF settings come from the file, so a file with
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

// Salsa20/8 core, in place on 16 words.
function salsa208(x) {
  let x0 = x[0], x1 = x[1], x2 = x[2], x3 = x[3], x4 = x[4], x5 = x[5], x6 = x[6], x7 = x[7];
  let x8 = x[8], x9 = x[9], x10 = x[10], x11 = x[11], x12 = x[12], x13 = x[13], x14 = x[14], x15 = x[15];
  for (let i = 0; i < 8; i += 2) {
    let t;
    t = x0 + x12; x4 ^= (t << 7) | (t >>> 25);
    t = x4 + x0; x8 ^= (t << 9) | (t >>> 23);
    t = x8 + x4; x12 ^= (t << 13) | (t >>> 19);
    t = x12 + x8; x0 ^= (t << 18) | (t >>> 14);
    t = x5 + x1; x9 ^= (t << 7) | (t >>> 25);
    t = x9 + x5; x13 ^= (t << 9) | (t >>> 23);
    t = x13 + x9; x1 ^= (t << 13) | (t >>> 19);
    t = x1 + x13; x5 ^= (t << 18) | (t >>> 14);
    t = x10 + x6; x14 ^= (t << 7) | (t >>> 25);
    t = x14 + x10; x2 ^= (t << 9) | (t >>> 23);
    t = x2 + x14; x6 ^= (t << 13) | (t >>> 19);
    t = x6 + x2; x10 ^= (t << 18) | (t >>> 14);
    t = x15 + x11; x3 ^= (t << 7) | (t >>> 25);
    t = x3 + x15; x7 ^= (t << 9) | (t >>> 23);
    t = x7 + x3; x11 ^= (t << 13) | (t >>> 19);
    t = x11 + x7; x15 ^= (t << 18) | (t >>> 14);
    t = x0 + x3; x1 ^= (t << 7) | (t >>> 25);
    t = x1 + x0; x2 ^= (t << 9) | (t >>> 23);
    t = x2 + x1; x3 ^= (t << 13) | (t >>> 19);
    t = x3 + x2; x0 ^= (t << 18) | (t >>> 14);
    t = x5 + x4; x6 ^= (t << 7) | (t >>> 25);
    t = x6 + x5; x7 ^= (t << 9) | (t >>> 23);
    t = x7 + x6; x4 ^= (t << 13) | (t >>> 19);
    t = x4 + x7; x5 ^= (t << 18) | (t >>> 14);
    t = x10 + x9; x11 ^= (t << 7) | (t >>> 25);
    t = x11 + x10; x8 ^= (t << 9) | (t >>> 23);
    t = x8 + x11; x9 ^= (t << 13) | (t >>> 19);
    t = x9 + x8; x10 ^= (t << 18) | (t >>> 14);
    t = x15 + x14; x12 ^= (t << 7) | (t >>> 25);
    t = x12 + x15; x13 ^= (t << 9) | (t >>> 23);
    t = x13 + x12; x14 ^= (t << 13) | (t >>> 19);
    t = x14 + x13; x15 ^= (t << 18) | (t >>> 14);
  }
  x[0] += x0; x[1] += x1; x[2] += x2; x[3] += x3; x[4] += x4; x[5] += x5; x[6] += x6; x[7] += x7;
  x[8] += x8; x[9] += x9; x[10] += x10; x[11] += x11; x[12] += x12; x[13] += x13; x[14] += x14; x[15] += x15;
}

// scrypt's BlockMix: B (2r blocks of 16 words) -> Y, even blocks first, then odd ones.
function blockMix(B, Y, r, x) {
  x.set(B.subarray((2 * r - 1) * 16, 2 * r * 16));
  for (let i = 0; i < 2 * r; i++) {
    for (let k = 0; k < 16; k++) x[k] ^= B[i * 16 + k];
    salsa208(x);
    Y.set(x, ((i & 1) * r + (i >> 1)) * 16);
  }
}

// The words of a byte block, little-endian whatever the CPU.
function toWords(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint32Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(i * 4, true));
}
function toBytes(words) {
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  words.forEach((w, i) => view.setUint32(i * 4, w, true));
  return bytes;
}

// ROMix over one 128*r byte block. step(done, total) runs every 1024 rounds; awaiting what it
// returns lets a page repaint its progress bar between chunks.
async function roMix(block, r, N, step) {
  const n = 32 * r;
  let X = toWords(block);
  let Y = new Uint32Array(n);
  const V = new Uint32Array(n * N);
  const x = new Uint32Array(16);
  for (let i = 0; i < 2 * N; i++) {
    if (i < N) {
      V.set(X, i * n);
    } else {
      const j = (X[n - 16] & (N - 1)) * n;
      for (let k = 0; k < n; k++) X[k] ^= V[j + k];
    }
    blockMix(X, Y, r, x);
    const t = X;
    X = Y;
    Y = t;
    if (step && (i & 1023) === 1023) await step(i + 1, 2 * N);
  }
  return toBytes(X);
}

async function pbkdf2(password, salt, bytes) {
  const key = await crypto.subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1 }, key, bytes * 8));
}

// RFC 7914 scrypt. password and salt are bytes.
async function scrypt(password, salt, { N, r, p }, keyBytes, step) {
  const blockBytes = 128 * r;
  const B = await pbkdf2(password, salt, p * blockBytes);
  for (let i = 0; i < p; i++) {
    B.set(await roMix(B.subarray(i * blockBytes, (i + 1) * blockBytes), r, N, step), i * blockBytes);
  }
  return pbkdf2(password, B, keyBytes);
}

// The decoded vault, or null when the password is wrong or the file was altered (GCM's tag).
// Throws when the file is not a KAPEVault vault at all. The password is NFC-normalised like the app.
async function openVault(file, password, step) {
  const data = checkOpenerFile(file) && base64Bytes(file.data); // decoded first: no scrypt for a bad file
  if (!data) throw new Error("Not a KAPEVault vault file");
  const tag = base64Bytes(file.tag);
  const secret = new TextEncoder().encode(password.normalize("NFC"));
  const raw = await scrypt(secret, base64Bytes(file.kdf.salt), file.kdf, 32, step);
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  raw.fill(0);
  // WebCrypto takes the 16-byte tag appended to the ciphertext.
  const sealed = new Uint8Array(data.length + 16);
  sealed.set(data);
  sealed.set(tag, data.length);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64Bytes(file.iv), tagLength: 128 }, key, sealed);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

if (typeof module === "object") module.exports = { checkOpenerFile, scrypt, openVault };
