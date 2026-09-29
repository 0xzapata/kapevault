// RFC 7914 scrypt: the Forever Opener's implementation (electron/opener/opener-crypto.cjs), typed, with
// its working buffers wiped after - WebCrypto PBKDF2 around scrypt's Salsa20/8 mixing by hand. Measured at
// 533-656 ms for N = 2^17 in the emulator's WebView, so no native plugin. scrypt.test.mjs checks it
// against Node's crypto.scrypt.

// Salsa20/8 core, in place on 16 words.
function salsa208(x: Uint32Array) {
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
function blockMix(B: Uint32Array, Y: Uint32Array, r: number, x: Uint32Array) {
  x.set(B.subarray((2 * r - 1) * 16, 2 * r * 16));
  for (let i = 0; i < 2 * r; i++) {
    for (let k = 0; k < 16; k++) x[k] ^= B[i * 16 + k];
    salsa208(x);
    Y.set(x, ((i & 1) * r + (i >> 1)) * 16);
  }
}

// The words of a byte block, little-endian whatever the CPU.
function toWords(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint32Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(i * 4, true));
}
function toBytes(words: Uint32Array) {
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  words.forEach((w, i) => view.setUint32(i * 4, w, true));
  return bytes;
}

// Awaited between chunks of rounds, so the page can paint while the key is derived.
export type ScryptStep = (done: number, total: number) => unknown;
const STEP_ROUNDS = 16384; // 16 pauses for N = 2^17: the Opener's 1024 would add ~1 s of timer clamps

// ROMix over one 128*r byte block. V (N * 128 * r bytes) holds password-derived state: wiped after.
async function roMix(block: Uint8Array, r: number, N: number, step?: ScryptStep) {
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
    if (step && (i & (STEP_ROUNDS - 1)) === STEP_ROUNDS - 1) await step(i + 1, 2 * N);
  }
  const out = toBytes(X);
  V.fill(0);
  X.fill(0);
  Y.fill(0);
  return out;
}

async function pbkdf2(password: Uint8Array, salt: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", password as BufferSource, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: 1 }, key, bytes * 8));
}

// password and salt are bytes; returns keyBytes bytes.
export async function scrypt(password: Uint8Array, salt: Uint8Array, { N, r, p }: { N: number; r: number; p: number }, keyBytes: number, step?: ScryptStep) {
  const blockBytes = 128 * r;
  const B = await pbkdf2(password, salt, p * blockBytes);
  for (let i = 0; i < p; i++) {
    B.set(await roMix(B.subarray(i * blockBytes, (i + 1) * blockBytes), r, N, step), i * blockBytes);
  }
  try {
    return await pbkdf2(password, B, keyBytes);
  } finally {
    B.fill(0);
  }
}
