// The Forever Opener: one standalone HTML page that opens a vault file in any browser, offline, so the
// vault outlives the app. Built here from electron/opener/ (template, style, crypto, page script) with
// a CSP that pins the inline style and script by hash and allows no request of any kind.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { writeFileAtomic } = require("./atomic-write.cjs");

const OPENER_NAME = "KAPEVault Opener.html";
const OPENER_PREFIX = "kapevault/opener/";
const MARKER = /<meta name="kapevault-opener" content="([0-9A-Za-z.+-]+)">/;
const MARKER_BYTES = 2048; // the marker sits in the first lines of the page

// The HTML parser turns CRLF into LF before hashing, so the source must be LF too (git may check out CRLF).
const read = (name) => fs.readFileSync(path.join(__dirname, "opener", name), "utf8").replace(/\r\n/g, "\n");
const hash = (text) => `'sha256-${crypto.createHash("sha256").update(text, "utf8").digest("base64")}'`;

function openerHtml(version) {
  if (!/^[0-9A-Za-z.+-]+$/.test(version)) throw new Error("Bad version");
  const style = read("opener.css");
  // One IIFE, so no page function lands on window (a global close() would replace window.close).
  const script = `(() => {\n"use strict";\n${read("opener-crypto.cjs")}\n${read("opener-page.js")}\n})();`;
  const csp = [
    "default-src 'none'",
    `script-src ${hash(script)}`,
    `style-src ${hash(style)}`,
    "img-src data:", // a device's label photo, which comes from the vault itself
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  return read("opener.html")
    .replaceAll("{{version}}", version)
    .replace("{{csp}}", csp)
    .replace("{{style}}", () => style)
    .replace("{{script}}", () => script);
}

// Where each app version's opener sits in the R2 bucket, beside (never inside) the snapshots.
const openerKey = (version) => `${OPENER_PREFIX}kapevault-opener-${version}.html`;

// "0.10.0" > "0.9.2"; anything after a dash or plus is ignored.
function compareVersions(a, b) {
  const parts = (v) => v.split(/[-+]/)[0].split(".").map((n) => Number(n) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}

// The version of the opener at file: undefined = no file there, null = something that is not an opener.
function openerVersionAt(file) {
  let info;
  try {
    info = fs.lstatSync(file);
  } catch (e) {
    if (e.code === "ENOENT") return undefined;
    throw e;
  }
  if (!info.isFile()) return null;
  const head = Buffer.alloc(MARKER_BYTES);
  const fd = fs.openSync(file, "r");
  try {
    return MARKER.exec(head.subarray(0, fs.readSync(fd, head, 0, MARKER_BYTES, 0)).toString("utf8"))?.[1] ?? null;
  } finally {
    fs.closeSync(fd);
  }
}

// The page's SHA-256, so a user can check an Opener file is the real one (Settings and the Emergency Kit).
const openerSha256 = (version) => crypto.createHash("sha256").update(openerHtml(version), "utf8").digest("hex");

// Puts the opener beside a saved copy. Never replaces a file that is not an opener ("foreign" - the
// user's own file of that name) or one that says it is from a newer version ("newer": unchecked, as
// this app cannot know that page). The same version counts as there ("current") only byte for byte:
// it carries our marker, so a changed one is ours to replace.
function writeOpenerBeside(dir, version) {
  const file = path.join(dir, OPENER_NAME);
  const existing = openerVersionAt(file);
  if (existing === null) return "foreign";
  const html = Buffer.from(openerHtml(version), "utf8");
  if (existing !== undefined) {
    const order = compareVersions(existing, version);
    if (order > 0) return "newer";
    if (order === 0 && fs.statSync(file).size === html.length && fs.readFileSync(file).equals(html)) return "current";
  }
  // Atomic (atomic-write.cjs): a half-written page would still carry the marker and never be
  // repaired. Its fresh random temp name means a file or link already there is never written through.
  writeFileAtomic(file, html);
  return "written";
}

module.exports = { openerHtml, openerKey, openerSha256, writeOpenerBeside, compareVersions, OPENER_NAME };
