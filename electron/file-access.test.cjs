const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveInRoot, checkPath, listDir, readTextHead, canOpenInApp, revealTarget, isNetworkPath, isGenuineOpenable } = require("./file-access.cjs");

// The real path: a runner's temp folder can be an 8.3 short name (RUNNER~1), and checkPath answers with the long one.
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-fa-")));
fs.mkdirSync(path.join(root, "Sub"));
fs.writeFileSync(path.join(root, "b.txt"), "hello");
fs.writeFileSync(path.join(root, "desktop.ini"), "x");
const roots = [root];

test("resolves inside the linked folder", () => {
  assert.equal(resolveInRoot(roots, root, "Sub"), path.join(root, "Sub"));
});

test("refuses to climb out with ..", () => {
  assert.throws(() => resolveInRoot(roots, root, ".."));
  assert.throws(() => resolveInRoot(roots, root, "Sub/../../"));
});

test("refuses a root that is not linked", () => {
  assert.throws(() => resolveInRoot(roots, os.tmpdir(), ""));
});

test("a sibling folder sharing the name prefix is not inside", () => {
  assert.throws(() => checkPath(roots, `${root}-evil${path.sep}secret.txt`));
});

test("lists folders first and hides system files", () => {
  const { items } = listDir(root);
  assert.deepEqual(items.map((i) => i.name), ["Sub", "b.txt"]);
});

test("reads only the head of a text file", () => {
  assert.deepEqual(readTextHead(path.join(root, "b.txt"), 3), { text: "hel", truncated: true });
});

test("only documents open in an app; anything that could run code is revealed", () => {
  for (const f of ["a.docx", "b.pdf", "c.XLSX", "d.png", "e.mp4", "f.zip"]) assert.equal(canOpenInApp("C:/x/" + f), true, f);
  for (const f of ["setup.EXE", "run.ps1", "go.url", "tool.py", "x.pyw", "help.chm", "d.iso", "s.lnk", "a.appref-ms", "noext", "evil.exe.", "evil.pdf ", "evil.exe "]) {
    assert.equal(canOpenInApp("C:/x/" + f), false, f);
  }
});

test("a document type that can carry macros is revealed, never opened", () => {
  const macroCapable = "docm dotm xlsm xltm xlam xlsb pptm potm ppsm ppam sldm doc dot xls xlt ppt pot pps odt ods odp";
  for (const ext of macroCapable.split(" ")) assert.equal(canOpenInApp(`C:/x/report.${ext}`), false, ext);
  for (const ext of ["docx", "xlsx", "pptx"]) assert.equal(canOpenInApp(`C:/x/report.${ext}`), true, ext);
});

test("RTF, SVG and XML are revealed, never opened (an Office exploit carrier, and pages a browser runs)", () => {
  for (const ext of ["rtf", "svg", "SVG", "xml"]) assert.equal(canOpenInApp(`C:/x/file.${ext}`), false, ext);
});

test("a real file named ..notes.txt is inside", () => {
  fs.writeFileSync(path.join(root, "..notes.txt"), "x");
  assert.equal(checkPath(roots, path.join(root, "..notes.txt")), path.join(root, "..notes.txt"));
});

test("a junction inside a linked folder cannot reach outside it", () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "nope");
  fs.symlinkSync(outside, path.join(root, "jump"), "junction");
  assert.throws(() => checkPath(roots, path.join(root, "jump", "secret.txt")));
  assert.throws(() => resolveInRoot(roots, root, "jump"));
});

// Looking up \\server\share makes Windows contact that host and offer it the user's password
// hash; 192.0.2.1 is never routed, so a lookup would stall ~20s. The refusal must come first.
test("a network path outside the linked folders is refused without touching the network", () => {
  const started = Date.now();
  assert.throws(() => checkPath(roots, "\\\\192.0.2.1\\share\\a.png"), /outside linked folders/);
  assert.throws(() => checkPath(roots, "//192.0.2.1/share/a.png"), /outside linked folders/);
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started}ms`);
});

test("an NTFS stream name is not a file", { skip: process.platform !== "win32" }, () => {
  assert.throws(() => checkPath(roots, path.join(root, "b.txt:hidden")), /Not a file path/);
});

test("the checked path is the real one, so what opens is what was checked", () => {
  fs.writeFileSync(path.join(root, "real.txt"), "x");
  assert.equal(checkPath(roots, path.join(root, "Sub", "..", "real.txt")), fs.realpathSync.native(path.join(root, "real.txt")));
});

test("an opened folder is only revealed: at its first visible item, or in its parent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-reveal-"));
  fs.writeFileSync(path.join(dir, "desktop.ini"), "x");
  fs.writeFileSync(path.join(dir, ".hidden"), "x");
  assert.equal(revealTarget(dir), dir, "nothing visible inside: the folder itself");
  fs.writeFileSync(path.join(dir, "notes.txt"), "x");
  assert.equal(revealTarget(dir), path.join(dir, "notes.txt"));
  assert.equal(revealTarget(path.join(dir, "notes.txt")), path.join(dir, "notes.txt"));
  assert.throws(() => revealTarget(path.join(dir, "missing")));
});

test("a Mac bundle is revealed itself, never opened into", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-bundle-"));
  for (const name of ["Tool.app", "Setup.pkg", "Pane.prefPane", "Run.workflow", "Kit.framework", "Mock Photos.photoslibrary"]) {
    const bundle = path.join(dir, name);
    fs.mkdirSync(path.join(bundle, "Contents"), { recursive: true });
    assert.equal(revealTarget(bundle, "darwin"), bundle, name);
  }
  // An extension no list knows, but laid out as a bundle (Contents/Info.plist): still a bundle.
  const odd = path.join(dir, "Mock Project.logicx");
  fs.mkdirSync(path.join(odd, "Contents"), { recursive: true });
  fs.writeFileSync(path.join(odd, "Contents", "Info.plist"), "<plist/>");
  assert.equal(revealTarget(odd, "darwin"), odd);
  assert.equal(revealTarget(path.join(dir, "Tool.app"), "win32"), path.join(dir, "Tool.app", "Contents"), "Windows has no bundles");
});

test("on a Mac a plain folder with a dot in its name is a folder, not a bundle", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-bundle-"));
  for (const name of ["Taxes.2025", "Mock Client v1.2", "site.backup"]) {
    const folder = path.join(dir, name);
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "receipt.pdf"), "x");
    assert.equal(revealTarget(folder, "darwin"), path.join(folder, "receipt.pdf"), name);
  }
});

test("csv and tsv are reveal-only: Excel runs formulas from a hostile file", () => {
  for (const f of ["a.csv", "b.TSV"]) assert.equal(canOpenInApp("C:/x/" + f), false, f);
});

// A link at `at` to the folder `to`: a junction works without Developer Mode. False when it cannot be made.
function linkTo(to, at) {
  try {
    fs.symlinkSync(to, at, "junction");
    return true;
  } catch {
    return false;
  }
}

test("a link inside a linked folder is refused by name, before any call that resolves links", (t) => {
  const inside = path.join(root, "Real");
  fs.mkdirSync(inside, { recursive: true });
  fs.writeFileSync(path.join(inside, "a.txt"), "x");
  const link = path.join(root, "ToReal");
  if (!linkTo(inside, link)) return t.skip("this PC cannot make a junction");
  const resolved = [];
  const original = fs.realpathSync.native;
  fs.realpathSync.native = (p, ...rest) => (resolved.push(p), original(p, ...rest));
  t.after(() => (fs.realpathSync.native = original));
  // The target is inside the root, so only the link check can refuse it; and no link may be resolved.
  assert.throws(() => checkPath(roots, path.join(link, "a.txt")), /through a link/);
  assert.throws(() => resolveInRoot(roots, root, "ToReal"), /through a link/);
  assert.deepEqual(resolved.filter((p) => p.includes("ToReal")), [], "the link was never resolved");
  assert.equal(checkPath(roots, path.join(inside, "a.txt")), path.join(inside, "a.txt"), "the plain path still opens");
});

test("isNetworkPath also knows the NT form with a single leading backslash", () => {
  for (const p of ["\\\\host\\share\\a", "//host/share/a", "\\\\?\\UNC\\host\\share\\a", "\\\\.\\pipe\\x", "\\??\\UNC\\host\\share\\a", "/??/UNC/host/share"]) assert.equal(isNetworkPath(p), true, p);
  for (const p of ["C:\\Users\\a", "/home/a", "relative\\x", "D:\\??\\x"]) assert.equal(isNetworkPath(p), false, p);
});

test("a package type opens only when it starts with a ZIP header; a folder named like a document never opens", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-genuine-"));
  const put = (name, bytes) => {
    fs.writeFileSync(path.join(dir, name), bytes);
    return path.join(dir, name);
  };
  assert.equal(isGenuineOpenable(put("ok.docx", Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]))), true);
  assert.equal(isGenuineOpenable(put("rtf.docx", Buffer.from("{" + "\\rtf1 hello"))), false);
  assert.equal(isGenuineOpenable(put("ole.xlsx", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]))), false);
  assert.equal(isGenuineOpenable(put("short.pptx", Buffer.from([0x50, 0x4b]))), false);
  assert.equal(isGenuineOpenable(put("empty.docx", Buffer.alloc(0))), false);
  assert.equal(isGenuineOpenable(put("plain.txt", "hello")), true, "a non-package type needs no header");
  assert.equal(isGenuineOpenable(put("run.exe", "MZ")), false, "the name still decides first");
  fs.mkdirSync(path.join(dir, "Folder.pdf"));
  assert.equal(isGenuineOpenable(path.join(dir, "Folder.pdf")), false);
  fs.mkdirSync(path.join(dir, "Folder.docx"));
  assert.equal(isGenuineOpenable(path.join(dir, "Folder.docx")), false);
  assert.equal(isGenuineOpenable(path.join(dir, "missing.docx")), false);
});
