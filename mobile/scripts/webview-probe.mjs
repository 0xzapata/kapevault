// What the app page is doing, over the debug WebView's DevTools socket: url, visible text, errors
// (uncaught, console, failed loads) and a screenshot (FLAG_SECURE blacks adb screenshots, not this).
//   node scripts/webview-probe.mjs            - probe the page as it is
//   node scripts/webview-probe.mjs --reload   - reload it first and catch the load's errors
// Debug builds only (release builds open no DevTools socket). Output: proof/webview.png
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adb, env } from "./android-env.mjs";

const APP = "com.brewedops.kapevault";
const PORT = 9333;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "proof");
const sh = (...args) => execFileSync(adb, args, { env, encoding: "utf8" }).trim();

const pid = sh("shell", "pidof", APP);
if (!pid) throw new Error("KAPEVault is not running on the emulator");
sh("forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
if (!target) throw new Error("no app page in DevTools (is this a debug build?)");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.id) return pending.get(m.id)?.(m), pending.delete(m.id);
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Log.entryAdded") errors.push(`${m.params.entry.level}: ${m.params.entry.text} ${m.params.entry.url ?? ""}`.trim());
};
const send = (method, params = {}) => new Promise((resolve) => (pending.set(++id, resolve), ws.send(JSON.stringify({ id, method, params }))));
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;

await send("Runtime.enable");
await send("Log.enable");
if (process.argv.includes("--reload")) {
  await send("Page.reload", { ignoreCache: true });
  await new Promise((r) => setTimeout(r, 6000));
}
console.log("url:", await evaluate("location.href"));
console.log("text:", JSON.stringify(((await evaluate("document.body?.innerText")) ?? "").slice(0, 400)));
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.mkdirSync(out, { recursive: true });
if (shot.result?.data) fs.writeFileSync(path.join(out, "webview.png"), Buffer.from(shot.result.data, "base64"));
console.log("errors:", errors.length ? errors : "none");
console.log(`screenshot: ${path.join(out, "webview.png")}`);
ws.close();
sh("forward", "--remove", `tcp:${PORT}`);
