// RFC 7914 scrypt, the ONE copy: the phone derives its key with it (mobile/src/app/host/scrypt.ts) and
// electron/opener.cjs inlines this file into the Forever Opener page (the `export` keyword stripped), so
// the Opener cannot drift from the app. WebCrypto's PBKDF2 around scrypt's Salsa20/8 mixing by hand;
// measured at 533-656 ms for N = 2^17 in the emulator's WebView, so no native plugin. core/scrypt.test.js
// checks it against the RFC 7914 section 12 vectors and Node's crypto.scrypt.
//
// The one async, crypto-using file in core/: it needs only the WebCrypto global (no Node built-in, so
// core/portable.test.js holds) and awaits a progress hook, so it is NOT in index.js - import it by path.
// Keep it dependency-free, with no import and no export other than the one on scrypt.

// Salsa20/8 core, in place on 16 words.
/** @param {Uint32Array} x */
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

/**
 * scrypt's BlockMix: B (2r blocks of 16 words) -> Y, even blocks first, then odd ones.
 * @param {Uint32Array} B @param {Uint32Array} Y @param {number} r @param {Uint32Array} x
 */
function blockMix(B, Y, r, x) {
  x.set(B.subarray((2 * r - 1) * 16, 2 * r * 16));
  for (let i = 0; i < 2 * r; i++) {
    for (let k = 0; k < 16; k++) x[k] ^= B[i * 16 + k];
    salsa208(x);
    Y.set(x, ((i & 1) * r + (i >> 1)) * 16);
  }
}

// The words of a byte block, little-endian whatever the CPU.
/** @param {Uint8Array} bytes */
function toWords(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint32Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(i * 4, true));
}
/** @param {Uint32Array} words */
function toBytes(words) {
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  for (const [i, w] of words.entries()) view.setUint32(i * 4, w, true);
  return bytes;
}

/** Awaited between chunks of rounds, so a page can paint while the key is derived.
 * @typedef {(done: number, total: number) => unknown} ScryptStep */

// 16 pauses for N = 2^17: the phone's timer clamps make more of them cost about a second. The Opener
// paints its progress bar from a cheap MessageChannel tick, so it asks for a pause every 1024 rounds.
const STEP_ROUNDS = 16384;

/**
 * ROMix over one 128*r byte block. V (N * 128 * r bytes) holds password-derived state: wiped after.
 * @param {Uint8Array} block @param {number} r @param {number} N @param {ScryptStep | undefined} step @param {number} stepRounds
 */
async function roMix(block, r, N, step, stepRounds) {
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
    if (step && (i + 1) % stepRounds === 0) await step(i + 1, 2 * N);
  }
  const out = toBytes(X);
  V.fill(0);
  X.fill(0);
  Y.fill(0);
  return out;
}

/** @param {Uint8Array} password @param {Uint8Array} salt @param {number} bytes */
async function pbkdf2(password, salt, bytes) {
  const key = await crypto.subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1 }, key, bytes * 8));
}

/**
 * password and salt are bytes; returns keyBytes bytes.
 * @param {Uint8Array} password @param {Uint8Array} salt @param {{ N: number, r: number, p: number }} params
 * @param {number} keyBytes @param {ScryptStep} [step] @param {number} [stepRounds] rounds between step calls
 */
export async function scrypt(password, salt, { N, r, p }, keyBytes, step, stepRounds = STEP_ROUNDS) {
  const blockBytes = 128 * r;
  const B = await pbkdf2(password, salt, p * blockBytes);
  for (let i = 0; i < p; i++) {
    B.set(await roMix(B.subarray(i * blockBytes, (i + 1) * blockBytes), r, N, step, stepRounds), i * blockBytes);
  }
  try {
    return await pbkdf2(password, B, keyBytes);
  } finally {
    B.fill(0);
  }
}
