// A mock router sticker and a mock ID card as PNGs (mock values only), for the Sticker Capture and ID
// e2e and the design shots.
// Run directly to see what the REAL Windows OCR reads off it: `node scripts/mock-sticker.cjs`.
const { chromium } = require("./playwright.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const STICKER = `<body style="margin:0;background:#bdbdbd">
<div id="s" style="width:560px;padding:22px 26px;background:#f4f4f0;border-radius:10px;font:15px Arial;color:#222;line-height:1.5">
<div style="font:bold 30px Arial;color:#2a8f9a">tp-link</div>
<div style="margin-top:6px">Model: Archer C6 &nbsp; Power: 12V 1A</div>
<div>Default Access: http://tplinkwifi.net</div>
<div>Username: admin &nbsp; Password: admin</div>
<div>Wireless Network Name (SSID): Mock_Home_2.4G</div>
<div>Wireless Password/PIN: 48213397</div>
<div>MAC: 50-C7-BF-12-34-56</div>
<div>S/N: 2231MOCK09876</div>
</div></body>`;

const ID_CARD = `<body style="margin:0;background:#bdbdbd">
<div id="s" style="width:540px;height:340px;box-sizing:border-box;padding:24px;background:linear-gradient(135deg,#e8eef7,#c9d6ea);border-radius:18px;font:16px Arial;color:#1c2a44">
<div style="font:bold 22px Arial;letter-spacing:.08em">REPUBLIKA NG MOCK</div>
<div style="font:13px Arial;margin-top:2px">MOCK PASSPORT</div>
<div style="display:flex;gap:22px;margin-top:26px">
<div style="width:120px;height:150px;border-radius:10px;background:#9fb0c9"></div>
<div style="line-height:1.9">Surname: MOCK<br>Given name: CARDHOLDER<br>No: P1234567A<br>Valid until: 2031-04-30</div>
</div></div></body>`;

async function render(html, file) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
    await page.setContent(html);
    await page.locator("#s").screenshot({ path: file });
  } finally {
    await browser.close();
  }
  return file;
}

const renderSticker = (file) => render(STICKER, file);
const renderIdCard = (file) => render(ID_CARD, file);

module.exports = { renderSticker, renderIdCard };

if (require.main === module) {
  (async () => {
    const { readLabelText } = require("../electron/label-ocr.cjs");
    const { parseLabel } = require("../core/index.js");
    const file = await renderSticker(path.join(os.tmpdir(), "kapevault-mock-sticker.png"));
    const read = await readLabelText(`data:image/png;base64,${fs.readFileSync(file).toString("base64")}`);
    console.log(file);
    console.log(read.status === "ok" ? `Windows OCR read:\n${read.text}\n\nSuggested fields:` : "Windows OCR is not available here.");
    if (read.status === "ok") console.log(parseLabel(read.text));
  })();
}
