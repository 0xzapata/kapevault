const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { encodeQr, qrPath } = require("./qr-encode.cjs");
const { decodeQr } = require("./qr-scan.cjs");
const { configFromInput, setupCode } = require("./cloud-backup.cjs");

// The modules drawn as a screen would show them: a 4-module white quiet zone, `scale` pixels a module,
// BGRA like a desktop capture - then read back by the app's own QR reader (jsqr).
function capture(modules, scale = 4) {
  const quiet = 4;
  const side = (modules.length + quiet * 2) * scale;
  const pixels = Buffer.alloc(side * side * 4, 255);
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          const i = (((y + quiet) * scale + py) * side + (x + quiet) * scale + px) * 4;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
        }
      }
    }),
  );
  return decodeQr(pixels, side, side);
}

// The page draws qrPath; reading the path back gives the modules it shows.
function modulesFromPath(d, size) {
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  for (const [, x, y, run] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) for (let i = 0; i < Number(run); i++) modules[Number(y)][Number(x) + i] = true;
  return modules;
}

const SETUP = setupCode(
  configFromInput({
    url: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/a-bucket-name-that-is-rather-long-for-a-test-of-the-code-size",
    accessKeyId: "0123456789abcdef0123456789abcdef",
    secretAccessKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", // gitleaks:allow
  }),
);

test("every size of text reads back exactly with the app's QR reader, from version 1 to 40", () => {
  const lengths = [1, 14, 15, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666, 711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331];
  for (const length of lengths) {
    const text = Array.from({ length }, (_, i) => "kapevault-0123456789{}\":,/"[i % 26]).join("");
    const modules = encodeQr(text);
    assert.equal(capture(modules, length > 1000 ? 2 : 3), text, `${length} bytes, ${modules.length} modules`);
  }
});

test("the smallest version that holds the text, and no bigger", () => {
  assert.equal(encodeQr("x".repeat(14)).length, 21, "version 1 holds 14 bytes at level M");
  assert.equal(encodeQr("x".repeat(15)).length, 25);
  assert.equal(encodeQr("x".repeat(2331)).length, 177, "version 40");
  assert.throws(() => encodeQr("x".repeat(2332)), /Too much text/);
});

test("non-ASCII text goes as UTF-8 bytes", () => {
  assert.equal(capture(encodeQr("Mañana · ₱500")), "Mañana · ₱500");
});

test("Add a phone: the PC's code, as the page draws it, reads back and the phone's parser takes it", async () => {
  const modules = encodeQr(SETUP);
  const drawn = modulesFromPath(qrPath(modules), modules.length);
  assert.deepEqual(drawn, modules, "the SVG path is exactly the modules");
  const read = capture(drawn);
  assert.equal(read, SETUP);
  const { parseSetupCode } = await import(pathToFileURL(path.join(__dirname, "..", "mobile", "src", "app", "host", "setup-code.ts")).href);
  const { url, accessKeyId, secretAccessKey } = JSON.parse(SETUP);
  assert.deepEqual(parseSetupCode(read), { ok: true, keys: { url, accessKeyId, secretAccessKey } });
});

test("Emergency Kit with the R2 keys: its one QR code is Add a phone's code and the phone's parser takes it", async () => {
  const { kitHtml } = require("./emergency-kit.cjs");
  const { url, accessKeyId, secretAccessKey } = JSON.parse(SETUP);
  const base = { createdAt: new Date(2026, 8, 28), vaultPath: "C:/mock/vault.kapevault", itemCount: 3, appVersion: "0.1.0", openerSha256: "0".repeat(64) };
  const modules = encodeQr(SETUP);
  const html = kitHtml({ ...base, cloud: { url, accessKeyId, secretAccessKey, qr: modules } });
  const paths = [...html.matchAll(/<svg class="qr".*?<path d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(paths.length, 1, "one QR code");
  const read = capture(modulesFromPath(paths[0], modules.length));
  const { parseSetupCode } = await import(pathToFileURL(path.join(__dirname, "..", "mobile", "src", "app", "host", "setup-code.ts")).href);
  assert.deepEqual(parseSetupCode(read), { ok: true, keys: { url, accessKeyId, secretAccessKey } });
  assert.ok(!kitHtml({ ...base, cloud: { url, accessKeyId } }).includes('class="qr"'), "no keys, no QR code");
});
