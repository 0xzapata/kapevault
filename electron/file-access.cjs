// Read-only access to the folders saved as file-link entries. Every path is checked to sit
// inside one of those roots - after following symlinks and junctions - so the page can never
// browse or read anything else on the disk.
const fs = require("node:fs");
const path = require("node:path");

const MAX_ITEMS = 500;
const HIDDEN = new Set(["desktop.ini", "thumbs.db", ".ds_store"]);
// Allowlist: only documents open in their default app. Anything else (.exe, .url, .py, .lnk, .iso,
// .chm, ...) could run code, so it is only ever revealed in Explorer. That includes every office
// format that can carry macros (.docm, .xlsm, old .doc/.xls/.ppt, OpenDocument's Basic): of Office
// files only .docx/.xlsx/.pptx open, which Office refuses to run macros from. .rtf (a common Office
// exploit carrier), .svg and .xml (they open in a browser, scripts on) are only revealed too.
// So are .csv and .tsv: Excel runs a =formula from a file someone else put in the folder (the in-app table preview reads them).
const OPENABLE = new Set(
  (
    "docx xlsx pptx pdf txt md markdown log json " +
    "png jpg jpeg gif webp bmp avif heic tif tiff mp4 webm mov m4v mkv avi mp3 wav ogg m4a flac aac opus zip"
  )
    .split(" ")
    .map((e) => `.${e}`),
);

function isInside(root, target) {
  const rel = path.relative(root, target);
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith(`..${path.sep}`);
}

// Real location on disk (links followed). Missing paths throw, which callers treat as "not allowed".
const real = (p) => fs.realpathSync.native(p);

// \\server\share, //server/share, \\?\ and \\.\ device paths. Merely looking one up makes Windows
// contact that host and offer it the user's NTLM password hash (and freezes this thread for ~20s
// if nothing answers - measured), so a network path is never touched unless it sits
// inside a network folder the user linked.
const isNetworkPath = (p) => /^[\\/]{2}/.test(p);

// "report.pdf:hidden" is an NTFS alternate data stream, not the file it looks like.
const hasStreamName = (p) => process.platform === "win32" && p.slice(2).includes(":");

function realRoots(allowedRoots) {
  const roots = [];
  for (const r of allowedRoots) {
    try {
      roots.push(real(r));
    } catch {
      // a linked folder that no longer exists allows nothing
    }
  }
  return roots;
}

// Resolve `rel` under `root`, but only if root is one of the allowed folders and the result stays inside it.
function resolveInRoot(allowedRoots, root, rel = "") {
  const cleanRoot = path.resolve(root);
  if (!allowedRoots.some((r) => path.resolve(r) === cleanRoot)) throw new Error("Folder is not linked in the vault");
  const target = path.resolve(cleanRoot, rel);
  if (!isInside(cleanRoot, target) || !isInside(real(cleanRoot), real(target))) throw new Error("Path leaves the linked folder");
  return target;
}

// Same check for an absolute path (preview protocol, text reads, open/reveal). The path has to sit
// inside a linked folder BY NAME before anything is looked up on disk, and again after links are
// followed. Returns the real location, so what gets opened is what was checked.
function checkPath(allowedRoots, target) {
  const clean = path.resolve(target);
  if (hasStreamName(clean)) throw new Error("Not a file path");
  const roots = allowedRoots.map((r) => path.resolve(r)).filter((r) => isInside(r, clean));
  if (roots.length === 0) throw new Error("Path is outside linked folders");
  const onDisk = real(clean);
  if (!realRoots(roots).some((r) => isInside(r, onDisk))) throw new Error("Path is outside linked folders");
  return onDisk;
}

function listDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => !HIDDEN.has(d.name.toLowerCase()) && !d.name.startsWith("$"));
  const items = [];
  for (const d of entries) {
    if (!d.isDirectory() && !d.isFile()) continue; // symlinks/junctions are not shown
    let stat = null;
    try {
      stat = fs.statSync(path.join(dir, d.name));
    } catch {
      continue; // locked or vanished mid-listing
    }
    items.push({
      name: d.name,
      kind: d.isDirectory() ? "dir" : "file",
      size: d.isFile() ? stat.size : 0,
      modified: stat.mtimeMs,
    });
  }
  items.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === "dir" ? -1 : 1));
  return { items: items.slice(0, MAX_ITEMS), total: items.length };
}

// First `limit` bytes as UTF-8, for text-like previews.
function readTextHead(file, limit) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const buffer = Buffer.alloc(Math.min(size, limit));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    return { text: buffer.toString("utf8"), truncated: size > limit };
  } finally {
    fs.closeSync(fd);
  }
}

// Folders Finder shows as one item (a package) - an app, an installer, a plug-in, a library. Not every
// folder with a dot in its name: "Taxes.2025" is a folder.
const BUNDLE_EXTENSIONS = new Set(
  "app appex bundle component framework kext mdimporter mpkg pkg plugin prefpane qlgenerator saver workflow xpc photoslibrary rtfd"
    .split(" ")
    .map((e) => `.${e}`),
);

// A known bundle extension, or laid out as one (Contents/Info.plist, how every app-style bundle
// starts) - which also catches a package type an app registered that the list does not know.
function isMacBundle(dir) {
  return BUNDLE_EXTENSIONS.has(path.extname(dir).toLowerCase()) || fs.existsSync(path.join(dir, "Contents", "Info.plist"));
}

// What to give shell.showItemInFolder when an item's own path is opened. Revealing never runs
// anything, even if the path is swapped for a program after it was checked (openPath checks "is it
// a folder" again inside Electron and launches whatever file sits there by then). A folder opens
// with its first visible item selected; a file, an empty folder and a Mac bundle (.app .pkg
// .prefPane ..., which Finder would launch) are shown in their parent.
function revealTarget(target, platform = process.platform) {
  if (!fs.statSync(target).isDirectory()) return target;
  if (platform === "darwin" && isMacBundle(target)) return target;
  const child = fs.readdirSync(target).find((name) => !name.startsWith(".") && !name.startsWith("$") && !HIDDEN.has(name.toLowerCase()));
  return child ? path.join(target, child) : target;
}

// Windows strips trailing dots/spaces ("evil.exe." runs evil.exe), so those names never open.
function canOpenInApp(file) {
  const name = path.basename(file);
  if (/[. ]$/.test(name)) return false;
  return OPENABLE.has(path.extname(name).toLowerCase());
}

module.exports = { resolveInRoot, checkPath, listDir, readTextHead, canOpenInApp, revealTarget, isInside, isNetworkPath };
