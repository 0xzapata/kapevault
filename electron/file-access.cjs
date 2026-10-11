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

// \\server\share, //server/share, \\?\ and \\.\ device paths, and the NT form \??\UNC\server\share. Merely looking one up makes Windows
// contact that host and offer it the user's NTLM password hash (and freezes this thread for ~20s
// if nothing answers - measured), so a network path is never touched unless it sits
// inside a network folder the user linked.
const isNetworkPath = (p) => /^[\\/]{2}/.test(p) || /^[\\/]\?\?[\\/]/.test(p);

// True when a name under `root` goes through a symlink or junction. Looked at by name (lstat never
// follows the last part, and every earlier part is checked first), so nothing here resolves a link:
// resolving one that points at \\host\share would contact that host from main. The root itself is the
// user's own pick and is not looked at. A part that is not there stops the walk (the real lookup that
// follows refuses it).
function goesThroughLink(root, target) {
  let at = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    at = path.join(at, part);
    const found = fs.lstatSync(at, { throwIfNoEntry: false });
    if (!found) return false;
    if (found.isSymbolicLink()) return true;
  }
  return false;
}

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
  if (!isInside(cleanRoot, target)) throw new Error("Path leaves the linked folder");
  if (goesThroughLink(cleanRoot, target)) throw new Error("Path goes through a link");
  if (!isInside(real(cleanRoot), real(target))) throw new Error("Path leaves the linked folder");
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
  // Before any call that resolves links: a symlink inside a linked folder is never followed (the file
  // browser does not list one either), so a link to \\host\share cannot make main contact that host.
  if (roots.every((r) => goesThroughLink(r, clean))) throw new Error("Path goes through a link");
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

// Types that are ZIP packages: Office and OpenDocument documents. A file with one of these names that
// is not a ZIP (an RTF, an old binary .doc/.xls with macros) is sniffed and run by the Office app
// whatever the name says, so it is only revealed.
const ZIP_PACKAGES = new Set(".docx .xlsx .pptx .docm .xlsm .pptm .odt .ods .odp".split(" "));

// What the name allows, plus what is really there: a regular file (not a folder named "x.pdf"), and a
// ZIP header (PK\x03\x04) for a package type. Reads 4 bytes; false on any error.
function isGenuineOpenable(file) {
  try {
    if (!canOpenInApp(file)) return false;
    if (!fs.statSync(file).isFile()) return false;
    if (!ZIP_PACKAGES.has(path.extname(file).toLowerCase())) return true;
    const fd = fs.openSync(file, "r");
    try {
      const head = Buffer.alloc(4);
      return fs.readSync(fd, head, 0, 4, 0) === 4 && head.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

module.exports = { resolveInRoot, checkPath, listDir, readTextHead, canOpenInApp, isGenuineOpenable, revealTarget, isInside, isNetworkPath };
