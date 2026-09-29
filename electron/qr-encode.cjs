// A QR code encoder for Settings > Backup > Add a phone (ISO/IEC 18004; the steps follow Nayuki's QR
// Code generator, MIT): byte mode, error correction level M, versions 1-40, the mask with the lowest
// penalty. Built in rather than a package: it is one screen, it handles the R2 secret, and the main
// process ships one npm dependency (jsqr). qr-encode.test.cjs proves every code with jsqr's decoder.

// Level M, by version: error correction codewords per block, and blocks.
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const LEVEL_M = 0; // its two format bits
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

const bit = (value, i) => ((value >>> i) & 1) === 1;

// Modules left for data once the finder, timing, alignment, format and version patterns are drawn.
function rawDataModules(version) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    modules -= (25 * align - 10) * align - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

const dataCodewords = (version) => Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version];

// --- Reed-Solomon over GF(2^8), polynomial 0x11D ------------------------------------------------------

function multiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = multiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = multiply(root, 0x02);
  }
  return result;
}

function remainder(data, by) {
  const result = by.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    by.forEach((coef, i) => (result[i] ^= multiply(coef, factor)));
  }
  return result;
}

// --- Codewords ---------------------------------------------------------------------------------------

// The text as data codewords: mode, length, bytes, terminator and padding.
function dataFor(bytes, version) {
  const bits = [];
  const put = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push(bit(value, i));
  };
  put(0b0100, 4); // byte mode
  put(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) put(byte, 8);
  const capacity = dataCodewords(version) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | (b ? 1 : 0), 0));
  for (let pad = 0xec; codewords.length < capacity / 8; pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
}

// Split into blocks, add each block's error correction, and interleave them.
function withErrorCorrection(data, version) {
  const blocks = BLOCKS[version];
  const eccLength = ECC_PER_BLOCK[version];
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const by = divisor(eccLength);
  const all = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const block = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
    k += block.length;
    const ecc = remainder(block, by);
    if (i < shortBlocks) block.push(0); // a stand-in, so every block is one length; skipped below
    all.push([...block, ...ecc]);
  }
  const result = [];
  for (let i = 0; i < all[0].length; i++) {
    all.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) result.push(block[i]);
    });
  }
  return result;
}

// --- The grid ----------------------------------------------------------------------------------------

function alignmentPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const result = [6];
  for (let pos = version * 4 + 17 - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

function grid(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => {
    modules[y][x] = dark;
    fixed[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const [x, y] = [cx + dx, cy + dy];
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, ring !== 2 && ring !== 4);
      }
    }
  }
  const align = alignmentPositions(version);
  const last = align.length - 1;
  align.forEach((cx, i) =>
    align.forEach((cy, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; // the finders
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  drawFormat(set, size, 0); // reserved now, written once the mask is chosen
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const [a, b] = [size - 11 + (i % 3), Math.floor(i / 3)];
      set(a, b, bit(bits, i));
      set(b, a, bit(bits, i));
    }
  }
  return { size, modules, fixed, set };
}

function drawFormat(set, size, mask) {
  const data = (LEVEL_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
  set(8, 7, bit(bits, 6));
  set(8, 8, bit(bits, 7));
  set(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
  set(8, size - 8, true); // always dark
}

// Codewords in the zigzag, two columns at a time from the bottom right, around the fixed patterns.
function drawCodewords({ size, modules, fixed }, codewords) {
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing line
    for (let step = 0; step < size; step++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - step : step;
        if (fixed[y][x] || i >= codewords.length * 8) continue;
        modules[y][x] = bit(codewords[i >>> 3], 7 - (i & 7));
        i++;
      }
    }
  }
}

function applyMask({ size, modules, fixed }, mask) {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
}

// How hard a pattern is to read (the standard's four rules): long runs, 2x2 blocks, finder look-alikes,
// and dark and light far from half and half. The lowest wins.
function penalty(modules) {
  const size = modules.length;
  const columns = modules[0].map((_, x) => modules.map((row) => row[x]));
  let score = 0;
  for (const line of [...modules, ...columns]) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    const text = line.map((dark) => (dark ? "1" : "0")).join("");
    for (const pattern of ["10111010000", "00001011101"]) for (let i = text.indexOf(pattern); i >= 0; i = text.indexOf(pattern, i + 1)) score += 40;
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const dark = modules[y][x];
      if (modules[y][x + 1] === dark && modules[y + 1][x] === dark && modules[y + 1][x + 1] === dark) score += 3;
    }
  }
  const dark = modules.flat().filter(Boolean).length;
  const total = size * size;
  return score + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
}

/**
 * The QR code for `text`, as rows of modules (true = dark), without the quiet zone.
 * @param {string} text @returns {boolean[][]}
 */
function encodeQr(text) {
  const bytes = [...Buffer.from(String(text), "utf8")];
  let version = 1;
  while (version <= 40 && 4 + (version < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(version) * 8) version++;
  if (version > 40) throw new Error("Too much text for one QR code.");
  const codewords = withErrorCorrection(dataFor(bytes, version), version);
  let best = null;
  for (let mask = 0; mask < MASKS.length; mask++) {
    const g = grid(version);
    drawCodewords(g, codewords);
    applyMask(g, mask);
    drawFormat(g.set, g.size, mask);
    const score = penalty(g.modules);
    if (!best || score < best.score) best = { score, modules: g.modules };
  }
  return best.modules;
}

/**
 * The dark modules as one SVG path, one rectangle per run of a row, in module units (the page adds the
 * quiet zone around it).
 * @param {boolean[][]} modules @returns {string}
 */
function qrPath(modules) {
  let d = "";
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      const start = x;
      while (row[x + 1]) x++;
      d += `M${start} ${y}h${x - start + 1}v1h-${x - start + 1}z`;
    }
  });
  return d;
}

module.exports = { encodeQr, qrPath };
