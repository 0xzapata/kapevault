// npm run proof - proves the native shell on the running KAPEVault emulator (start it headless with
// `npm run sim -- --no-window`; a windowed one shares its clipboard with Windows): hardening,
// FLAG_SECURE, the background and resume events, the sensitive clipboard, its 30 s clear (in front
// and in the background, and an empty paste in the app after it) and clear(), the fingerprint key
// round trip (and that a new fingerprint invalidates it), the scrypt timing in the WebView, the camera
// QR scan, predictive Back (the page's callback on only while it has history), and autofill (the
// service fills a test sign-in screen through the vault), and KAPEVault Pro's Play Billing (never run
// for a free user; the plugin's answers through the fake store). The app opens on the vault; these checks
// drive the native pieces from the shell check page (shell.html, in debug builds only) over the
// WebView's DevTools socket (debug builds only), and leave the emulator with no PIN and no
// fingerprints. Everything lands in proof/ (gitignored).
// `--release` also builds the release web assets and APK: no shell page, no mock host, no DevTools.
//
// The WebView scrypt timed here is the Forever Opener's own code, read from electron/opener/ (read
// only) and evaluated through DevTools - the app itself never references the PC code.
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, jdk, sdk } from "./android-env.mjs";
import { APP, PIN, kapevaultDevice, sleep } from "./lib/device.mjs";
import { SETUP_CODE, TOTP_CODE } from "../src/app/host/test/qr-poster.mjs";
import { aimCamera } from "./emu-camera.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "proof");
const SECRET = "kapevault-test-secret";
const CDP_PORT = 9333;
const report = {};
// The proof is of the play flavor: it has the Play Billing the billing section drives.
const PLAY_DEBUG_APK = path.join(root, "android", "app", "build", "outputs", "apk", "play", "debug", "app-play-debug.apk");
fs.mkdirSync(out, { recursive: true });

// A promise's value, or null when it has not settled in time.
const within = (promise, ms) => Promise.race([promise, sleep(ms).then(() => null)]);
function check(name, ok, detail) {
  report[name] = { ok, ...(detail === undefined ? {} : { detail }) };
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` - ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

// --- adb (scripts/lib/device.mjs) ---------------------------------------------------------------

const { sh, shBytes, pidOf, key, touchFinger, clipText, resetLock, tapText, waitForText, enrollFingerprint, uiNodes, ...device } = kapevaultDevice("proof");
const UNKNOWN_FINGER = 10; // never enrolled
const saveScreen = (name) => fs.writeFileSync(path.join(out, name), shBytes("exec-out", "screencap", "-p"));

// The RGB of every 7th pixel of an adb screenshot inside a box given as screen fractions.
function screenPixels([left, top, right, bottom]) {
  const raw = shBytes("exec-out", "screencap");
  const [width, height] = [raw.readUInt32LE(0), raw.readUInt32LE(4)];
  const header = raw.length - width * height * 4;
  const pixels = [];
  for (let y = Math.floor(height * top); y < height * bottom; y += 7) {
    for (let x = Math.floor(width * left); x < width * right; x += 7) pixels.push(raw.readUInt32BE(header + (y * width + x) * 4) >>> 8);
  }
  return pixels;
}
// Share of pure-black pixels in the middle of the screen (the status and nav bars are not ours).
function blackShare() {
  const pixels = screenPixels([0, 0.15, 1, 0.85]);
  return pixels.filter((rgb) => rgb === 0).length / pixels.length;
}
// Share of the most common colour in the box: 1 for a flat fill.
function flatShare(box) {
  const counts = new Map();
  const pixels = screenPixels(box);
  for (const rgb of pixels) counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
  return Math.max(...counts.values()) / pixels.length;
}

// --- the page, over DevTools ---------------------------------------------------------------------

let page;
// Every evaluate waits for its answer: some checks wait on the page for longer than a minute.
async function openPage() {
  page = await device.openPage({ port: CDP_PORT, out, answerMs: 0 });
}

// The checks below drive the native pieces from the shell check page, which only debug builds carry.
async function openShell() {
  await page.goto("/shell.html");
  if (!(await page.evaluate(`Boolean(document.getElementById("paste"))`))) throw new Error("no shell check page in this build - install a debug build with npm run sim");
}
const native = (plugin, method, options = {}) =>
  page.evaluate(`Capacitor.nativePromise(${JSON.stringify(plugin)}, ${JSON.stringify(method)}, ${JSON.stringify(options)}).catch((e) => ({ error: { code: e.code, message: e.message } }))`);
const eventCount = (name) => page.evaluate(`Number(document.querySelector('[data-result="${name}"]').textContent.split(" ")[0])`);

async function pasteIntoPage() {
  await page.evaluate(`(() => { const t = document.getElementById("paste"); t.value = ""; t.focus(); })()`);
  key("KEYCODE_PASTE");
  await sleep(1000);
  return page.evaluate(`document.getElementById("paste").value`);
}

async function returnToApp() {
  sh("shell", "am", "start", "-n", `${APP}/.MainActivity`);
  await sleep(2000);
}

// --- checks --------------------------------------------------------------------------------------

// The first launch after a clean install, with no reload: the vault's first run, and nothing failed.
async function firstLaunch() {
  page?.close();
  sh("shell", "pm", "clear", APP);
  await openPage();
  let text = "";
  for (let i = 0; i < 30 && !/Choose a master password/.test(text); i += 1) {
    await sleep(500);
    text = String(await page.evaluate("document.body?.innerText ?? ''"));
  }
  await page.screenshot("first-launch.png");
  check("the first launch after a clean install opens the vault's first run (no reload)", /Choose a master password/.test(text) && /Restore from backup/.test(text), text.slice(0, 120));
  const problems = await page.problems();
  check("no page errors or failed loads on the first launch", problems.length === 0, problems);
  await openShell();
}

// Android recreates the activity for a config change the manifest does not absorb (font size here; a
// SIM coming up on a cold boot did it first). When that lands before the window attaches, the first
// activity's WebView must not stay behind running a second copy of the vault. It lands early in about
// half the starts, so four are tried.
async function relaunch() {
  page?.close();
  const pages = async () => {
    const pid = pidOf();
    sh("forward", `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${pid}`);
    return (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).filter((t) => t.type === "page").map((t) => (JSON.parse(t.description || "{}").attached ? "attached" : "never attached"));
  };
  const runs = [];
  try {
    for (const scale of ["1.15", "1.3", "1.15", "1.3"]) {
      sh("shell", "am", "force-stop", APP);
      sh("shell", "settings", "put", "system", "font_scale", "1.0");
      await sleep(1500);
      sh("shell", `am start -n ${APP}/.MainActivity >/dev/null; sleep 0.3; settings put system font_scale ${scale}`);
      let seen = [];
      for (let i = 0; i < 30 && !seen.includes("attached"); i += 1) {
        await sleep(1000);
        const pid = pidOf();
        if (pid && sh("shell", "cat", "/proc/net/unix").includes(`webview_devtools_remote_${pid}`)) seen = await pages();
      }
      await sleep(3000); // a leaked one is still there after the new one settles
      runs.push((await pages()).join(" + "));
    }
  } finally {
    sh("shell", "settings", "put", "system", "font_scale", "1.0");
  }
  check("a relaunch while the app starts leaves one WebView (the old one is destroyed)", runs.every((r) => r === "attached"), runs);
  await openPage();
  await openShell();
}

async function hardening() {
  const apk = PLAY_DEBUG_APK;
  const aapt2 = path.join(sdk, "build-tools", "36.1.0", process.platform === "win32" ? "aapt2.exe" : "aapt2");
  const manifest = execFileSync(aapt2, ["dump", "xmltree", "--file", "AndroidManifest.xml", apk], { encoding: "utf8" });
  fs.writeFileSync(path.join(out, "manifest.txt"), manifest);
  const permissions = [...manifest.matchAll(/uses-permission[\s\S]*?android:name.*?="([^"]+)"/g)].map((m) => m[1]);
  // com.android.vending.BILLING and ACCESS_NETWORK_STATE: merged from the Play Billing library
  // (BillingPlugin, KAPEVault Pro) and its com.google.android.datatransport dependency.
  const allowed = ["android.permission.INTERNET", "android.permission.USE_BIOMETRIC", "android.permission.CAMERA", "android.permission.HIDE_OVERLAY_WINDOWS", "com.android.vending.BILLING", "android.permission.ACCESS_NETWORK_STATE", `${APP}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`];
  check("permissions: INTERNET, USE_BIOMETRIC, CAMERA, HIDE_OVERLAY_WINDOWS, BILLING and ACCESS_NETWORK_STATE only (plus the androidx receiver guard)", permissions.every((p) => allowed.includes(p)), permissions);
  check("the vault's task takes no other app's activity (taskAffinity is empty)", /taskAffinity\(0x[0-9a-f]+\)=""/.test(manifest));
  check("the camera is not required to install", /uses-feature[\s\S]*?android\.hardware\.camera\.any[\s\S]*?required.*?=false/.test(manifest));
  check("allowBackup=false in the manifest", /allowBackup\(0x[0-9a-f]+\)=false/.test(manifest));
  check("dataExtractionRules set", /dataExtractionRules/.test(manifest));
  check("usesCleartextTraffic=false in the manifest", /usesCleartextTraffic\(0x[0-9a-f]+\)=false/.test(manifest));
  const pkg = sh("shell", "dumpsys", "package", APP);
  fs.writeFileSync(path.join(out, "package.txt"), pkg);
  const flags = pkg.match(/pkgFlags=\[([^\]]*)\]/)?.[1] ?? "";
  check("installed without ALLOW_BACKUP", !flags.includes("ALLOW_BACKUP"), flags.trim());

  // The app opens on the vault; the shell check page is a second page of the same debug build.
  await page.goto("/");
  // React draws once the host answers; under load that is after "load", so it is waited for (10 s).
  let start;
  for (let i = 0; i < 40 && !start?.vault; i += 1) {
    if (i) await sleep(250);
    start = await page.evaluate(`({ href: location.href, vault: document.getElementById("root")?.childElementCount > 0, shell: Boolean(document.getElementById("paste")) })`);
  }
  check("the app opens on the vault, bundled (no server.url)", start.href === "https://localhost/" && start.vault && !start.shell, start);
  // Edge to edge on any WebView: the page fills the whole display and gets the bars as safe-area insets.
  const [, width, height] = sh("shell", "wm", "size").match(/(\d+)x(\d+)\s*$/) ?? [];
  await keyboardDown(); // it would shrink the page and cover the bottom inset
  // The insets arrive from MainActivity just after the page commits, so they are waited for.
  let edge;
  for (let i = 0; i < 12 && !edge?.top; i += 1) {
    await sleep(250);
    edge = await page.evaluate(`(() => { const css = getComputedStyle(document.documentElement); return { w: Math.round(innerWidth * devicePixelRatio), h: Math.round(innerHeight * devicePixelRatio), top: css.getPropertyValue("--safe-area-inset-top"), bottom: css.getPropertyValue("--safe-area-inset-bottom") }; })()`);
  }
  await page.screenshot("edge-to-edge.png");
  check("edge to edge: the page covers the whole display, the bars come as safe-area insets", Math.abs(edge.w - width) <= 2 && Math.abs(edge.h - height) <= 2 && parseInt(edge.top, 10) > 0 && parseInt(edge.bottom, 10) > 0, { display: `${width}x${height}`, ...edge });
  for (const pathname of ["/", "/shell.html"]) {
    await page.goto(pathname);
    const csp = await page.evaluate(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content`);
    check(`strict CSP in ${pathname}`, csp?.startsWith("default-src 'none'"), csp);
    // fetch() only: the CSP does not reach Capacitor's native HTTP client (CapacitorHttp), which is why
    // corePlugins() checks it reaches R2 hosts and nothing else.
    const fetched = await page.evaluate(`fetch("https://example.com").then(() => "loaded", () => "blocked")`);
    check(`CSP blocks a fetch() to the internet from ${pathname}`, fetched === "blocked", fetched);
  }
}

// Capacitor's own WebView plugin is replaced by one with no methods and CapacitorHttp by one that reaches
// only R2 S3 API hosts over https (DisabledCorePlugins.kt: the phone's R2 traffic needs it), and a server
// path persisted behind their back is dropped at start (MainActivity). Without that, script that got into
// the page could write an index.html with @capacitor/filesystem, call WebView.setServerBasePath +
// persistServerBasePath, and every later launch would load it with every plugin; and CapacitorHttp would
// reach any host on the internet past the CSP.
async function corePlugins() {
  for (const [plugin, method, options] of [
    ["WebView", "setServerBasePath", { path: "/data/local/tmp" }],
    ["WebView", "persistServerBasePath", {}],
    ["CapacitorHttp", "get", { url: "https://example.com" }],
    // every other request method is overridden with the same guard (DisabledCorePluginsTest checks the set,
    // not that each one calls the guard), so each is asked for a host that is not R2
    ...["request", "post", "put", "patch", "delete"].map((method) => ["CapacitorHttp", method, { url: "https://example.com", method: method.toUpperCase() }]),
  ]) {
    // As a page calls it: the plugin's proxy has no such method.
    const called = await page.evaluate(`(async () => { try { await Capacitor.Plugins[${JSON.stringify(plugin)}][${JSON.stringify(method)}](${JSON.stringify(options)}); return "answered"; } catch (e) { return String(e.message); } })()`);
    check(`${plugin}.${method}() from the page is refused`, called !== "answered", called);
    // Straight at the native bridge, past the proxy: Capacitor logs "No method found" and never answers.
    const raw = await within(native(plugin, method, options), 3000);
    check(`${plugin}.${method} sent straight to the bridge gets no answer`, raw === null || Boolean(raw.error), raw);
  }

  // Plant the persisted path the way an attacker's script would have (the plugin that writes it is gone, so
  // the file is written from outside), with a page of its own in files/evil, then start the app.
  const evil = `/data/user/0/${APP}/files/evil`;
  const prefs = `<?xml version="1.0" encoding="utf-8" standalone="yes" ?><map><string name="serverBasePath">${evil}</string></map>`;
  page.close();
  sh("shell", "am", "force-stop", APP);
  // base64 needs no quoting through adb's shell (see writeAppFile in scripts/lib/device.mjs)
  const b64 = (text) => Buffer.from(text).toString("base64");
  sh("shell", "run-as", APP, "sh", "-c", `'mkdir -p files/evil shared_prefs && echo ${b64('<html><body id="evil">EVIL</body></html>')} | base64 -d > files/evil/index.html && echo ${b64(prefs)} | base64 -d > shared_prefs/CapWebViewSettings.xml'`);
  await openPage(); // starts the app again
  let start;
  for (let i = 0; i < 40 && !start?.vault; i += 1) {
    if (i) await sleep(250);
    start = await page.evaluate(`({ href: location.href, vault: document.getElementById("root")?.childElementCount > 0, evil: Boolean(document.getElementById("evil")) })`);
  }
  check("a server path planted in the WebView plugin's preferences is not loaded: the bundled vault page opens", start?.vault === true && start.evil === false && start.href === "https://localhost/", start);
  const kept = sh("shell", "run-as", APP, "cat", "shared_prefs/CapWebViewSettings.xml");
  check("and the planted path is gone from the preferences", !kept.includes("evil"), kept);
  sh("shell", "run-as", APP, "rm", "-rf", "files/evil");
  await openShell();
}

// The phone's windows, one dump each, and the "Hiding System Alert Windows" list Android appends after
// the last one (the windows that asked to hide other apps' overlays: setHideOverlayWindows).
function windowList() {
  const [windows, hiding = ""] = sh("shell", "dumpsys", "window", "windows").split(/\n {2}Hiding System Alert Windows:/);
  return { windows: windows.split(/\n(?= {2}Window #)/), hiding };
}

async function secureWindow() {
  const { windows, hiding } = windowList();
  const ours = windows.find((w) => w.includes(`${APP}/${APP}.MainActivity`)) ?? "";
  check("FLAG_SECURE on the activity window", /\bSECURE\b/.test(ours));
  check("other apps' floating windows are hidden while the vault is up (tapjacking)", hiding.includes(`${APP}/${APP}.MainActivity`));
  await page.screenshot("page.png");
  saveScreen("screen-app.png");
  const appBlack = blackShare();
  key("KEYCODE_HOME");
  await sleep(3000); // the launcher animation must finish, or the capture still holds the app
  saveScreen("screen-home.png");
  const homeBlack = blackShare();
  check("adb screenshot of the app is black, of the home screen is not", appBlack > 0.99 && homeBlack < 0.5, { appBlack, homeBlack });
  key("KEYCODE_APP_SWITCH");
  await sleep(2500);
  saveScreen("recents.png");
  // Our card is centred in recents; its middle would show the page's rows and text.
  const cardFlat = flatShare([0.25, 0.2, 0.75, 0.65]);
  check("the recent-apps card is a blank fill, not the page", cardFlat > 0.98, { cardFlat });
  key("KEYCODE_HOME");
  await returnToApp();

  // Settings' "Hide from screen capture" off: the flag goes and screenshots see the app; on again: back.
  const ourWindow = () => windowList().windows.find((w) => w.includes(`${APP}/${APP}.MainActivity`)) ?? "";
  const off = await native("ScreenCapture", "setHidden", { hidden: false });
  await sleep(1000);
  saveScreen("screen-capture-off.png");
  check("hide from capture off: no FLAG_SECURE, a screenshot sees the app", !off?.error && !/\bSECURE\b/.test(ourWindow()) && blackShare() < 0.99, off?.error ?? { black: blackShare() });
  const on = await native("ScreenCapture", "setHidden", { hidden: true });
  await sleep(1000);
  saveScreen("screen-capture-on.png");
  check("hide from capture on again: FLAG_SECURE, the screenshot is black", !on?.error && /\bSECURE\b/.test(ourWindow()) && blackShare() > 0.99, on?.error ?? { black: blackShare() });
}

async function background() {
  const before = { background: await eventCount("background"), resume: await eventCount("resume") };
  key("KEYCODE_HOME");
  await sleep(1500);
  await returnToApp();
  const after = { background: await eventCount("background"), resume: await eventCount("resume") };
  check("background event on Home", after.background === before.background + 1, { before: before.background, after: after.background });
  check("resume event on coming back", after.resume === before.resume + 1, { before: before.resume, after: after.resume });
}

async function clipboard() {
  const copied = await native("SecureClipboard", "copy", { text: SECRET });
  const copiedAt = Date.now();
  check("copy resolves", !copied?.error, copied);
  const clip = clipText();
  // The windowed emulator's clipboard sharing echoes every copy back from Windows as a new, unflagged clip.
  const detail = clip.includes("host clipboard") ? "replaced by the emulator's Windows clipboard sharing - run it headless: npm run sim -- --no-window" : undefined;
  check("the clip is ours and marked sensitive", clip.includes(SECRET) && clip.includes("android.content.extra.IS_SENSITIVE"), detail);
  check("paste gives the secret back", (await pasteIntoPage()) === SECRET);

  // In front: the main-thread timer clears it on time (the job, 33-60 s, is only the fallback).
  while (clipText().includes(SECRET) && Date.now() - copiedAt < 90_000) await sleep(250);
  const inFront = Math.round((Date.now() - copiedAt) / 100) / 10;
  check("cleared 29-35 s after the copy while the app is in front", inFront >= 29 && inFront <= 35 && clipText() === "", { seconds: inFront });
  check("a paste in the app after that clear is empty", (await pasteIntoPage()) === "");

  // Backgrounded: the timer clears it while the process runs; once Android freezes the app, the
  // scheduled job does, 30 s at the earliest and batched, so up to about 30 s later. Timed on the
  // system clipboard, what other apps see.
  await native("SecureClipboard", "copy", { text: SECRET });
  const copiedAgainAt = Date.now();
  const pastedBefore = await pasteIntoPage(); // the WebView now holds its own copy of the secret
  key("KEYCODE_HOME");
  while (clipText().includes(SECRET) && Date.now() - copiedAgainAt < 90_000) await sleep(500);
  const clearedAfter = Math.round((Date.now() - copiedAgainAt) / 100) / 10;
  check("cleared in the background 29-75 s after the copy", clearedAfter >= 29 && clearedAfter <= 75 && clipText() === "", { seconds: clearedAfter });
  await returnToApp();
  // The WebView keeps its own copy of the clipboard and missed that clear (Android reports clipboard
  // changes only to the app in focus); back in focus, the plugin makes it hear of the empty clipboard.
  await sleep(1000);
  const staleAfter = await pasteIntoPage();
  check("a paste in the app after a clear it missed in the background is empty", pastedBefore === SECRET && staleAfter === "", {
    before: pastedBefore === SECRET ? "the secret" : pastedBefore,
    after: staleAfter === SECRET ? "the old secret" : staleAfter,
  });

  // clear() (the page calls it on lock) empties it now and drops the pending job.
  await native("SecureClipboard", "copy", { text: SECRET });
  const cleared = await native("SecureClipboard", "clear");
  check("clear() empties it at once", !cleared?.error && !clipText().includes(SECRET) && (await pasteIntoPage()) === "", cleared);

  // In focus, a newer clip that is not ours is left alone.
  await native("SecureClipboard", "copy", { text: SECRET });
  await sleep(1000);
  const replaced = await page.evaluate(`(() => { const t = document.getElementById("paste"); t.value = "copied later"; t.select(); return document.execCommand("copy"); })()`);
  await sleep(40_000); // past the 30 s timer, and past the job the timer cancels
  const kept = await pasteIntoPage();
  check("a newer clip (not ours) is kept after 30 s", replaced === true && kept === "copied later", { replaced, kept });
}

async function keystore() {
  await resetLock();
  sh("shell", "locksettings", "set-pin", PIN);
  check("isAvailable: no fingerprint yet", (await native("VaultKeystore", "isAvailable")).reason === "none-enrolled");
  await enrollFingerprint(1);
  await returnToApp();
  const status = await native("VaultKeystore", "isAvailable");
  check("isAvailable: strong biometric available", status.available === true, status);

  const vaultKey = crypto.randomBytes(32).toString("base64");
  const lifecycle = async () => `${await eventCount("background")} background, ${await eventCount("resume")} resume`;
  const before = await lifecycle();
  const enabling = native("VaultKeystore", "enable", { key: vaultKey });
  const prompt = await waitForText(/Turn on fingerprint unlock/);
  saveScreen("prompt-enable.png");
  touchFinger(1);
  const enabled = await enabling;
  check("enable: prompt shown, fingerprint accepted", Boolean(prompt) && !enabled?.error, enabled);
  check("isAvailable: enabled after enable", (await native("VaultKeystore", "isAvailable")).enabled === true);

  const unlocking = native("VaultKeystore", "unlock");
  await waitForText(/Unlock your vault/);
  touchFinger(1);
  const unlocked = await unlocking;
  check("unlock returns the same 32-byte key", unlocked?.key === vaultKey);
  const after = await lifecycle();
  check("the fingerprint prompts fire neither the background nor the resume event", after === before, { before, after });

  const wrong = native("VaultKeystore", "unlock");
  await waitForText(/Unlock your vault/);
  // The prompt says so for about 2 s and stays up. A touch every 5 s, at most 3 (Android locks
  // fingerprints out after 5 misses), so dumps that fail through that window do not miss it.
  let rejected = null;
  for (let i = 0; i < 3 && !rejected; i += 1) {
    touchFinger(UNKNOWN_FINGER);
    rejected = await waitForText(/Not recognized|Try again/i, 5000);
  }
  key("KEYCODE_BACK");
  const canceled = await wrong;
  check("an unknown finger is refused, Back cancels", Boolean(rejected) && canceled?.error?.code === "canceled", canceled);

  // A new fingerprint invalidates the Keystore key: fingerprint unlock is off until the master password.
  await enrollFingerprint(2);
  await returnToApp();
  const changed = await native("VaultKeystore", "unlock");
  check("a newly enrolled fingerprint makes unlock answer 'changed'", changed?.error?.code === "changed", changed);
  check("... and turns it off", (await native("VaultKeystore", "isAvailable")).enabled === false);

  const again = native("VaultKeystore", "enable", { key: vaultKey });
  await waitForText(/Turn on fingerprint unlock/);
  touchFinger(1);
  await again;
  await native("VaultKeystore", "disable");
  const off = await native("VaultKeystore", "unlock");
  check("disable: unlock then answers 'not-enabled'", off?.error?.code === "not-enabled", off);

  const logcat = sh("logcat", "-d");
  check("the key and the test secret never reach logcat", !logcat.includes(vaultKey) && !logcat.includes(SECRET));
}

async function scrypt() {
  const password = "correct horse battery staple orbit gazelle";
  const salt = crypto.randomBytes(16);
  const params = { N: 2 ** 17, r: 8, p: 1 };
  const expected = crypto.scryptSync(password, salt, 32, { ...params, maxmem: 256 << 20 }).toString("base64");

  const opener = fs.readFileSync(path.join(root, "..", "core", "scrypt.js"), "utf8").replace(/^export /m, "");
  await page.evaluate(`window.__opener = (() => { ${opener}; return { scrypt }; })(); true`);
  const js = await page.evaluate(`(async () => {
    const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const runs = [];
    let key;
    for (let i = 0; i < 3; i += 1) {
      const started = performance.now();
      key = await __opener.scrypt(new TextEncoder().encode(${JSON.stringify(password)}), bytes(${JSON.stringify(salt.toString("base64"))}), ${JSON.stringify(params)}, 32);
      runs.push(Math.round(performance.now() - started));
    }
    return { runs, key: btoa(String.fromCharCode(...key)) };
  })()`);
  check("scrypt N=2^17 in the WebView (Opener code) matches Node, under 3 s", js.key === expected && Math.max(...js.runs) < 3000, { ms: js.runs });
}

// The QR scan (QrScannerPlugin) on the emulator's virtual scene camera (npm run sim boots it with one):
// CAMERA asked at the scan with the reason on screen, denied and closed answers, the camera view inside
// the FLAG_SECURE window, leaving the app ends it, and it reads codes hung on the scene's wall - the PC's
// "Add a phone" code (fake keys) and a 2FA code.
async function camera() {
  const tapMatch = async (pattern) => {
    const node = await waitForText(pattern);
    if (!node) throw new Error(`${pattern} never showed on screen`);
    const [x1, y1, x2, y2] = node.bounds.match(/\d+/g).map(Number);
    sh("shell", "input", "tap", String((x1 + x2) >> 1), String((y1 + y2) >> 1));
  };
  const scan = (purpose) => native("QrScanner", "scan", { purpose });
  const lifecycle = async () => `${await eventCount("background")} background, ${await eventCount("resume")} resume`;
  await aimCamera("blank"); // nothing to read
  // Asked afresh: revoking a granted permission kills the app, so the page is opened again.
  const granted = /android\.permission\.CAMERA: granted=true/.test(sh("shell", "dumpsys", "package", APP));
  sh("shell", "pm", "revoke", APP, "android.permission.CAMERA");
  sh("shell", "pm", "clear-permission-flags", APP, "android.permission.CAMERA", "user-set", "user-fixed");
  if (granted) {
    page.close();
    await openPage();
    await openShell();
  }

  let before = await lifecycle();
  let scanning = scan("setup");
  const asked = await waitForText(/Allow KAPEVault to take pictures/);
  saveScreen("camera-permission.png"); // the system dialog is not FLAG_SECURE; the camera view under it is black
  await tapMatch(/^Don.t allow$/i);
  const denied = await scanning;
  check("CAMERA is asked for when the scan starts", Boolean(asked));
  check("denied camera answers 'denied'", denied?.error?.code === "denied", denied);
  const quiet = await lifecycle();
  check("the permission dialog fires neither the background nor the resume event", quiet === before, { before, after: quiet });

  // Typing in a field when the scan starts, as in the item form: the keyboard is up. Android puts it
  // back over the camera view after the permission dialog unless the view takes it down, and then the
  // first Back only closed the keyboard.
  const keyboardUp = () => /mInputShown=true/.test(sh("shell", "dumpsys", "input_method"));
  // A real tap (a focus() from DevTools brings no keyboard). The page fills the display edge to edge.
  const [tapX, tapY] = await page.evaluate(`(() => { const r = document.getElementById("paste").getBoundingClientRect(); return [(r.left + r.width / 2) * devicePixelRatio, (r.top + r.height / 2) * devicePixelRatio].map(Math.round); })()`);
  sh("shell", "input", "tap", String(tapX), String(tapY));
  await sleep(1500);
  const typing = keyboardUp();
  scanning = scan("setup");
  await tapMatch(/^While using the app$/i);
  const title = await waitForText(/^Scan the code on your PC$/);
  await sleep(1500);
  check("a scan started while typing takes the keyboard down", typing && !keyboardUp(), { keyboardBefore: typing, keyboardAfter: keyboardUp() });
  check("the camera view says why it uses the camera", Boolean(await waitForText(/KAPEVault uses the camera only to read this code/, 3000)));
  const ours = windowList().windows.filter((w) => w.includes(APP));
  const black = blackShare();
  saveScreen("camera-view.png");
  check("the camera view shows in the app's own FLAG_SECURE window: no other window, black to adb", Boolean(title) && ours.length === 1 && /\bSECURE\b/.test(ours[0]) && black > 0.99, { windows: ours.map((w) => w.match(/Window\{[^}]*\}/)?.[0]), black });
  key("KEYCODE_BACK");
  // Twice in full runs Back went unanswered here and the run hung; now it fails with evidence instead.
  const canceled = await within(scanning, 5000);
  if (!canceled) {
    const back = sh("logcat", "-d", "-s", "WindowOnBackDispatcher:*", "CoreBackPreview:*", "ImeTracker:*", "InputDispatcher:*", "OnBackPressedDispatcher:*");
    fs.writeFileSync(path.join(out, "back-failure.txt"), `${sh("shell", "dumpsys", "window", "windows")}\n\n--- back and IME log ---\n${back}\n`);
    key("KEYCODE_BACK");
    await within(scanning, 5000);
  }
  check("Back closes the camera: 'canceled'", canceled?.error?.code === "canceled", canceled ?? "no answer 5 s after Back - see back-failure.txt");

  before = await lifecycle();
  scanning = scan("totp");
  const totpTitle = await waitForText(/^Scan the site's 2FA code$/);
  key("KEYCODE_HOME");
  const left = await scanning;
  await sleep(1500);
  await returnToApp();
  const after = await lifecycle();
  check("leaving the app ends the scan ('canceled') and still fires background and resume", Boolean(totpTitle) && left?.error?.code === "canceled" && after !== before, { left, before, after });

  await aimCamera("setup");
  let started = Date.now();
  const setup = await within(scan("setup"), 20_000);
  check("reads the PC's Add a phone code off the camera", setup?.text === SETUP_CODE, { ms: Date.now() - started, error: setup?.error });
  await aimCamera("totp");
  started = Date.now();
  const totp = await within(scan("totp"), 20_000);
  check("reads a site's 2FA code off the camera", totp?.text === TOTP_CODE, { ms: Date.now() - started, error: totp?.error });

  await aimCamera("blank");
  const logcat = sh("logcat", "-d");
  check("the scanned R2 secret never reaches logcat", !logcat.includes(JSON.parse(SETUP_CODE).secretAccessKey));
}

// The window with input focus, from `dumpsys window` ("mCurrentFocus=Window{... com.x/com.x.Main}").
const focusedWindow = () => sh("shell", "dumpsys", "window").match(/mCurrentFocus=.*/)?.[0] ?? "";
async function waitForFocus(pattern, timeoutMs = 15_000) {
  for (const started = Date.now(); Date.now() - started < timeoutMs; await sleep(250)) if (pattern.test(focusedWindow())) return true;
  return false;
}

// The first run focuses its password field, and the keyboard rises a moment after the page loads (in some
// runs only). It shrinks the page, and the first Back only puts it down.
async function keyboardDown() {
  await page.evaluate(`document.activeElement?.blur()`);
  for (let i = 0; i < 20 && /mInputShown=true/.test(sh("shell", "dumpsys", "input_method")); i += 1) await sleep(250);
}

// The activity on top, which is not always the window with focus: the sign-in screen's own suggestion
// list ("Autofill UI") takes the focus when its field gets it back.
async function waitForTop(pattern, timeoutMs = 15_000) {
  for (const started = Date.now(); Date.now() - started < timeoutMs; await sleep(250)) if (pattern.test(sh("shell", "dumpsys", "activity", "activities").match(/topResumedActivity=.*/)?.[0] ?? "")) return true;
  return false;
}

// Back: MainActivity's callback closes the page's open layer (one pushState in use-back-layer.ts; this
// pushes one the same way), and at the list moves the app to the background. Left to Android, Back on
// the first screen FINISHED the activity on Android 17, so the page and its unlocked vault were gone.
async function back() {
  const main = new RegExp(`${APP}/${APP}\\.MainActivity`);
  const activityLives = () => sh("shell", "dumpsys", "activity", "activities").includes(`${APP}/.MainActivity`);
  await openPage(); // a fresh start on the vault page: no history
  await keyboardDown();
  await page.evaluate(`history.pushState({ kapevaultLayer: true }, ""); true`);
  await sleep(1000);
  key("KEYCODE_BACK");
  await sleep(1500);
  const afterBack = { inFront: main.test(focusedWindow()), layerEntry: await page.evaluate("history.state?.kapevaultLayer === true") };
  check("Back with a layer open closes it and stays in the app", afterBack.inFront && !afterBack.layerEntry, afterBack);
  key("KEYCODE_BACK");
  await sleep(2000);
  const left = !main.test(focusedWindow());
  const alive = activityLives() && (await within(page.evaluate("1 + 1"), 3000)) === 2; // a finished activity takes its WebView with it
  check("Back at the list leaves the app to the background, not finished (the page lives on)", left && alive, { focus: focusedWindow(), alive });
  await openPage();
  await openShell();
}

// Autofill: the service is declared and can be the phone's autofill service; a sign-in screen in
// another task (the debug-only LoginTestActivity) gets "Fill from KAPEVault", a locked suggestion whose
// authentication (AutofillAuthActivity, FLAG_SECURE) brings up the vault with the request waiting; the
// page's pick fills the screen, and Cancel or going back to the screen fills nothing. The vault page's
// picker itself is driven by hand here (Autofill.fill from the shell page), not through its UI.
async function autofill() {
  const TEST = `${APP}/.LoginTestActivity`;
  const auth = new RegExp(`${APP}/${APP}\\.AutofillAuthActivity`);
  const main = new RegExp(`${APP}/${APP}\\.MainActivity`);

  const manifest = execFileSync(path.join(sdk, "build-tools", "36.1.0", process.platform === "win32" ? "aapt2.exe" : "aapt2"), ["dump", "xmltree", "--file", "AndroidManifest.xml", PLAY_DEBUG_APK], { encoding: "utf8" });
  // An element with everything nested in it: from its name to the next component.
  const component = (name) => {
    const at = manifest.indexOf(`.${name}"`);
    return at < 0 ? "" : manifest.slice(at).split(/\n\s+E: (?:activity|service|receiver|provider)\b/)[0];
  };
  const service = component("KapeAutofillService");
  check("the autofill service is declared: bound only by the system, with its settings", /BIND_AUTOFILL_SERVICE/.test(service) && /android\.service\.autofill\.AutofillService/.test(service) && /android\.autofill/.test(service), service ? undefined : "not found");
  check("the fill screen (AutofillAuthActivity) is not exported", /exported\(0x[0-9a-f]+\)=false/.test(component("AutofillAuthActivity")));

  const before = sh("shell", "settings", "get", "secure", "autofill_service");
  try {
    sh("shell", "settings", "put", "secure", "autofill_service", SERVICE);
    await sleep(1000);
    const status = await native("Autofill", "status");
    check("KAPEVault can be the autofill service, and the page sees it on", status?.supported === true && status?.enabled === true && /KapeAutofillService/.test(sh("shell", "dumpsys", "autofill")), status);

    // Never into KAPEVault itself: a field in the vault's own page gets no suggestion.
    const [tapX, tapY] = await page.evaluate(`(() => { const r = document.getElementById("paste").getBoundingClientRect(); return [(r.left + r.width / 2) * devicePixelRatio, (r.top + r.height / 2) * devicePixelRatio].map(Math.round); })()`);
    sh("shell", "input", "tap", String(tapX), String(tapY));
    await sleep(3000);
    check("no suggestion inside KAPEVault itself", !(await suggestionOnScreen(0)));

    const scale = Number(sh("shell", "wm", "density").match(/(\d+)\s*$/)?.[1] ?? 160) / 160;
    // Opens the test screen fresh in its own task, taps the username field, then the suggestion.
    const offerFill = async () => {
      sh("shell", "am", "start", "-n", TEST, "-f", String(0x10008000)); // NEW_TASK | CLEAR_TASK
      await waitForText(/^Test login$/);
      const field = await waitForText(/^Test username$/);
      const [x1, y1, x2, y2] = field.bounds.match(/\d+/g).map(Number);
      sh("shell", "input", "tap", String((x1 + x2) >> 1), String((y1 + y2) >> 1));
      const shown = await suggestionOnScreen(8000);
      // The suggestion list is a system window uiautomator may not dump; it sits right under the field.
      const [sx, sy] = shown ? shown : [(x1 + x2) >> 1, y2 + Math.round(24 * scale)];
      sh("shell", "input", "tap", String(sx), String(sy));
      return { shown: Boolean(shown), vault: await waitForFocus(main) };
    };
    // What landed on the test screen ("filled: <username> / <password length>"), "" when nothing did.
    const result = async (pattern = /^filled: /, timeoutMs = 3000) => (await waitForText(pattern, timeoutMs))?.text ?? "";

    const offered = await offerFill();
    saveScreen("autofill-vault.png");
    const { windows, hiding } = windowList();
    const authWindow = windows.find((w) => auth.test(w)) ?? "";
    check("the sign-in screen offers Fill from KAPEVault (locked: it opens the vault)", offered.vault && /AutofillAuthActivity/.test(sh("shell", "dumpsys", "activity", "activities")), { suggestionInDump: offered.shown, vault: offered.vault });
    check("the fill screen is FLAG_SECURE, and so is the vault over it", /\bSECURE\b/.test(authWindow) && /\bSECURE\b/.test(windows.find((w) => main.test(w)) ?? ""), authWindow ? undefined : "no AutofillAuthActivity window");
    check("other apps' floating windows are hidden over the vault while it picks", main.test(hiding), hiding.match(/Window\{[^}]*\}/g));
    const pending = await native("Autofill", "pending");
    check("the vault page sees the waiting request: the screen's app, a username and a password field", pending?.target?.packageName === APP && pending.target.username === true && pending.target.password === true, pending);
    check("an app that is not a signed browser is a plain app: no trusted domain", pending?.target?.browser === false && !pending.target.webDomain && !pending.target.webScheme, pending);
    // A pick names the request it was made for: one for any other request (a newer one came in between
    // the picker showing and the tap) fills nothing, and the request waits on.
    const stale = await native("Autofill", "fill", { id: "an-older-request", username: "proof-user", password: SECRET });
    const still = await native("Autofill", "pending");
    check("a pick for another request is refused and the request still waits", Boolean(pending?.target?.id) && Boolean(stale?.error) && still?.target?.id === pending.target.id && (await result(/^filled: /, 1000)) === "", { stale, still });
    const filled = await native("Autofill", "fill", { id: pending?.target?.id, username: "proof-user", password: SECRET });
    const backToScreen = await waitForTop(/LoginTestActivity/);
    const expected = `filled: proof-user / ${SECRET.length}`;
    const text = await result(new RegExp(`^${expected}$`), 8000);
    check("a pick fills the other app's screen and the vault goes to the background", !filled?.error && backToScreen && text === expected, { filled, backToScreen, text: text || (await result()) });

    const again = await offerFill();
    const waiting = await native("Autofill", "pending");
    const canceled = await native("Autofill", "cancel");
    const backAfterCancel = await waitForTop(/LoginTestActivity/);
    check("Cancel fills nothing and goes back to the screen", again.vault && Boolean(waiting?.target) && !canceled?.error && backAfterCancel && (await result()) === "" && !auth.test(sh("shell", "dumpsys", "activity", "activities")), { again, waiting: Boolean(waiting?.target), canceled, backAfterCancel });

    // Going back to the screen's task without a pick (the app switcher) ends the request.
    await offerFill();
    sh("shell", "am", "start", "-n", TEST); // the same root intent: the task comes to the front as it is
    const backWithoutPick = await waitForTop(/LoginTestActivity/);
    await sleep(1500);
    const nothing = (await result()) === "" && !auth.test(sh("shell", "dumpsys", "activity", "activities"));
    await returnToApp();
    const leftover = await native("Autofill", "pending");
    check("going back to the screen without a pick fills nothing and ends the request", backWithoutPick && nothing && leftover && !leftover.error && !leftover.target, leftover);

    check("the filled password never reaches logcat", !sh("logcat", "-d").includes(SECRET));
  } finally {
    if (before === "null" || !before) sh("shell", "settings", "delete", "secure", "autofill_service");
    else sh("shell", "settings", "put", "secure", "autofill_service", before);
    await returnToApp();
  }
}

// The "Fill from KAPEVault" suggestion's centre, if uiautomator shows it (all windows where it can).
async function suggestionOnScreen(timeoutMs) {
  const started = Date.now();
  do {
    let nodes = uiNodes("--windows");
    if (!nodes.length) nodes = uiNodes(); // an older uiautomator without --windows
    const node = nodes.find((n) => n.text === "Fill from KAPEVault");
    if (node) {
      const [x1, y1, x2, y2] = node.bounds.match(/\d+/g).map(Number);
      return [(x1 + x2) >> 1, (y1 + y2) >> 1];
    }
    if (Date.now() - started >= timeoutMs) return null;
    await sleep(500);
  } while (true);
}

// KAPEVault Pro (BillingPlugin). A vault used as a free user uses it - made, locked, unlocked, sent to
// the background, Settings and the Sync sheet opened - never runs Google Play Billing: no BillingClient
// line in logcat, no binding to the Play Store. One real status() then shows both, so their absence
// above means something. Then the plugin's answers through the debug build's fake Play store
// (files/billing-fake).
async function billing() {
  const MASTER = "Copper-Violet-Harbor-83 orbit gazelle";
  const playLog = () => sh("logcat", "-d").split("\n").filter((line) => /BillingClient/.test(line));
  const playBound = () => sh("shell", "dumpsys", "activity", "services", "com.android.vending").includes(APP);
  // A React input by its label, set the way typing sets it.
  const fill = (name, value) =>
    page.evaluate(`(() => {
      const input = [...document.querySelectorAll("input")].find((i) => i.placeholder === ${JSON.stringify(name)} || i.getAttribute("aria-label") === ${JSON.stringify(name)} || i.closest("label")?.querySelector("span")?.textContent === ${JSON.stringify(name)});
      if (!input) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);

  page?.close();
  device.clearAppFiles();
  // The keystore section leaves a PIN and fingerprints on the phone, and a first run then offers to turn
  // fingerprint unlock on (a step this free user's flow does not take). Removing the PIN removes them.
  await resetLock();
  sh("logcat", "-c");
  await openPage(); // a cold start, on the vault's first run
  let text = await page.text(/Choose a master password/);
  await fill("Master password", MASTER);
  await fill("Confirm master password", MASTER);
  await page.click("Continue");
  const created = /All items/.test(await page.text(/All items/, 30_000));
  await page.click("Show sidebar");
  await sleep(600);
  await page.clickStarting("Lock");
  const locked = /Enter your master password/.test(await page.text(/Enter your master password/));
  await fill("Master password", MASTER);
  await page.evaluate(`document.querySelector("form")?.requestSubmit()`);
  const unlocked = /All items/.test(await page.text(/All items/, 30_000));
  key("KEYCODE_HOME");
  await sleep(1500);
  await returnToApp();
  text = await page.text(/All items/);
  const resumed = /All items/.test(text);
  // Settings down to its Backup and sync rows (the KAPEVault Pro row is not tapped), then the sync
  // line's sheet: both show Pro's state, and a free user's must not ask Play for it.
  const tab = (id) => page.evaluate(`document.querySelector('[data-tab="${id}"]')?.click()`);
  await tab("settings");
  const settings = /Backup and sync/.test(await page.text(/Backup and sync/));
  await page.evaluate(`[...document.querySelectorAll("p")].find((p) => p.textContent === "Backup and sync")?.scrollIntoView({ block: "start" })`);
  await sleep(1000);
  await tab("items");
  await page.text(/All items/);
  await page.clickStarting("No backup yet");
  const syncSheet = /Backup is off/.test(await page.text(/Backup is off/));
  await sleep(1000);
  await page.click("Done");
  await sleep(600);
  const freeUse = { created, locked, unlocked, resumed, settings, syncSheet };
  check("a free user's vault (made, locked, unlocked, background and back, Settings' Backup and sync rows, the sync line's sheet) ran", Object.values(freeUse).every(Boolean), freeUse);
  const quiet = { logLines: playLog(), bound: playBound() };
  check("... and never ran Google Play Billing: no BillingClient line in logcat, no binding to the Play Store", quiet.logLines.length === 0 && !quiet.bound, quiet);
  const real = await within(native("Billing", "status"), 20_000);
  await sleep(2000);
  const loud = { answer: real, logLines: playLog().length, bound: playBound() };
  check("one real status() does show in both (so the check above can see it)", loud.logLines > 0 && loud.bound, loud);

  // The plugin's contract, through the fake Play store.
  const fake = async (mode, method) => {
    device.writeAppFile("billing-fake", mode);
    return native("Billing", method);
  };
  const approved = await fake("approve", "buy");
  check("fake approve: buy() answers owned, and Play now lists it owned", approved?.owned === true && approved.pending === false && device.appFile("billing-fake").trim() === "owned", approved);
  const owned = await native("Billing", "status");
  check("fake owned: status() answers owned, with a price", owned?.owned === true && owned.pending === false && Boolean(owned.price), owned);
  const pending = await fake("pending", "buy");
  check("fake pending: buy() answers pending, not owned", pending?.pending === true && pending.owned === false, pending);
  const refused = await fake("refuse", "buy");
  check("fake refuse: buy() rejects canceled", refused?.error?.code === "canceled", refused);
  const unavailable = await fake("unavailable", "buy");
  check("fake unavailable: buy() rejects unavailable", unavailable?.error?.code === "unavailable", unavailable);
  const garbled = { buy: await fake("garbled", "buy"), status: await native("Billing", "status") };
  check("an unknown fake mode: buy() and status() reject failed, nothing is owned", garbled.buy?.error?.code === "failed" && garbled.status?.error?.code === "failed", garbled);

  page.close();
  device.clearAppFiles();
  await openPage();
  await openShell();
}

// A release build (signed with the debug key only so it installs) must not open a DevTools socket.
// Its web assets come from a plain `vite build`: the vault alone, no shell check page, no mock host.
async function releaseHasNoDevTools() {
  const node = (...args) => spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" }).status === 0;
  const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
  const capacitor = path.join(root, "node_modules", "@capacitor", "cli", "bin", "capacitor");
  if (!node(vite, "build", "--logLevel", "warn") || !node(capacitor, "copy", "android")) return check("release web build", false);
  const dist = path.join(root, "dist");
  const files = fs.readdirSync(dist, { recursive: true }).map(String);
  const text = files.filter((f) => /\.(html|js|css)$/.test(f)).map((f) => fs.readFileSync(path.join(dist, f), "utf8")).join("\n");
  // Markers: the shell page's own words and the mock host's sample data.
  const leaks = ["Native shell check", "kapevault-test-secret", "Northwind Dental", "mock-secret-access-key"].filter((m) => text.includes(m));
  check("release web build: the vault page only, no shell page, no mock host", files.includes("index.html") && !files.some((f) => /shell/.test(f)) && leaks.length === 0, { html: files.filter((f) => f.endsWith(".html")), leaks });
  // Built unsigned (KAPEVAULT_SIGNING=none) and signed below with the debug key, so it installs over the
  // debug build; the real release key would need an uninstall. `npm run apk:release` builds the real one.
  const gradle = spawnSync(process.execPath, [path.join(root, "scripts", "gradle.mjs"), "assemblePlayRelease", "--quiet"], { cwd: root, env: { ...env, KAPEVAULT_SIGNING: "none" }, stdio: "inherit" }).status === 0;
  // Debug web assets back in the Android project, so the next debug build keeps its shell page.
  node(vite, "build", "--mode", "debug", "--logLevel", "warn");
  node(capacitor, "copy", "android");
  if (!gradle) return check("release build", false);
  const unsigned = path.join(root, "android", "app", "build", "outputs", "apk", "play", "release", "app-play-release-unsigned.apk");
  const apk = fs.readFileSync(unsigned).toString("latin1"); // zip entry names are stored as plain text
  check("release APK: holds the vault page and no shell page", apk.includes("assets/public/index.html") && !apk.includes("assets/public/shell.html"));
  const releaseManifest = execFileSync(path.join(sdk, "build-tools", "36.1.0", process.platform === "win32" ? "aapt2.exe" : "aapt2"), ["dump", "xmltree", "--file", "AndroidManifest.xml", unsigned], { encoding: "utf8" });
  check("release APK: no test sign-in screen (the autofill proof's LoginTestActivity is debug only)", /KapeAutofillService/.test(releaseManifest) && !/LoginTestActivity/.test(releaseManifest));
  const signed = path.join(out, "app-release-debugsigned.apk");
  const apksigner = path.join(sdk, "build-tools", "36.1.0", "lib", "apksigner.jar");
  const debugKeystore = path.join(os.homedir(), ".android", "debug.keystore");
  execFileSync(jdk ? path.join(jdk, "bin", "java") : "java", ["-jar", apksigner, "sign", "--ks", debugKeystore, "--ks-pass", "pass:android", "--out", signed, unsigned], { env });
  sh("install", "-r", signed);
  sh("shell", "am", "force-stop", APP);
  sh("shell", "am", "start", "-n", `${APP}/.MainActivity`);
  await sleep(8000);
  const pid = pidOf();
  const socket = sh("shell", "cat", "/proc/net/unix").includes(`webview_devtools_remote_${pid}`);
  const flags = sh("shell", "dumpsys", "package", APP).match(/pkgFlags=\[([^\]]*)\]/)?.[1] ?? "";
  // Not debuggable also means BillingPlugin never reads the fake Play store (files/billing-fake), and
  // run-as cannot plant one.
  check("release build: no WebView DevTools socket, not debuggable (so no fake Play store)", Boolean(pid) && !socket && !flags.includes("DEBUGGABLE"), { pid, socket, flags: flags.trim() });
  sh("install", "-r", PLAY_DEBUG_APK);
}

// `npm run proof -- clipboard keystore` runs only those sections.
const SERVICE = `${APP}/.KapeAutofillService`;
const sections = { firstLaunch, relaunch, hardening, corePlugins, secureWindow, background, clipboard, keystore, scrypt, camera, back, autofill, billing };
const picked = process.argv.slice(2).filter((name) => name in sections);
try {
  sh("logcat", "-c");
  // A run cut off in the autofill section leaves KAPEVault as the phone's autofill service (and saved as
  // the one to put back), and its suggestion then covers the Settings PIN screen. Start without it.
  if (sh("shell", "settings", "get", "secure", "autofill_service") === SERVICE) sh("shell", "settings", "delete", "secure", "autofill_service");
  await resetLock();
  await openPage();
  await openShell();
  for (const name of picked.length ? picked : Object.keys(sections)) await sections[name]();
  if (process.argv.includes("--release")) await releaseHasNoDevTools();
} catch (err) {
  check("proof run", false, err.message);
  saveScreen("failure.png"); // system screens (Settings, the prompt) are not FLAG_SECURE
} finally {
  page?.close(); // an open DevTools socket would keep the run alive
  await resetLock().catch(() => {});
  fs.writeFileSync(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const failed = Object.entries(report).filter(([, r]) => r.ok === false);
  console.log(`\n${failed.length ? `${failed.length} failed` : "all passed"} - proof in ${out}`);
  process.exitCode = failed.length ? 1 : 0;
}
