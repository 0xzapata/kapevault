const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { decodeQr, scanScreens } = require("./qr-scan.cjs");

// Fixture: first line "# <encoded text>", then one row of 0/1 per QR module row.
const lines = fs.readFileSync(path.join(__dirname, "fixtures", "qr-otpauth.txt"), "utf8").trim().split(/\r?\n/);
const TEXT = lines[0].replace(/^# /, "");
const MATRIX = lines.slice(1).map((row) => [...row].map(Number));

// Grey-noise BGRA canvas, like a busy screenshot (seeded so runs repeat).
function canvas(width, height, noise = true) {
  const buf = Buffer.alloc(width * height * 4);
  let seed = 12345;
  for (let i = 0; i < buf.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = noise ? 100 + (seed % 60) : 128;
    buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 255;
  }
  return buf;
}

// Draw the QR (with a 4-module white quiet zone) into the canvas at (ox, oy).
function drawQr(buf, width, ox, oy, scale) {
  const quiet = 4;
  const side = MATRIX.length + quiet * 2;
  for (let my = 0; my < side; my++) {
    for (let mx = 0; mx < side; mx++) {
      const r = my - quiet;
      const c = mx - quiet;
      const dark = r >= 0 && c >= 0 && r < MATRIX.length && c < MATRIX.length && MATRIX[r][c] === 1;
      const v = dark ? 0 : 255;
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          const i = ((oy + my * scale + py) * width + ox + mx * scale + px) * 4;
          buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 255;
        }
      }
    }
  }
  return buf;
}

test("fixture is the otpauth text", () => {
  assert.match(TEXT, /^otpauth:\/\/totp\/.*secret=JBSWY3DPEHPK3PXP/);
  assert.ok(MATRIX.every((row) => row.length === MATRIX.length));
});

test("decodes a QR placed inside a noisy screenshot", () => {
  const buf = drawQr(canvas(1200, 800), 1200, 310, 150, 8);
  assert.equal(decodeQr(buf, 1200, 800), TEXT);
});

test("blank screen returns null", () => {
  assert.equal(decodeQr(canvas(1200, 800, false), 1200, 800), null);
  assert.equal(decodeQr(canvas(1200, 800), 1200, 800), null);
});

// Flat background here: jsQR on 5.7M pixels of pure noise takes ~20s, while a real screen
// (mostly flat UI) decodes in well under a second.
test("large capture with a small QR still decodes", () => {
  const buf = drawQr(canvas(3200, 1800, false), 3200, 2100, 900, 4);
  assert.equal(decodeQr(buf, 3200, 1800), TEXT);
});

test("bad input returns null instead of throwing", () => {
  assert.equal(decodeQr(Buffer.alloc(10), 1200, 800), null);
  assert.equal(decodeQr(null, 0, 0), null);
});

test("scanScreens captures at full resolution and returns one hit per display", async () => {
  const withQr = drawQr(canvas(1200, 800), 1200, 400, 100, 8);
  const blank = canvas(1200, 800, false);
  const thumb = (bitmap) => ({ isEmpty: () => false, getSize: () => ({ width: 1200, height: 800 }), toBitmap: () => bitmap });
  let asked;
  const desktopCapturer = {
    getSources: async (opts) => {
      asked = opts;
      return [{ thumbnail: thumb(blank) }, { thumbnail: thumb(withQr) }];
    },
  };
  const screen = {
    getAllDisplays: () => [
      { size: { width: 1920, height: 1080 }, scaleFactor: 1 },
      { size: { width: 1440, height: 900 }, scaleFactor: 1.5 },
    ],
  };
  const found = await scanScreens({ desktopCapturer, screen });
  assert.deepEqual(found, [TEXT]);
  assert.deepEqual(asked.types, ["screen"]);
  assert.deepEqual(asked.thumbnailSize, { width: 2160, height: 1350 });
});
