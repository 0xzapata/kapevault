const { qrPath } = require("./qr-encode.cjs");

// The KAPEVault Emergency Kit: one printable A4 page the user keeps offline, so a dead PC or a
// forgotten detail never loses the vault. Pure HTML in, PDF out - no network, no scripts.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Local date, e.g. "25 September 2026".
function longDate(date) {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function section(n, title, body) {
  return `<section><h2><span class="num">${n}</span>${title}</h2><div class="body">${body}</div></section>`;
}

function cloudBody(cloud) {
  if (!cloud) {
    return `<p class="note">Not set up. Turn it on in Settings &gt; Backup so a dead PC does not take the vault with it.</p>`;
  }
  const row = (label, value) => `<div class="row"><div class="label">${label}</div><div class="mono">${esc(value)}</div></div>`;
  const rows = row("Bucket URL", cloud.url) + row("Access key ID", cloud.accessKeyId);
  if (cloud.secretAccessKey) {
    const all = `<div class="rows">${rows}${row("Secret key", cloud.secretAccessKey)}</div>`;
    return cloud.qr ? `<div class="with-qr">${all}${qrSvg(cloud.qr)}</div>` : all;
  }
  return `<div class="rows">${rows}</div><p class="note">Secret key not printed. On a new PC create a new R2 API token in Cloudflare (R2 &gt; Manage API tokens, Object Read &amp; Write on this bucket).</p>`;
}

// The connection as Add a phone's setup code (modules from encodeQr), for the phone's Restore from backup.
function qrSvg(modules) {
  const side = modules.length + 8; // a 4-module quiet zone
  return `<svg class="qr" viewBox="-4 -4 ${side} ${side}" shape-rendering="crispEdges" aria-label="R2 setup code"><rect x="-4" y="-4" width="${side}" height="${side}" fill="#ffffff"/><path d="${qrPath(modules)}" fill="#000000"/></svg>`;
}

// All 64 hex digits in groups of 8: anyone with the R2 keys can swap the page in the bucket, and a
// 16-digit prefix is not a check a disaster should rest on.
const fullHash = (hex) => String(hex).match(/.{1,8}/g)?.join(" ") ?? "";

function kitHtml({ createdAt, vaultPath, itemCount, appVersion, openerSha256, cloud }) {
  const items = `${esc(itemCount)} ${Number(itemCount) === 1 ? "item" : "items"}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>KAPEVault Emergency Kit</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #ffffff; }
  body {
    color: #1d1d1f;
    font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
    font-size: 12.5px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* The page draws its own 16mm margins; overflow is hidden so it can never spill onto a page 2. */
  .page { width: 210mm; height: 297mm; padding: 16mm; display: flex; flex-direction: column; overflow: hidden; }
  header { display: flex; align-items: center; gap: 16px; padding-bottom: 22px; border-bottom: 1px solid rgb(0 0 0 / 0.1); }
  header svg { width: 44px; height: 44px; flex: none; }
  h1 { margin: 0; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; }
  .meta { margin: 2px 0 0; color: #86868b; font-size: 12px; }
  section { padding: 20px 0; border-bottom: 1px solid rgb(0 0 0 / 0.08); }
  section:last-of-type { border-bottom: 0; }
  h2 { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; font-size: 14.5px; font-weight: 600; letter-spacing: -0.01em; }
  .num {
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    width: 20px; height: 20px; border-radius: 50%;
    background: #0071e3; color: #ffffff; font-size: 11px; font-weight: 600;
  }
  .body { padding-left: 30px; }
  p { margin: 0; }
  .note { color: #515154; }
  .rows + .note, .note.after { margin-top: 10px; }
  .write { height: 22mm; border: 1px solid rgb(0 0 0 / 0.16); border-radius: 12px; padding: 0 16px 16px; display: flex; align-items: flex-end; margin-bottom: 10px; }
  .write span { flex: 1; border-bottom: 1px solid rgb(0 0 0 / 0.22); }
  .mono {
    font-family: "Cascadia Mono", Consolas, ui-monospace, monospace;
    font-size: 11.5px; line-height: 1.45; overflow-wrap: anywhere; word-break: break-all;
  }
  .path { background: #f5f5f7; border-radius: 10px; padding: 10px 14px; }
  .rows { display: grid; gap: 8px; }
  /* 40mm: a real setup code is 61-69 modules plus the quiet zone, so each module prints at 0.5mm or
     more for a phone camera. The write box (22mm) gave up the height to keep one page. */
  .with-qr { display: grid; grid-template-columns: 1fr 40mm; gap: 18px; align-items: start; }
  .qr { display: block; width: 40mm; height: 40mm; margin-top: -2mm; }
  .row { display: grid; grid-template-columns: 96px 1fr; gap: 12px; align-items: baseline; }
  .label { color: #86868b; font-size: 11.5px; }
  ol, ul { margin: 0; padding-left: 18px; }
  li { padding-left: 4px; }
  li + li { margin-top: 3px; }
  ol li::marker { color: #0071e3; font-weight: 600; }
  ul li::marker { color: #86868b; }
  footer { margin-top: auto; padding-top: 12px; border-top: 1px solid rgb(0 0 0 / 0.08); color: #86868b; font-size: 10.5px; display: flex; justify-content: space-between; }
</style>
</head>
<body>
<div class="page">
  <header>
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="#0071e3"/>
      <path d="M10 11.5h6.2l2 2.5H30a2 2 0 0 1 2 2v12.5a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2Z" fill="#ffffff" fill-opacity="0.55"/>
      <rect x="8" y="16.5" width="24" height="14" rx="2.5" fill="#ffffff"/>
      <circle cx="20" cy="21.6" r="2.6" fill="#0071e3"/>
      <path d="M18.9 23h2.2l0.6 4.2h-3.4Z" fill="#0071e3"/>
    </svg>
    <div>
      <h1>KAPEVault Emergency Kit</h1>
      <p class="meta">Created ${esc(longDate(createdAt))} for ${items} - KAPEVault ${esc(appVersion)}</p>
    </div>
  </header>
  ${section(1, "Master password", `<div class="write"><span></span></div><p class="note">Write it by hand. It cannot be reset or recovered - without it the vault and every backup stay locked.</p>`)}
  ${section(2, "Where your vault lives", `<div class="path mono">${esc(vaultPath)}</div>`)}
  ${section(3, "Cloud backup (Cloudflare R2)", cloudBody(cloud))}
  ${section(4, "Recover on a new PC", `<ol>
    <li>Install KAPEVault.</li>
    <li>On the lock screen, click "Restore from backup".</li>
    <li>Choose Cloud (${cloud?.qr ? "the keys above, or on a phone scan the code" : "the R2 URL and keys above"}) or File (an encrypted copy you saved).</li>
    <li>Enter the master password the backup was made with.</li>
  </ol>
  <p class="note after">No KAPEVault? "KAPEVault Opener.html" opens a vault file in any browser, offline. It sits beside your saved encrypted copies${cloud ? ` and in your bucket as kapevault/opener/kapevault-opener.html` : ""}. Version ${esc(appVersion)}'s SHA-256 is <span class="mono">${esc(fullHash(openerSha256))}</span>; Settings &gt; Backup shows the latest.</p>`)}
  ${section(5, "Keep this safe", `<ul>
    <li>Print it and store it with your passport or in a safe.</li>
    <li>Do not keep a photo of the filled-in page in the cloud.</li>
    <li>Print a new kit if you change the master password or the backup keys.</li>
  </ul>`)}
  <footer><span>Once filled in, anyone holding this page can open your vault. Treat it like cash.</span><span>KAPEVault</span></footer>
</div>
</body>
</html>`;
}

module.exports = { kitHtml, esc, longDate };
