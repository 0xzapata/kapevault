const { esc, longDate } = require("./emergency-kit.cjs");

// "Hand back": a printable list of the items kept for one person (Mama, Lola), to give them when
// they take their accounts over. Pure HTML in, PDF out through savePdf (pdf-export.cjs) - no
// network, no scripts. It flows onto as many A4 sheets as it needs; an item never splits across two.

const HAND_BACK_MARGIN_IN = 0.63; // 16mm on every sheet, the kit's margin

function itemBlock({ title, space, rows }, withSecrets) {
  // Secret rows print only when asked for, whatever the caller handed in.
  const shown = rows.filter((r) => withSecrets || !r.secret);
  const body = shown.length
    ? `<div class="rows">${shown.map((r) => `<div class="row"><div class="label">${esc(r.label)}</div><div class="value${r.secret ? " mono" : ""}">${esc(r.value)}</div></div>`).join("")}</div>`
    : `<p class="none">Nothing else saved.</p>`;
  return `<section class="item"><h2>${esc(title)}</h2>${space ? `<p class="space">${esc(space)}</p>` : ""}${body}</section>`;
}

function handBackHtml({ person, createdAt, items, withSecrets }) {
  const count = `${items.length} ${items.length === 1 ? "item" : "items"}`;
  const notice = withSecrets
    ? `<p class="notice warn">This page holds passwords. Hand it over in person, keep it somewhere safe, and shred it once the passwords are changed.</p>`
    : `<p class="notice">Passwords are not on this page.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>For ${esc(person)}</title>
<style>
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
  header { padding-bottom: 18px; border-bottom: 1px solid rgb(0 0 0 / 0.1); }
  h1 { margin: 0; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; }
  .meta { margin: 2px 0 0; color: #86868b; font-size: 12px; }
  .notice { margin: 14px 0 0; padding: 10px 14px; border-radius: 10px; background: #f5f5f7; color: #515154; }
  .notice.warn { background: rgb(215 0 21 / 0.08); color: #d70015; font-weight: 600; }
  .item { padding: 16px 0; border-bottom: 1px solid rgb(0 0 0 / 0.08); break-inside: avoid; }
  .item:last-of-type { border-bottom: 0; }
  h2 { margin: 0; font-size: 14.5px; font-weight: 600; letter-spacing: -0.01em; }
  .space { margin: 0; color: #86868b; font-size: 11.5px; }
  .rows { display: grid; gap: 6px; margin-top: 10px; }
  .row { display: grid; grid-template-columns: 110px 1fr; gap: 12px; align-items: baseline; }
  .label { color: #86868b; font-size: 11.5px; }
  .value { white-space: pre-wrap; overflow-wrap: anywhere; }
  .mono { font-family: "Cascadia Mono", Consolas, ui-monospace, monospace; font-size: 11.5px; word-break: break-all; }
  .none { margin: 8px 0 0; color: #86868b; }
  footer { margin-top: 12px; padding-top: 12px; border-top: 1px solid rgb(0 0 0 / 0.08); color: #86868b; font-size: 10.5px; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <header>
    <h1>For ${esc(person)}</h1>
    <p class="meta">${count} kept in KAPEVault, handed back ${esc(longDate(createdAt))}</p>
    ${notice}
  </header>
  ${items.map((item) => itemBlock(item, withSecrets)).join("\n  ")}
  <footer><span>${withSecrets ? "Anyone holding this page can sign in to these accounts. Treat it like cash." : ""}</span><span>KAPEVault</span></footer>
</body>
</html>`;
}

module.exports = { handBackHtml, HAND_BACK_MARGIN_IN };
