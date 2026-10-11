const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const nodeCrypto = require("node:crypto");
const vm = require("node:vm");
const { checkOpenerFile, isNewerFile, openVault } = require("./opener/opener-crypto.cjs");
const { scryptSource, openerHtml, openerKey, openerSha256, writeOpenerBeside, checkOpenerBeside, OPENER_NAME } = require("./opener.cjs");
const { checkVaultFile } = require("./vault-crypto.cjs");
const { snapshotTime } = require("./cloud-backup.cjs");
const { createVaultSession } = require("./vault-session.cjs");

const MASTER = "mock master pass phrase orbit gazelle";

async function realVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-opener-"));
  const file = path.join(dir, "vault.kapevault");
  const vault = createVaultSession(file);
  const created = await vault.create(MASTER);
  const spaceId = created.vault.spaces[0].id;
  vault.saveEntry({ kind: "login", spaceId, title: "Mock Portal", username: "mock.user", password: "Mock-Pass-1", url: "https://portal.example.com" });
  vault.saveEntry({ kind: "note", spaceId, title: "Mock note", body: "Mock body text" });
  vault.lock();
  return { dir, file: JSON.parse(fs.readFileSync(file, "utf8")) };
}

// The page has no require: it gets core/scrypt.js inlined above opener-crypto.cjs. Run those two sources
// as the page does (no module, no require) and open a real vault with the result.
test("the inlined page source opens a vault with no module system", async () => {
  const { file } = await realVault();
  const pageSource = `(() => {\n${scryptSource()}\n${fs.readFileSync(path.join(__dirname, "opener", "opener-crypto.cjs"), "utf8")}\nreturn openVault;\n})()`;
  assert.ok(!/^export /m.test(pageSource), "the export keyword is gone");
  const openVaultInPage = vm.runInNewContext(pageSource, { crypto: nodeCrypto.webcrypto, TextEncoder, TextDecoder, atob, btoa, Uint8Array });
  const data = await openVaultInPage(file, MASTER);
  assert.equal(data.entries.find((e) => e.kind === "login").password, "Mock-Pass-1");
});

test("opens a real vault file with its master password, NFC-normalised like the app", async () => {
  const { file } = await realVault();
  const steps = [];
  const data = await openVault(file, MASTER, (done, total) => void steps.push(done / total));
  assert.equal(data.spaces[0].name, "Personal");
  const login = data.entries.find((e) => e.kind === "login");
  assert.equal(login.password, "Mock-Pass-1");
  assert.equal(data.entries.find((e) => e.kind === "note").body, "Mock body text");
  assert.ok(steps.length > 100 && steps.at(-1) === 1, "progress runs to the end");

  // A decomposed "é" types differently but must open a vault made with the composed one.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-opener-nfc-"));
  const nfc = createVaultSession(path.join(dir, "vault.kapevault"));
  await nfc.create("mock café pass phrase");
  nfc.lock();
  const nfcFile = JSON.parse(fs.readFileSync(path.join(dir, "vault.kapevault"), "utf8"));
  assert.ok(await openVault(nfcFile, "mock café pass phrase"));
});

test("an ID's expiry reaches the Opener and reads plainly, like a key's", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-opener-id-"));
  const vault = createVaultSession(path.join(dir, "vault.kapevault"));
  const created = await vault.create(MASTER);
  vault.saveEntry({ kind: "thing", spaceId: created.vault.spaces[0].id, title: "Mock Passport", spot: "blue folder", expires: "2031-04-30" });
  vault.lock();
  const data = await openVault(JSON.parse(fs.readFileSync(path.join(dir, "vault.kapevault"), "utf8")), MASTER);
  assert.equal(data.entries[0].expires, "2031-04-30");
  const page = fs.readFileSync(path.join(__dirname, "opener", "opener-page.js"), "utf8");
  assert.match(/^const PLAIN = new Set\(\[(.*)\]\);$/m.exec(page)[1], /"expires"/, "masked unless PLAIN");
});

test("a wrong password or an altered file gives null, never garbage", async () => {
  const { file } = await realVault();
  assert.equal(await openVault(file, "not the master"), null);
  const data = Buffer.from(file.data, "base64");
  data[0] ^= 1;
  assert.equal(await openVault({ ...file, data: data.toString("base64") }, MASTER), null);
});

test("a vault saved before the rename (bovault header) opens", async () => {
  const { file } = await realVault();
  assert.equal((await openVault({ ...file, format: "bovault" }, MASTER)).entries.length, 2);
});

test("a vault a newer KAPEVault saved is refused as newer, not as 'not a vault', and the page says so", async () => {
  const { file } = await realVault();
  for (const newer of [{ ...file, version: 2 }, { ...file, version: 1.5 }, { ...file, format: "bovault", version: 3 }, { ...file, version: 2, kdf: { ...file.kdf, N: 2 ** 20 } }]) {
    assert.equal(checkOpenerFile(newer), false, "still refused");
    assert.equal(isNewerFile(newer), true);
    await assert.rejects(openVault(newer, MASTER), /Newer KAPEVault vault file/);
  }
  for (const other of [file, { ...file, version: "2" }, { ...file, format: "other", version: 2 }, null, "text"]) assert.equal(isNewerFile(other), false, JSON.stringify(other)?.slice(0, 60));
  await assert.rejects(openVault({ ...file, format: "other", version: 2 }, MASTER), /Not a KAPEVault vault file/);
  assert.ok(openerHtml("1.0.0").includes("This vault was saved by a newer KAPEVault. Use a newer Opener to open it."));
});

test("the header check matches the app's checkVaultFile and runs before any work", async () => {
  const { file } = await realVault();
  const salt = (n) => Buffer.alloc(n).toString("base64");
  const cases = [
    file,
    { ...file, format: "bovault" },
    { ...file, format: "other" },
    { ...file, version: 2 },
    { ...file, kdf: { ...file.kdf, name: "pbkdf2" } },
    { ...file, kdf: { ...file.kdf, N: 2 ** 18 } },
    { ...file, kdf: { ...file.kdf, N: 2 ** 13 } },
    { ...file, kdf: { ...file.kdf, N: 3 * 2 ** 14 } },
    { ...file, kdf: { ...file.kdf, r: 16 } },
    { ...file, kdf: { ...file.kdf, p: 2 ** 20 } },
    { ...file, kdf: { ...file.kdf, salt: salt(8) } },
    { ...file, iv: salt(16) },
    { ...file, tag: salt(8) },
    { ...file, iv: "not base64!" },
    { ...file, data: 42 },
    // Every KAPEVault file is N = 2^17: a lower N was a key-unlocked vault's header edited unnoticed.
    { ...file, kdf: { ...file.kdf, N: 2 ** 14 } },
    { ...file, kdf: { ...file.kdf, N: 2 ** 16 } },
    // Base64 the PC's lenient decoder used to accept and the Opener and phone refuse.
    { ...file, kdf: { ...file.kdf, salt: `${file.kdf.salt}!!` } },
    { ...file, kdf: { ...file.kdf, salt: file.kdf.salt.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_") } },
    { ...file, kdf: { ...file.kdf, salt: ` ${file.kdf.salt}` } },
    null,
    "text",
  ];
  const accepted = cases.filter((c) => {
    try {
      return Boolean(checkVaultFile(c));
    } catch {
      return false;
    }
  });
  assert.deepEqual(accepted, [file, { ...file, format: "bovault" }], "only the two real formats pass");
  for (const c of cases) {
    let app = true;
    try {
      checkVaultFile(c);
    } catch {
      app = false;
    }
    assert.equal(checkOpenerFile(c), app, JSON.stringify(c)?.slice(0, 80));
  }
  // The body is held to the same canonical base64. The Opener refuses it in openVault (before any KDF
  // work), so its verdict is compared there, not in checkOpenerFile.
  const looseData = [`${file.data}\n`, ` ${file.data}`, `${file.data}A`, file.data.slice(0, -4) + "-_-_", file.data.slice(0, -1)];
  for (const data of looseData) {
    assert.throws(() => checkVaultFile({ ...file, data }), /Not a KAPEVault file/, data.slice(-12));
    await assert.rejects(openVault({ ...file, data }, MASTER), /Not a KAPEVault vault file/, data.slice(-12));
  }
  // p = 2^20 would run for hours, and a body that is not base64 is not worth a KDF: refused at once.
  await assert.rejects(openVault({ ...file, data: "not base64!" }, MASTER), /Not a KAPEVault vault file/);
  const started = Date.now();
  await assert.rejects(openVault({ ...file, kdf: { ...file.kdf, p: 2 ** 20 } }, MASTER), /Not a KAPEVault vault file/);
  assert.ok(Date.now() - started < 200);
});

test("the page is self-contained: a strict CSP, no URL, no request API", () => {
  const html = openerHtml("1.2.3");
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1] ?? "";
  assert.match(csp, /^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'; style-src 'sha256-[A-Za-z0-9+/=]+'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'$/);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
  assert.ok(!/https?:\/\//i.test(html), "no http(s) URL anywhere");
  assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b/.test(html), "no request API");
  assert.ok(!/\ssrc=|@import|url\((?!#)/.test(html), "nothing loads from a src or a CSS url()");
  assert.ok(!html.includes("\u2014"), "no em dash");
  assert.ok(html.length < 100 * 1024, `${html.length} bytes`);

  // The hashes pin exactly the inline style and script.
  const sha = (text) => nodeCrypto.createHash("sha256").update(text).digest("base64");
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(csp.includes(`'sha256-${sha(style)}'`) && csp.includes(`'sha256-${sha(script)}'`));
  assert.equal(html.match(/<script/g).length, 1);
});

test("the page shows its version and explains the format", () => {
  const html = openerHtml("1.2.3");
  assert.ok(html.includes('<meta name="kapevault-opener" content="1.2.3">'));
  assert.ok(html.includes("KAPEVault Opener 1.2.3"));
  assert.match(html, /AES-256-GCM with a 12-byte IV and a 16-byte tag/);
  assert.throws(() => openerHtml('1"><script>'), /Bad version/);
});

test("the opener goes beside a saved copy, but never over someone else's file, and a newer-looking one is replaced", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-opener-beside-"));
  const target = path.join(dir, OPENER_NAME);
  assert.equal(writeOpenerBeside(dir, "1.0.0"), "written");
  assert.ok(fs.readFileSync(target, "utf8").includes('content="1.0.0"'));
  assert.equal(writeOpenerBeside(dir, "1.0.0"), "current");
  assert.equal(writeOpenerBeside(dir, "0.9.0"), "written", "a page that says it is newer is not this app's bytes, so it is replaced");
  assert.equal(fs.readFileSync(target, "utf8"), openerHtml("0.9.0"));
  assert.equal(writeOpenerBeside(dir, "1.10.0"), "written");
  assert.ok(fs.readFileSync(target, "utf8").includes('content="1.10.0"'));

  // Same version, changed page: it carries our marker, so it is replaced with the real one.
  fs.writeFileSync(target, openerHtml("1.10.0").replace("</body>", "<p>mock planted line</p></body>"));
  assert.equal(writeOpenerBeside(dir, "1.10.0"), "written");
  assert.equal(fs.readFileSync(target, "utf8"), openerHtml("1.10.0"));
  fs.writeFileSync(target, `${openerHtml("1.10.0")} `); // one byte longer
  assert.equal(writeOpenerBeside(dir, "1.10.0"), "written");
  assert.equal(writeOpenerBeside(dir, "1.10.0"), "current");
  const sha = nodeCrypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
  assert.equal(openerSha256("1.10.0"), sha, "the fingerprint shown is the file's own SHA-256");

  // A planted page only has to leave the marker out: it is moved aside under a name no browser runs.
  fs.writeFileSync(target, "<html>mock planted page, no marker</html>");
  assert.equal(writeOpenerBeside(dir, "2.0.0"), "moved");
  assert.equal(fs.readFileSync(target, "utf8"), openerHtml("2.0.0"));
  const aside = fs.readdirSync(dir).filter((f) => f.startsWith("KAPEVault Opener (moved aside "));
  assert.equal(aside.length, 1);
  assert.ok(aside[0].endsWith(".html.txt"), aside[0]);
  assert.equal(fs.readFileSync(path.join(dir, aside[0]), "utf8"), "<html>mock planted page, no marker</html>", "its bytes are kept");
  fs.writeFileSync(target, "<html>a second one the same day</html>");
  assert.equal(writeOpenerBeside(dir, "2.0.0"), "moved");
  assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith("KAPEVault Opener (moved aside ")).length, 2, "never over an earlier one");
  fs.rmSync(target);
  fs.mkdirSync(target);
  assert.equal(writeOpenerBeside(dir, "2.0.0"), "foreign", "a folder of that name is left alone");
});

test("the opener is written through a new random temp file, never an existing one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-opener-tmp-"));
  const planted = path.join(dir, `${OPENER_NAME}.tmp`); // the old fixed temp name
  fs.writeFileSync(planted, "mock planted file");
  assert.equal(writeOpenerBeside(dir, "1.0.0"), "written");
  assert.equal(fs.readFileSync(planted, "utf8"), "mock planted file");
  assert.deepEqual(fs.readdirSync(dir).sort(), [OPENER_NAME, `${OPENER_NAME}.tmp`].sort(), "no temp file left behind");
});

test("one vault size limit: saving, both restores and the Forever Opener agree", () => {
  const { MAX_VAULT_BYTES } = require("./vault-crypto.cjs");
  assert.equal(MAX_VAULT_BYTES, 64 * 1024 * 1024);
  // The file restore (ipc/restore.cjs) and r2-client.cjs import it; the page cannot, so its own copy must match.
  const page = fs.readFileSync(path.join(__dirname, "opener", "opener-page.js"), "utf8");
  const limit = /const MAX_FILE_BYTES = ([\d *]+);/.exec(page)?.[1];
  assert.equal(limit && limit.split("*").reduce((n, x) => n * Number(x), 1), MAX_VAULT_BYTES);
  for (const file of ["ipc/restore.cjs", "r2-client.cjs"]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.ok(source.includes("MAX_VAULT_BYTES") && !/64 \* 1024 \* 1024/.test(source), `${file} uses the shared limit`);
  }
});

// Audit crypto 3 (2026-10-04): a planted page that claims 99.0.0 used to survive every later copy.
test("a planted page that claims a far newer version is replaced, not trusted", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-opener-planted-"));
  const target = path.join(dir, OPENER_NAME);
  fs.writeFileSync(target, openerHtml("99.0.0").replace("</body>", "<p>mock planted line</p></body>"));
  assert.equal(writeOpenerBeside(dir, "1.0.0"), "written");
  assert.equal(fs.readFileSync(target, "utf8"), openerHtml("1.0.0"));
});

test("Check my Opener: genuine, changed (put back), missing, and not an opener", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-opener-check-"));
  const target = path.join(dir, OPENER_NAME);
  assert.equal(checkOpenerBeside(dir, "1.0.0"), "missing");
  assert.ok(!fs.existsSync(target), "checking never creates one");
  writeOpenerBeside(dir, "1.0.0");
  assert.equal(checkOpenerBeside(dir, "1.0.0"), "genuine");
  fs.writeFileSync(target, openerHtml("1.0.0").replace("</body>", "<p>mock planted line</p></body>"));
  assert.equal(checkOpenerBeside(dir, "1.0.0"), "replaced");
  assert.equal(fs.readFileSync(target, "utf8"), openerHtml("1.0.0"));
  assert.equal(checkOpenerBeside(dir, "1.0.0"), "genuine");
  fs.writeFileSync(target, "<html>mock planted page, no marker</html>");
  assert.equal(checkOpenerBeside(dir, "1.0.0"), "replaced", "a page without the marker is no way around the check");
  assert.equal(fs.readFileSync(target, "utf8"), openerHtml("1.0.0"));
  fs.rmSync(target);
  fs.mkdirSync(target);
  assert.equal(checkOpenerBeside(dir, "1.0.0"), "foreign");
});

test("the cloud copy sits beside the snapshots, where listing and thinning never see it", () => {
  assert.equal(openerKey("0.1.0"), "kapevault/opener/kapevault-opener.html", "one fixed key in every version (audit run-1 4.8)");
  assert.equal(snapshotTime(openerKey("0.1.0")), null);
});
