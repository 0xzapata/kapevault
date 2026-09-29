// "Scan QR code on screen": capture every display and decode a 2FA setup QR.
// Window handling (hiding KAPEVault during the capture) is the caller's job.
const jsQR = require("jsqr");

// Electron's NativeImage.toBitmap() is BGRA on Windows; jsQR wants RGBA.
function bgraToRgba(bgra, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = bgra[i + 2];
    out[i + 1] = bgra[i + 1];
    out[i + 2] = bgra[i];
    out[i + 3] = 255;
  }
  return out;
}

// Halve both sides by averaging each 2x2 block.
function downscale2x(rgba, width, height) {
  const w = width >> 1;
  const h = height >> 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = ((y * 2) * width + x * 2) * 4;
      const b = a + width * 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = (rgba[a + c] + rgba[a + 4 + c] + rgba[b + c] + rgba[b + 4 + c] + 2) >> 2;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

function tryDecode(rgba, width, height) {
  const hit = jsQR(rgba, width, height, { inversionAttempts: "attemptBoth" });
  return hit && hit.data ? hit.data : null;
}

function decodeQr(bgra, width, height) {
  if (!bgra || !width || !height || bgra.length < width * height * 4) return null;
  const rgba = bgraToRgba(bgra, width, height);
  const found = tryDecode(rgba, width, height);
  if (found || width <= 1600) return found;
  // jsQR can miss codes in very high-res captures; a half-size pass catches those.
  const small = downscale2x(rgba, width, height);
  return tryDecode(small.data, small.width, small.height);
}

async function scanScreens({ desktopCapturer, screen }) {
  // Full-resolution capture: size the thumbnail to the biggest display in physical pixels.
  let width = 0;
  let height = 0;
  for (const d of screen.getAllDisplays()) {
    const sf = d.scaleFactor || 1;
    width = Math.max(width, Math.round(d.size.width * sf));
    height = Math.max(height, Math.round(d.size.height * sf));
  }
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width, height } });
  const results = [];
  for (const source of sources) {
    const img = source.thumbnail;
    if (!img || (img.isEmpty && img.isEmpty())) continue;
    const size = img.getSize();
    const text = decodeQr(img.toBitmap(), size.width, size.height);
    if (text) results.push(text);
  }
  return results;
}

module.exports = { decodeQr, scanScreens };
