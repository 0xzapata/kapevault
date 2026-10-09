// The KAPEVault emulator over adb, for the checks that drive it: scripts/proof.mjs and
// src/app/host/test/device-proof.mjs and two-device.mjs. Its shell, the screen's UI tree, fingerprint
// enrollment, the app's private files, and the app's page over the WebView's DevTools (debug builds).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { adb, env } from "../android-env.mjs";

export const APP = "com.brewedops.kapevault";
export const PIN = "1111"; // the emulator's device PIN while a check has fingerprints enrolled

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lines = (text) => text.split(/[\r\n]+/);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A DevTools answer, or after `ms` a "no answer" result in its place. The timer is cleared once the
// answer comes, so a script ends with its last check instead of waiting out the deadline.
export function answerWithin(asked, ms) {
  let timer;
  const late = new Promise((resolve) => (timer = setTimeout(resolve, ms, { exceptionDetails: { exception: { value: `no answer from the page in ${ms / 1000} s` } } })));
  return Promise.race([asked, late]).finally(() => clearTimeout(timer));
}

// The running KAPEVault emulator (the AVD `npm run sim` makes), or exit with what to do. `who` names
// the check in that message.
export function kapevaultDevice(who) {
  const serial = lines(execFileSync(adb, ["devices"], { env, encoding: "utf8" }))
    .map((line) => line.split("\t"))
    .find(([s, state]) => s.startsWith("emulator-") && state === "device" && lines(execFileSync(adb, ["-s", s, "emu", "avd", "name"], { env, encoding: "utf8" }))[0] === "KAPEVault")?.[0];
  if (!serial) {
    console.error(`${who}: no KAPEVault emulator running - start it with \`npm run sim -- --no-window\`.`);
    process.exit(1);
  }

  const sh = (...args) => execFileSync(adb, ["-s", serial, ...args], { env, encoding: "utf8", maxBuffer: 64 << 20 }).trim();
  const shBytes = (...args) => execFileSync(adb, ["-s", serial, ...args], { env, maxBuffer: 64 << 20 });
  // The app's pid, or "" while it is not running yet. `pidof` exits non-zero when there is no such
  // process, and a cold emulator can take 1.5 s after `am start` to create it - polling with sh()
  // would throw on the first empty look instead of trying again.
  const pidOf = () => {
    try {
      return sh("shell", "pidof", APP);
    } catch {
      return "";
    }
  };
  const key = (code) => sh("shell", "input", "keyevent", code);
  const touchFinger = (id) => sh("emu", "finger", "touch", String(id));

  // The app's private files (run-as works on debug builds only).
  const appFiles = () => sh("shell", "run-as", APP, "ls", "files").split(/\s+/).filter(Boolean);
  const appFile = (name) => execFileSync(adb, ["-s", serial, "exec-out", "run-as", APP, "cat", `files/${name}`], { env, maxBuffer: 256 << 20 }).toString("utf8");
  const clearAppFiles = () => sh("shell", "run-as", APP, "sh", "-c", "'rm -f files/*.kapevault files/*.json files/*.next files/*.tmp files/backup-pending files/billing-fake'");
  // As base64, which needs no quoting on the way through adb's shell (exec-in drops stdin here).
  const writeAppFile = (name, text) => sh("shell", "run-as", APP, "sh", "-c", `'echo ${Buffer.from(text).toString("base64")} | base64 -d > files/${name}'`);
  // KAPEVault Pro as a purchase leaves it (host/pro.ts): pro.json, and the debug build's fake Play store
  // (BillingPlugin.kt) saying it is owned. The host reads them when the app starts.
  const ownPro = () => {
    writeAppFile("pro.json", JSON.stringify({ owned: true, pending: false }));
    writeAppFile("billing-fake", "owned");
  };

  // The clip as the system holds it, over the clipboard binder (IClipboard.getPrimaryClip is call 4 on
  // this Android image; the shell may read it in the background). Parcel words to text, NULs dropped.
  function clipText() {
    const parcel = sh("shell", "service", "call", "clipboard", "4", "s16", "com.android.shell", "s16", "null", "i32", "0", "i32", "0");
    // Lines read `0x00000010: 74736f68 696c6320 ... 'text'`; the quoted text column is skipped.
    const words = parcel.split("\n").flatMap((line) => line.split("'")[0].split(":")[1]?.match(/[0-9a-f]{8}/g) ?? []);
    const bytes = Buffer.alloc(words.length * 4);
    words.forEach((word, i) => bytes.writeUInt32LE(parseInt(word, 16), i * 4));
    return bytes.toString("latin1").replaceAll("\0", "");
  }

  // A known start and end: no PIN (removing it removes every fingerprint too), the screen awake and
  // unlocked. A PIN left behind would put a cold-booted emulator behind the lock screen.
  async function resetLock() {
    try {
      sh("shell", "locksettings", "clear", "--old", PIN);
    } catch {
      // no PIN set
    }
    key("KEYCODE_WAKEUP");
    for (let i = 0; i < 5 && /isKeyguardShowing=true/.test(sh("shell", "dumpsys", "window")); i += 1) {
      key("KEYCODE_BACK"); // a bouncer that is already up
      sh("shell", "wm", "dismiss-keyguard");
      await sleep(1000);
    }
  }

  // The screen's nodes, or none when the dump fails ("null root node" while a system prompt animates):
  // the last dump's file is removed first, so a failed one is never read back as the current screen.
  // `flags` go to `uiautomator dump` (--windows: every window, where the uiautomator has it).
  function uiNodes(...flags) {
    sh("shell", "rm", "-f", "/sdcard/kapevault-ui.xml");
    let xml;
    try {
      sh("shell", "uiautomator", "dump", ...flags, "/sdcard/kapevault-ui.xml");
      xml = sh("shell", "cat", "/sdcard/kapevault-ui.xml");
    } catch {
      return [];
    }
    return [...xml.matchAll(/<node [^>]*>/g)].map(([node]) => {
      const attr = (name) => node.match(new RegExp(` ${name}="([^"]*)"`))?.[1] ?? "";
      return { text: attr("text"), desc: attr("content-desc"), pkg: attr("package"), bounds: attr("bounds") };
    });
  }
  async function waitForText(pattern, timeoutMs = 20_000) {
    for (const started = Date.now(); Date.now() - started < timeoutMs; await sleep(500)) {
      const node = uiNodes().find((n) => pattern.test(n.text) || pattern.test(n.desc));
      if (node) return node;
    }
    return null;
  }
  // Taps the node whose text (or description) is `text`, any case.
  async function tapText(text, timeoutMs = 20_000) {
    const node = await waitForText(new RegExp(`^${escape(text)}$`, "i"), timeoutMs);
    if (!node) throw new Error(`"${text}" never showed on screen`);
    const [x1, y1, x2, y2] = node.bounds.match(/\d+/g).map(Number);
    sh("shell", "input", "tap", String((x1 + x2) >> 1), String((y1 + y2) >> 1));
  }

  // Settings > Pixel Imprint on the emulator: PIN, the intro (only shown for some enrollments), then
  // touches on the virtual sensor.
  async function enrollFingerprint(finger) {
    // -S: a fresh Settings, or a task left from the last enrollment is just brought to the front.
    sh("shell", "am", "start", "-S", "-a", "android.settings.FINGERPRINT_ENROLL");
    // A PIN typed before the screen is up goes nowhere and the enrollment stalls. The screen is found by its
    // window, not its text: uiautomator cannot always read it (a secure window, or a popup over it).
    const pinUp = () => /ConfirmLock/.test(sh("shell", "dumpsys", "window").match(/mCurrentFocus=.*/)?.[0] ?? "");
    let up = false;
    for (const started = Date.now(); !up && Date.now() - started < 60_000; await sleep(500)) up = pinUp();
    if (!up) throw new Error("the device PIN screen never showed");
    sh("shell", "input", "text", PIN);
    key("KEYCODE_ENTER");
    for (let i = 0; i < 20 && !(await waitForText(/Touch the sensor/, 1000)); i += 1) {
      const intro = uiNodes().find((n) => /^(MORE|I AGREE)$/i.test(n.text));
      if (intro) await tapText(intro.text);
    }
    for (let i = 0; i < 20 && !(await waitForText(/Fingerprint added/, 1000)); i += 1) touchFinger(finger);
    await tapText("DONE");
  }

  // The app's page over the WebView's DevTools, forwarded to `port`. restart: force-stop and start the
  // app first. answerMs: a page that never answers (it was once sent to the background mid-unlock) fails
  // an evaluate after that long instead of hanging; 0 waits for ever. Screenshots go to `out`.
  async function openPage({ port, out, restart = true, answerMs = 60_000 }) {
    if (restart) {
      sh("shell", "am", "force-stop", APP);
      sh("shell", "am", "start", "-n", `${APP}/.MainActivity`);
    }
    let socket = "";
    for (let i = 0; i < 60 && !socket; i += 1) {
      await sleep(1000);
      const pid = pidOf();
      if (pid && sh("shell", "cat", "/proc/net/unix").includes(`webview_devtools_remote_${pid}`)) socket = `webview_devtools_remote_${pid}`;
    }
    if (!socket) throw new Error("the WebView DevTools socket never opened (is this a debug build?)");
    sh("forward", `tcp:${port}`, `localabstract:${socket}`);
    let target;
    for (let i = 0; i < 30 && !target; i += 1) {
      await sleep(1000);
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page" && t.url.startsWith("https://localhost"));
    }
    if (!target) throw new Error("the app page never showed up in DevTools");
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
    const pending = new Map();
    let nextId = 1;
    // A page that goes away (the app killed or reloaded) fails the waiting steps instead of hanging.
    ws.onclose = () => {
      for (const settle of pending.values()) settle({ result: { exceptionDetails: { exception: { value: "DevTools connection closed" } } } });
      pending.clear();
    };
    const events = [];
    ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.method) events.push(message);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    };
    const send = (method, params) => {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve) => pending.set(id, ({ result }) => resolve(result)));
    };
    const page = {
      // Resolves with the value, or with { error } when the page's promise rejects.
      async evaluate(expression) {
        const asked = send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
        const result = await (answerMs ? answerWithin(asked, answerMs) : asked);
        if (result.exceptionDetails) return { error: result.exceptionDetails.exception?.value ?? result.exceptionDetails.exception?.description };
        return result.result.value;
      },
      // The WebView's own render: adb screenshots are black under FLAG_SECURE, DevTools (debug only) is not.
      async screenshot(name) {
        const { data } = await send("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(path.join(out, name), Buffer.from(data, "base64"));
      },
      send,
      // What went wrong in the page since it loaded: DevTools replays the page's log (failed loads) and
      // its uncaught errors and console errors when those domains are switched on.
      async problems() {
        await send("Log.enable");
        await send("Runtime.enable");
        await sleep(1000);
        return events.flatMap(({ method, params }) => {
          if (method === "Log.entryAdded" && params.entry.level === "error") return [`${params.entry.text} ${params.entry.url ?? ""}`.trim()];
          if (method === "Runtime.exceptionThrown") return [params.exceptionDetails.exception?.description ?? params.exceptionDetails.text];
          if (method === "Runtime.consoleAPICalled" && params.type === "error") return [params.args.map((a) => a.value ?? a.description).join(" ")];
          return [];
        });
      },
      // Another page of the app, same WebView: "/" is the vault, "/shell.html" the shell check (debug builds).
      async goto(pathname) {
        await send("Page.navigate", { url: `https://localhost${pathname}` });
        await page.loaded(pathname);
      },
      async loaded(pathname) {
        for (let i = 0; i < 60; i += 1) {
          await sleep(250);
          if ((await page.evaluate("location.pathname + ' ' + document.readyState")) === `${pathname} complete`) return;
        }
        throw new Error(`${pathname} never loaded`);
      },
      // Waits for text on the page; returns the page's text either way.
      async text(pattern, timeoutMs = 15_000) {
        let text = "";
        for (const started = Date.now(); Date.now() - started < timeoutMs && !pattern.test(text); await sleep(500)) text = String(await page.evaluate("document.body?.innerText ?? ''"));
        return text;
      },
      click: (label) => page.evaluate(`(() => { const b = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute("aria-label") === ${JSON.stringify(label)}); b?.click(); return Boolean(b); })()`),
      // A button by how its text starts (the sync line's text ends in a time).
      clickStarting: (start) => page.evaluate(`(() => { const b = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(${JSON.stringify(start)})); b?.click(); return Boolean(b); })()`),
      close: () => ws.close(),
    };
    await page.evaluate("new Promise((r) => document.readyState === 'complete' ? r() : addEventListener('load', r))");
    return page;
  }

  return { serial, sh, shBytes, pidOf, key, touchFinger, appFiles, appFile, clearAppFiles, writeAppFile, ownPro, clipText, resetLock, uiNodes, waitForText, tapText, enrollFingerprint, openPage };
}
