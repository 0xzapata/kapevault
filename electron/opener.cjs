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
// core/scrypt.js is an ES module (the phone imports it); the page takes it as plain script, so its one
// `export` is dropped. Any other module syntax would break the page, so it is refused here, not shipped.
function scryptSource() {
  const text = fs.readFileSync(path.join(__dirname, "..", "core", "scrypt.js"), "utf8").replace(/\r\n/g, "\n");
  if (/^\s*import\b/m.test(text) || text.match(/^export /gm)?.length !== 1) throw new Error("core/scrypt.js must hold no import and exactly one export");
  return text.replace(/^export /m, "");
}
const hash = (text) => `'sha256-${crypto.createHash("sha256").update(text, "utf8").digest("base64")}'`;

function openerHtml(version) {
  if (!/^[0-9A-Za-z.+-]+$/.test(version)) throw new Error("Bad version");
  const style = read("opener.css");
  // One IIFE, so no page function lands on window (a global close() would replace window.close).
  const script = `(() => {\n"use strict";\n${scryptSource()}\n${read("opener-crypto.cjs")}\n${read("opener-page.js")}\n})();`;
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

// A file of the Opener's name that is not an opener at all (no marker, or a link) is moved aside, never
// left: a planted page only has to leave the marker out. It keeps its bytes under a name a browser will
// not run ("KAPEVault Opener (moved aside 2026-10-04).html.txt"), and the real page takes the name.
function moveAside(dir, file) {
  const day = new Date().toISOString().slice(0, 10);
  for (let n = 1; ; n += 1) {
    const aside = path.join(dir, `KAPEVault Opener (moved aside ${day}${n > 1 ? ` ${n}` : ""}).html.txt`);
    if (fs.existsSync(aside)) continue;
    fs.renameSync(file, aside); // a link is renamed itself, never followed
    return;
  }
}

// Puts the opener beside a saved copy. Only this version's exact bytes count as there ("current").
// Any other page that carries our marker is replaced ("written"), a "newer" one too: anyone who can write
// the folder can plant a page that claims 99.0.0, and this app cannot tell it from a real newer release.
// Anything else by that name is moved aside first ("moved"); only a folder of that name is left
// ("foreign" - no browser opens a folder as a page).
function writeOpenerBeside(dir, version) {
  const file = path.join(dir, OPENER_NAME);
  const existing = openerVersionAt(file);
  if (existing === null && fs.lstatSync(file).isDirectory()) return "foreign";
  const html = Buffer.from(openerHtml(version), "utf8");
  if (existing === null) {
    moveAside(dir, file);
    writeFileAtomic(file, html);
    return "moved";
  }
  if (existing !== undefined && fs.statSync(file).size === html.length && fs.readFileSync(file).equals(html)) return "current";
  // Atomic (atomic-write.cjs): a half-written page would still carry the marker and never be
  // repaired. Its fresh random temp name means a file or link already there is never written through.
  writeFileAtomic(file, html);
  return "written";
}

// "Check my Opener": the Opener beside the folder copy against this app's own bytes. A changed one is
// put back (same rule as a copy), so the answer is what the folder holds afterwards.
// "genuine" | "replaced" | "missing" | "foreign" (only a folder of that name, which is left alone).
function checkOpenerBeside(dir, version) {
  if (openerVersionAt(path.join(dir, OPENER_NAME)) === undefined) return "missing";
  const result = writeOpenerBeside(dir, version);
  return result === "current" ? "genuine" : result === "foreign" ? "foreign" : "replaced";
}

module.exports = { scryptSource, openerHtml, openerKey, openerSha256, writeOpenerBeside, checkOpenerBeside, OPENER_NAME };
