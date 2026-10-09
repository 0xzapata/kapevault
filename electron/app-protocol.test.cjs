// Run with `npm test`. The app:// handler serves the dist folder and nothing outside it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveAppFile, handleAppScheme } = require("./app-protocol.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "kv-app-"));
const dist = path.join(root, "dist");
fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
fs.writeFileSync(path.join(dist, "index.html"), "<html></html>");
fs.writeFileSync(path.join(dist, "assets", "a.js"), "1");
fs.writeFileSync(path.join(dist, "assets", "f.woff2"), "x");
fs.writeFileSync(path.join(root, "secret.txt"), "no");
fs.mkdirSync(path.join(root, "dist-evil")); // shares dist's name as a prefix
fs.writeFileSync(path.join(root, "dist-evil", "x.txt"), "no");

const at = (p) => resolveAppFile(dist, `app://kapevault${p}`);

test("the root and a file inside dist resolve to that file", () => {
  assert.equal(at("/"), path.join(dist, "index.html"));
  assert.equal(at("/index.html"), path.join(dist, "index.html"));
  assert.equal(at("/assets/a.js?x=1#h"), path.join(dist, "assets", "a.js"));
});

test("a path that leaves dist is refused, however it is spelled", () => {
  for (const p of ["/../secret.txt", "/assets/../../secret.txt", "/%2e%2e/secret.txt", "/%2E%2E%2Fsecret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/..%5csecret.txt", "/..%2f..%2fsecret.txt", "/../dist-evil/x.txt", "/%2e%2e/dist-evil/x.txt", "//secret.txt", "/%00", "/index.html%00.png", "/C:/Windows/win.ini", "/%5c%5cserver%5cshare%5cx", "/%ZZ"]) {
    const got = at(p);
    assert.ok(got === null || got.startsWith(dist + path.sep), `${p} -> ${got}`);
    assert.notEqual(got, path.join(root, "secret.txt"));
  }
  // The URL parser already folds ".." (and "%2e%2e") into the root; what is left is a file name under dist.
  assert.equal(at("/%2e%2e/secret.txt"), path.join(dist, "secret.txt"));
  for (const p of ["/..%2f..%2fsecret.txt", "/%00", "/%ZZ", "/index.html%00.png"]) assert.equal(at(p), null, p);
});

test("only app://kapevault is served", () => {
  for (const u of ["app://evil/index.html", "app://kapevault:81/index.html", "app://user@kapevault/index.html", "file:///C:/x", "https://kapevault/index.html", "kapevault-file://local/x", "not a url"]) assert.equal(resolveAppFile(dist, u), null, u);
});

test("the handler answers 200 with the right type, 404 for everything else", async () => {
  let handler;
  handleAppScheme({ handle: (_scheme, fn) => (handler = fn) }, dist);
  const get = (p) => handler({ url: `app://kapevault${p}` });
  const page = await get("/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /^text\/html/);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.match((await get("/assets/a.js")).headers.get("content-type"), /^text\/javascript/);
  assert.equal((await get("/assets/f.woff2")).headers.get("content-type"), "font/woff2");
  assert.equal((await get("/assets")).status, 404); // a folder
  assert.equal((await get("/nope.js")).status, 404);
  assert.equal((await get("/%2e%2e/secret.txt")).status, 404);
  assert.equal((await get("/../secret.txt")).status, 404);
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
