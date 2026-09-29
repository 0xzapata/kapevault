const { esc, longDate } = require("./emergency-kit.cjs");
const { evacuationOrder } = require("../core/index.js");

// "Evacuate": where the physical things are (passport, land title, YubiKey), in the order you grab
// them, as one A4 page to tape inside a cabinet door. Pure HTML in, PDF out through savePdf
// (pdf-export.cjs) - no network, no scripts. A long list flows onto a second sheet; a row never splits.

const GRAB_NAMES = { 1: "Grab first", 2: "If there is time", 3: "Leave it" };
const EVACUATION_MARGIN_IN = 0.63; // 16mm, the kit's margin

// An ID's expiry sits under its title, so an expired passport is not the one grabbed.
function row(t, tick) {
  const expires = t.expires ? `<span class="expires">Expires ${esc(t.expires)}</span>` : "";
  return `<div class="row">${tick ? `<span class="box"></span>` : `<span></span>`}<div class="title">${esc(t.title)}${expires}</div><div class="room">${esc(t.room || "")}</div><div class="spot">${esc(t.spot)}</div></div>`;
}

const GRAB_ORDER = [1, 2, 3];

function evacuationHtml({ createdAt, things }) {
  const ordered = evacuationOrder(things);
  const groups = [1, 2, 3]
    // A newer version's grab prints with "if there is time" (the default), never missing from the list.
    .map((grab) => ({ grab, items: ordered.filter((t) => (GRAB_ORDER.includes(t.grab) ? t.grab : 2) === grab) }))
    .filter((g) => g.items.length)
    .map(({ grab, items }) => `<section><h2>${GRAB_NAMES[grab]}</h2>${items.map((t) => row(t, grab !== 3)).join("")}</section>`);
  const count = `${things.length} ${things.length === 1 ? "thing" : "things"}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Grab list</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #ffffff; }
  body {
    color: #000000;
    font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  header { padding-bottom: 14px; border-bottom: 2px solid #000000; }
  h1 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; }
  .meta { margin: 3px 0 0; color: #48484a; font-size: 12px; }
  section { margin-top: 18px; }
  h2 { margin: 0 0 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #48484a; }
  .row { display: grid; grid-template-columns: 18px 30% 17% 1fr; gap: 12px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid rgb(0 0 0 / 0.14); break-inside: avoid; }
  .box { width: 14px; height: 14px; border: 1.5px solid #000000; border-radius: 3px; transform: translateY(2px); }
  .title { font-weight: 600; font-size: 14px; }
  .expires { display: block; margin-top: 1px; color: #48484a; font-size: 11.5px; font-weight: 400; }
  .room { color: #48484a; }
  .spot { white-space: pre-wrap; overflow-wrap: anywhere; }
  .empty { margin-top: 18px; color: #48484a; }
  footer { margin-top: 16px; color: #48484a; font-size: 10.5px; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <header>
    <h1>Grab list</h1>
    <p class="meta">${count}, grab first at the top. Printed ${esc(longDate(createdAt))}.</p>
  </header>
  ${groups.join("\n  ") || `<p class="empty">No things saved yet.</p>`}
  <footer><span>Moved something? Print a new list.</span><span>KAPEVault</span></footer>
</body>
</html>`;
}

module.exports = { GRAB_NAMES, EVACUATION_MARGIN_IN, evacuationHtml };
