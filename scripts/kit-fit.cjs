// The Emergency Kit must stay one A4 page. This renders its longest version -
// R2 keys ticked, a 63-character bucket, a 121-character vault path (the longest it must hold) - on
// screen and in print, and exits 1 if `.page` spills. Run after any change to electron/emergency-kit.cjs:
// `npm run kit:fit`.
const { chromium } = require("./playwright.cjs");
const { kitHtml } = require("../electron/emergency-kit.cjs");
const { encodeQr } = require("../electron/qr-encode.cjs");
const { setupCode } = require("../electron/cloud-backup.cjs");

const config = {
  endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
  bucket: "b".repeat(63),
  accessKeyId: "c".repeat(32),
  secretAccessKey: "d".repeat(64),
};
const html = kitHtml({
  createdAt: new Date(2026, 8, 28),
  vaultPath: "C:\\Users\\mock-user-with-a-long-name\\OneDrive - Mock Company Holdings Limited\\Documents\\Private Records\\KAPEVault\\vault.kapevault",
  itemCount: 1234,
  appVersion: "0.1.0",
  openerSha256: "0".repeat(64),
  cloud: { url: `${config.endpoint}/${config.bucket}`, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, qr: encodeQr(setupCode(config)) },
});

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let fits = true;
  for (const media of ["screen", "print"]) {
    await page.emulateMedia({ media });
    await page.setContent(html);
    const { scrollHeight, clientHeight } = await page.$eval(".page", (p) => ({ scrollHeight: p.scrollHeight, clientHeight: p.clientHeight }));
    const ok = scrollHeight === clientHeight;
    fits &&= ok;
    console.log(`${media}: ${scrollHeight}/${clientHeight} ${ok ? "FITS" : "SPILLS"}`);
  }
  await browser.close();
  process.exit(fits ? 0 : 1);
})();
