const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
// label-ocr takes runPsJson when it loads, so the stand-in goes in first; null runs the real one.
const systemTools = require("./system-tools.cjs");
const realRunPsJson = systemTools.runPsJson;
let fakeRunPsJson = null;
systemTools.runPsJson = (options) => (fakeRunPsJson ?? realRunPsJson)(options);
const { readLabelText, FAKE_LABEL } = require("./label-ocr.cjs");
const { parseLabel } = require("../core/index.js");

// A plain white PNG, built by hand (no image library): signature, IHDR, one IDAT, IEND.
function whitePng(size) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows = Buffer.alloc((size * 3 + 1) * size, 0xff);
  for (let y = 0; y < size; y++) rows[y * (size * 3 + 1)] = 0; // filter byte per row
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const png = `data:image/png;base64,${whitePng(64).toString("base64")}`;

test("only a JPEG or PNG data URL is read; anything else is refused before any work", async () => {
  for (const bad of ["", "not an image", "data:image/svg+xml;base64,PHN2Zz4=", "https://example.test/label.jpg", 42, null]) {
    await assert.rejects(readLabelText(bad, { fake: "label" }), /could not be read/, String(bad));
  }
});

test("the test stand-in reads the mock sticker, nothing, or has no OCR", async () => {
  assert.deepEqual(await readLabelText(png, { fake: "label" }), { status: "ok", text: FAKE_LABEL });
  assert.deepEqual(await readLabelText(png, { fake: "blank" }), { status: "ok", text: "" });
  assert.deepEqual(await readLabelText(png, { fake: "unavailable" }), { status: "unavailable" });
  const found = parseLabel(FAKE_LABEL);
  assert.equal(found.wifiPassword, "mockwifi-4821");
  assert.equal(found.type, "router");
});

test("a PowerShell timeout and any other failure each read as their own plain error", async (t) => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  t.after(() => {
    Object.defineProperty(process, "platform", platform);
    fakeRunPsJson = null;
  });
  fakeRunPsJson = async () => {
    throw Object.assign(new Error("PowerShell timed out"), { timedOut: true });
  };
  await assert.rejects(readLabelText(png), { message: "Reading the label took too long" });
  fakeRunPsJson = async () => {
    throw Object.assign(new Error("PowerShell gave no answer"), { timedOut: false });
  };
  await assert.rejects(readLabelText(png), { message: "Could not read the label" });
});

test("the real Windows OCR script runs and answers for a blank photo", { skip: process.platform !== "win32" }, async () => {
  const result = await readLabelText(png);
  assert.ok(result.status === "unavailable" || (result.status === "ok" && result.text === ""), JSON.stringify(result));
});
