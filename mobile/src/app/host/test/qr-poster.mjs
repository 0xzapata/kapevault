// QR codes as PNGs for the emulator's camera. The modules come from the PC's own encoder (Settings >
// Backup > Add a phone); SETUP_CODE is that code's payload (setup-code.ts) with the FAKE keys of the
// fake R2 bucket. The emulator's back camera shows qrPanorama's picture all around it (`npm run sim`
// boots it with `-camera-back image360:<png>`; Android 17's virtual room draws no posters), and the
// proofs turn the camera to the code they want read (scripts/emu-camera.mjs).
import zlib from "node:zlib";
import { R2_KEYS, pc } from "./fixtures.mjs";

export const SETUP_CODE = JSON.stringify({ kapevault: "r2", v: 1, ...R2_KEYS });
// A site's 2FA setup code (a test secret).
export const TOTP_CODE = "otpauth://totp/Example:sam.reyes%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY&issuer=Example";

// Where each code sits in the panorama, in degrees of turn from the direction the camera starts in.
// Between them, plain grey: nothing to read.
export const PANORAMA = { setup: 0, totp: 180, blank: 90 };

// An 8-bit greyscale PNG; `shade(x, y)` gives each pixel (0 black, 255 white).
function png(width, height, shade) {
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width + 1)] = 0; // filter: none
    for (let x = 0; x < width; x += 1) rows[y * (width + 1) + 1 + x] = shade(x, y);
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

// An equirectangular panorama (the centre column is straight ahead): each code on a flat white card
// facing the camera at its heading on the horizon, `side` degrees wide; grey everywhere else. Each
// panorama pixel is projected onto the card's plane (gnomonic), so the camera's straight-line view
// shows the card flat instead of bent by the panorama.
export function qrPanorama(codes, { width = 8192, side = 24 } = {}) {
  const height = width / 2;
  const half = Math.tan(((side / 2) * Math.PI) / 180);
  const cards = codes.map(({ text, heading }) => {
    const h = (heading * Math.PI) / 180;
    return { modules: pc.qr.encodeQr(text), margin: 4, sin: Math.sin(h), cos: Math.cos(h) };
  });
  return png(width, height, (x, y) => {
    const lon = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
    const lat = (0.5 - (y + 0.5) / height) * Math.PI;
    const [dx, dy, dz] = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
    for (const { modules, margin, sin, cos } of cards) {
      const ahead = dx * sin + dz * cos;
      if (ahead <= 0) continue;
      const u = (dx * cos - dz * sin) / ahead / half; // -1..1 across the card, left to right
      const v = -dy / ahead / half; // -1..1 down the card
      if (Math.abs(u) > 1 || Math.abs(v) > 1) continue;
      const count = modules.length + margin * 2;
      return modules[Math.floor(((v + 1) / 2) * count) - margin]?.[Math.floor(((u + 1) / 2) * count) - margin] ? 0 : 0xff;
    }
    return 0x80;
  });
}
