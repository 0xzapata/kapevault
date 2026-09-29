// node src/app/host/test/device-proof.mjs - the real host on the KAPEVault emulator (start it headless
// first: `npm run sim -- --no-window`; the app must be a debug build of this branch).
//
// Runs the real host inside the app's own WebView over DevTools - the phone's real Filesystem,
// CapacitorHttp, VaultKeystore and SecureClipboard - against the fake R2 from the Node tests (on this
// PC, reached through adb reverse, every signature checked with the PC's signer), on the shell check
// page (debug builds). Then it restarts the app, which opens on the vault (the real host from
// main.tsx), and unlocks through its UI; then a fresh install's first run through the UI: the PC's
// code read off the camera, the restore from the fake R2, the list, and a 2FA code scanned into the
// item form. The vault file is pulled off the phone and opened with the PC's own code. Leaves the app
// with no data, the emulator with no PIN or fingerprints. Output: mobile/proof/host/ (gitignored).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { APP, PIN, kapevaultDevice, sleep } from "../../../../scripts/lib/device.mjs";
import { R2_KEYS, fakeR2, pc, pcVaultText } from "./fixtures.mjs";
import { aimCamera } from "../../../../scripts/emu-camera.mjs";
import { TOTP_CODE } from "./qr-poster.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..", "..", "..");
const out = path.join(root, "proof", "host");
const MASTER = "Lantern-Mango-Quiet-47";
const PC_ID = "9d9d9d9d-1c1d-4e5f-8a9b-0c1d2e3f4a5b";
const PERSONAL = "5c1f7c1e-0000-4000-8000-000000000001";
const CDP_PORT = 9334;
const results = [];
fs.mkdirSync(out, { recursive: true });

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` - ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

// --- adb (scripts/lib/device.mjs) ---------------------------------------------------------------------

const { sh, key, touchFinger, appFiles, appFile, clearAppFiles, clipText, resetLock, waitForText, tapText, ...device } = kapevaultDevice("device-proof");

async function enrollFingerprint(finger) {
  await device.enrollFingerprint(finger);
  sh("shell", "am", "start", "-n", `${APP}/.MainActivity`); // back to the app, same process
  await sleep(1500);
}

const openPage = ({ restart }) => device.openPage({ port: CDP_PORT, out, restart });

// The host under test, bundled the way Vite builds the app (IIFE, "@core" = ../core).
async function bundle() {
  const dir = path.join(out, "bundle");
  await build({
    configFile: false,
    logLevel: "warn",
    resolve: { alias: { "@core": path.join(root, "..", "core", "index.js") } },
    build: { outDir: dir, emptyOutDir: true, minify: false, lib: { entry: path.join(here, "device-entry.ts"), formats: ["iife"], name: "KVProof", fileName: () => "proof-host.js" } },
  });
  return fs.readFileSync(path.join(dir, "proof-host.js"), "utf8");
}

// --- the proof -----------------------------------------------------------------------------------------

const r2 = await fakeR2();
const { text: pcSnapshot } = await pcVaultText(MASTER, {
  spaces: [{ id: PERSONAL, name: "Personal", kind: "personal" }],
  entries: [{ id: "e-mail", spaceId: PERSONAL, kind: "login", title: "Mail", tags: [], favorite: false, notes: "", updatedAt: "2026-09-20", username: "sam.home@example.com", password: "Mail-Pass-2291!", url: "mail.example.com", signIn: "password" }],
  cloud: { endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "kapevault-e2e", accessKeyId: "pc-key", secretAccessKey: "pc-secret", auto: true },
});
r2.put(pc.cloud.snapshotKey(new Date(), PC_ID), pcSnapshot);
sh("reverse", `tcp:${r2.port}`, `tcp:${r2.port}`);

let page;
try {
  await resetLock();
  sh("logcat", "-c");
  clearAppFiles();
  page = await openPage({ restart: true });
  // The proof's host runs on the shell check page, where no other host is running.
  await page.goto("/shell.html");
  const code = await bundle();
  const injected = await page.evaluate(`${code}; window.__h = KVProof.proofHost(${r2.port}); window.__h.state()`);
  check("the real host starts at first run on the phone", injected === "first-run", injected);

  const missing = await page.evaluate(`Capacitor.Plugins.Filesystem.readFile({ path: "no-such-file.json", directory: "DATA", encoding: "utf8" }).then(() => "read", (e) => e.code)`);
  check("Filesystem answers a missing file with OS-PLUG-FILE-0008 (what native.ts reads as missing)", missing === "OS-PLUG-FILE-0008", missing);

  const listed = await page.evaluate(`__h.listBackups(${JSON.stringify(R2_KEYS)})`);
  check("listBackups over native HTTP: the PC's snapshot, signed as the PC signs", listed.ok && listed.backups.length === 1 && listed.backups[0].device === "PC" && r2.badSignatures === 0, listed);

  const restored = await page.evaluate(`(async () => { const t = performance.now(); const r = await __h.restore(${JSON.stringify(R2_KEYS)}, ${JSON.stringify(listed.backups?.[0]?.key)}, ${JSON.stringify(MASTER)}); return { ...r, ms: Math.round(performance.now() - t) }; })()`);
  check("restore: download, scrypt in the WebView, write, unlock", restored.ok === true && (await page.evaluate("__h.state()")) === "unlocked", restored);

  const saved = await page.evaluate(`__h.saveEntry({ kind: "login", spaceId: ${JSON.stringify(PERSONAL)}, title: "Phone bank", tags: [], favorite: false, notes: "", username: "sam", password: "Phone-Bank-7731!", url: "bank.example.com", signIn: "password" })`);
  check("saveEntry writes through Filesystem", saved.ok === true, saved);
  const files = appFiles();
  check("the app's private files: the vault, settings, no leftover .next", files.includes("vault.kapevault") && files.includes("settings.json") && !files.some((f) => f.endsWith(".next")), files);

  const installId = JSON.parse(appFile("settings.json")).installId;
  const onPhone = appFile("vault.kapevault");
  const opened = await pc.crypto.openFile(MASTER, JSON.parse(onPhone));
  check("the PC's vault-crypto opens the file the phone wrote, stamped with the phone's id", opened?.data.entries.some((e) => e.id === saved.id) && opened.data.sync.meta[saved.id]?.vv[installId] === 1 && opened.data.cloud.accessKeyId === R2_KEYS.accessKeyId, { installId });

  let uploaded = [];
  for (let i = 0; i < 40 && !uploaded.length; i += 1) {
    await sleep(500);
    uploaded = [...r2.objects.keys()].filter((k) => pc.cloud.snapshotOwner(k) === installId && r2.objects.get(k).toString("utf8") === appFile("vault.kapevault"));
  }
  check("auto backup: a PUT over native HTTP under the phone's install id, byte for byte the file on the phone", uploaded.length >= 1 && r2.badSignatures === 0, uploaded);

  await page.evaluate(`__h.copySecret(${JSON.stringify(saved.id)}, "password")`);
  const copied = clipText();
  await page.evaluate("__h.lock()");
  await sleep(1000);
  const afterLock = clipText();
  check("copySecret puts it on the system clipboard, lock clears it", copied.includes("Phone-Bank-7731!") && !afterLock.includes("Phone-Bank-7731!"), { copied: copied.includes("Phone-Bank-7731!"), afterLock: afterLock.includes("Phone-Bank-7731!") });

  const wrong = await page.evaluate(`__h.unlock("not the password")`);
  const throttleFile = appFiles().includes("unlock-throttle.json");
  const right = await page.evaluate(`(async () => { const t = performance.now(); const r = await __h.unlock(${JSON.stringify(MASTER)}); return { ...r, ms: Math.round(performance.now() - t) }; })()`);
  check("master password unlock on the phone; a wrong one is counted in a file", wrong.ok === false && throttleFile && right.ok === true && !appFiles().includes("unlock-throttle.json"), { wrong, right });

  // Fingerprint unlock: the real Keystore wrap of the real vault key, and the 14-day dates beside it.
  sh("shell", "locksettings", "set-pin", PIN);
  await enrollFingerprint(1);
  const enabling = page.evaluate("__h.enableBiometric()");
  await waitForText(/Turn on fingerprint unlock/);
  touchFinger(1);
  const enabled = await enabling;
  const status = await page.evaluate("__h.biometricStatus()");
  check("enableBiometric: prompt, fingerprint, sealed dates written", enabled.ok === true && status.enabled && !status.needsMaster && appFiles().includes("fingerprint.json"), { enabled, status });

  await page.evaluate("__h.lock()");
  const unlocking = page.evaluate("__h.unlockBiometric()");
  await waitForText(/Unlock your vault/);
  touchFinger(1);
  const bioUnlocked = await unlocking;
  const view = await page.evaluate("__h.view().then((v) => v.entries.map((e) => e.title))");
  check("unlockBiometric: the unwrapped key opens the vault", bioUnlocked.ok === true && view.includes("Phone bank"), { bioUnlocked, view });

  await page.evaluate("__h.lock()");
  await enrollFingerprint(2);
  const changed = await page.evaluate("__h.unlockBiometric()");
  const off = await page.evaluate("__h.biometricStatus()");
  check("a newly enrolled fingerprint: 'changed', and fingerprint unlock is off", changed.code === "changed" && off.enabled === false && !appFiles().includes("fingerprint.json"), { changed, off });

  // The app itself, on the real host from main.tsx: the lock screen, the master password, the list.
  await resetLock();
  page.close();
  page = await openPage({ restart: true });
  const start = await page.evaluate("location.href");
  check("the app starts on the vault page", start === "https://localhost/", start);
  let lockScreen = "";
  for (let i = 0; i < 30 && !/master password/i.test(lockScreen); i += 1) {
    await sleep(500);
    lockScreen = String(await page.evaluate("document.body?.innerText ?? ''"));
  }
  await page.screenshot("1-lock-screen.png");
  check("the app opens on its lock screen (a vault is on the phone)", /Enter your master password/.test(lockScreen), lockScreen.slice(0, 120));
  await page.evaluate(`document.querySelector("input[type=password]")?.focus()`);
  sh("shell", "input", "text", MASTER);
  key("KEYCODE_ENTER");
  let home = "";
  for (let i = 0; i < 30 && !/Phone bank/.test(home); i += 1) {
    await sleep(500);
    home = await page.evaluate("document.body.innerText");
  }
  await page.screenshot("2-home.png");
  check("typing the master password in the app's UI opens the list from the phone's file", /Phone bank/.test(home) && /Mail/.test(home), home.slice(0, 160));

  // Fresh installs, as a user meets them, on the app's own host (main.tsx). A DevTools script added
  // before the app's code bends only the URL of each native HTTP call to an R2 host, to the fake bucket
  // (as device-entry.ts does for the proof's host).
  const PHONE_MASTER = "Copper-Violet-Harbor-83";
  async function freshInstall() {
    page?.close();
    sh("shell", "am", "force-stop", APP);
    clearAppFiles();
    page = await openPage({ restart: true });
    await page.send("Page.enable"); // without it the WebView never runs the script below
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `document.addEventListener("readystatechange", () => {
        const cap = window.Capacitor;
        if (!cap?.nativePromise || cap.toFakeR2) return;
        const call = (cap.toFakeR2 = cap.nativePromise);
        cap.nativePromise = (plugin, method, options) => {
          const u = plugin === "CapacitorHttp" && method === "request" ? new URL(options.url) : null;
          if (!u || !u.hostname.endsWith(".r2.cloudflarestorage.com")) return call(plugin, method, options);
          return call(plugin, method, { ...options, url: "http://localhost:${r2.port}" + u.pathname + u.search, headers: { ...options.headers, "x-test-host": u.host } });
        };
      });`,
    });
    await page.send("Page.reload", {});
    await page.loaded("/");
    const text = await page.text(/Choose a master password/);
    const bent = await page.evaluate(`typeof Capacitor.toFakeR2 === "function"`);
    check("fresh install: the app's R2 calls are bent to the fake bucket", bent === true, bent);
    return text;
  }
  // A React input by its placeholder, aria-label or label text, set the way typing sets it.
  const fill = (name, value) =>
    page.evaluate(`(() => {
      const input = [...document.querySelectorAll("input")].find((i) => i.placeholder === ${JSON.stringify(name)} || i.getAttribute("aria-label") === ${JSON.stringify(name)} || i.closest("label")?.querySelector("span")?.textContent === ${JSON.stringify(name)});
      if (!input) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
  const lockFromDrawer = async () => {
    await page.click("Show sidebar");
    await sleep(600);
    await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Lock"))?.click()`);
  };

  // 1. First run makes a vault on the phone: create, add an item, lock, unlock.
  let text = await freshInstall();
  await sleep(1200); // the screen's entrance
  await page.screenshot("3-first-run-create.png");
  check("a fresh install opens on the PC's first run: create a master password, Restore from backup as a link, 2 steps", /Choose a master password/.test(text) && /Restore from backup/.test(text) && /1 of 2/.test(text) && !/R2/.test(text), text.slice(0, 200));
  await fill("Master password", PHONE_MASTER);
  await fill("Confirm master password", PHONE_MASTER);
  await page.click("Continue");
  text = await page.text(/All items/, 30_000);
  await page.screenshot("4-created-empty.png");
  check("Create: the vault is made on the phone and opens (no fingerprint on the phone: no offer)", /All items/.test(text) && appFiles().includes("vault.kapevault"), text.slice(0, 120));
  const created = await pc.crypto.openFile(PHONE_MASTER, JSON.parse(appFile("vault.kapevault")));
  check("the PC's vault-crypto opens the vault the phone made, its Personal space naming it", created?.data.spaces[0]?.kind === "personal" && created.data.sync.vaultId === created.data.spaces[0].id && created.data.cloud === undefined);
  check("R2 off: the sync line only says No backup yet", /No backup yet/.test(text));

  await page.click("New");
  await page.text(/Kind of item|Title/);
  await fill("Title", "Phone locker");
  await fill("Username or email", "sam.phone");
  await page.click("Save");
  text = await page.text(/Phone locker/, 15_000);
  await sleep(800);
  check("add an item on the new vault", /Phone locker/.test(text));
  // The item opens after a save. Android's Back closes it and stays in the app (it once left the app).
  const itemOpen = () => page.evaluate(`Boolean(document.querySelector('section[aria-label="Item"][data-open]'))`);
  const openBefore = await itemOpen();
  key("KEYCODE_BACK");
  await sleep(1000);
  const inFront = /mCurrentFocus=.*kapevault/.test(sh("shell", "dumpsys", "window"));
  check("Android Back closes the open item and stays in the app", openBefore && !(await itemOpen()) && inFront, { openBefore, openAfter: await itemOpen(), inFront });
  await lockFromDrawer();
  text = await page.text(/Enter your master password/);
  check("lock: the lock screen", /Enter your master password/.test(text), text.slice(0, 120));
  await fill("Master password", PHONE_MASTER);
  await page.evaluate(`document.querySelector("form")?.requestSubmit()`);
  text = await page.text(/Phone locker/, 30_000);
  await page.screenshot("5-unlocked-own-vault.png");
  check("unlock with the new master password: the item is there", /Phone locker/.test(text), text.slice(0, 120));

  // 2. Settings > Backup and sync > Connect to R2: the bucket holds the PC's vault, "Use the vault from your PC".
  await page.click("Settings");
  text = await page.text(/Connect to R2/);
  await page.screenshot("6-settings-backup-off.png");
  check("Settings: Connect to R2 while backup is off", /Connect to R2/.test(text) && /No backup yet/.test(text));
  // The row's text also holds its value ("No backup yet"), so it is found by how it starts.
  await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Connect to R2"))?.click()`);
  await page.text(/Or type the keys/);
  for (const [name, value] of [["S3 API URL", R2_KEYS.url], ["Access key ID", R2_KEYS.accessKeyId], ["Secret access key", R2_KEYS.secretAccessKey]]) await fill(name, value);
  await page.click("Connect");
  text = await page.text(/This bucket holds another vault/, 30_000);
  await page.screenshot("7-another-vault.png");
  check("a bucket holding another vault asks: Use the vault from your PC, or Keep this phone's vault", /Use the vault from your PC/.test(text) && /Keep this phone's vault/.test(text) && /1 item moves/.test(text), text.slice(0, 240));
  await fill("Master password of the vault from your PC", MASTER);
  await page.click("Use that vault");
  await page.click("Items");
  text = await page.text(/Mail[\s\S]*Phone locker|Phone locker[\s\S]*Mail/, 30_000);
  await page.screenshot("8-used-pc-vault.png");
  const used = await pc.crypto.openFile(MASTER, JSON.parse(appFile("vault.kapevault")));
  const carried = used?.data.entries.find((e) => e.title === "Phone locker");
  check("Use the vault from your PC: the PC's items and this phone's item, carried as a new item", /Mail/.test(text) && /Phone locker/.test(text) && Boolean(carried) && carried.id !== created.data.entries.find((e) => e.title === "Phone locker")?.id && appFiles().includes("replaced.kapevault"), text.slice(0, 160));
  // The PC's snapshot has never met another device, so it has no name yet (two-device.mjs: once it has).
  text = await page.text(/Synced with/, 30_000);
  // Among the devices, in either order: the earlier install of this phone names itself too, and the
  // listing decides which comes first.
  check("the phone then merges from R2: the sync line says Synced with the other device", /Synced with (.* and )?Another device/.test(text), text.slice(0, 200));

  // 3. Another fresh install: Restore from backup (the link), the PC's code off the camera, the list.
  sh("shell", "pm", "revoke", APP, "android.permission.CAMERA");
  sh("shell", "pm", "clear-permission-flags", APP, "android.permission.CAMERA", "user-set", "user-fixed");
  await aimCamera("setup");
  await freshInstall();
  await page.click("Restore from backup");
  text = await page.text(/Scan the code/);
  check("Restore from backup (the link) opens the R2 step, with Cancel back", /Scan the code/.test(text) && /Type the keys instead/.test(text) && /Cancel/.test(text));
  await page.click("Cancel");
  text = await page.text(/Choose a master password/);
  check("Cancel goes back to create", /Choose a master password/.test(text));
  await page.click("Restore from backup");
  await page.text(/Scan the code/);
  await page.click("Scan the code");
  await tapText("While using the app");
  // A scanned code connects only after its account and bucket are shown and confirmed (audit L7).
  const confirm = await page.text(/Connect to this bucket\?/, 30_000);
  check("Scan the code: the account and bucket are shown before anything connects", /Connect to this bucket\?/.test(confirm), confirm.slice(0, 200));
  await page.click("Connect");
  const picker = await page.text(/Pick a backup/, 30_000);
  await page.screenshot("9-backups.png");
  check("Scan the code: the PC's code off the camera connects to the bucket and lists its backups, 'PC' / 'This phone' and a date", /Pick a backup/.test(picker) && /\bPC\b/.test(picker) && /newest/.test(picker), picker.slice(0, 200));
  await page.evaluate(`[...document.querySelectorAll("[role=radio]")].find((b) => /\\bPC\\b/.test(b.textContent))?.click()`);
  await page.click("Use this backup");
  await page.text(/Master password for this backup/);
  await page.evaluate(`document.querySelector("input[type=password]")?.focus()`);
  sh("shell", "input", "text", MASTER);
  key("KEYCODE_ENTER");
  const list = await page.text(/Mail/, 30_000);
  await page.screenshot("10-restored-list.png");
  check("restore via the link: the list from the PC's backup", /Mail/.test(list) && appFiles().includes("vault.kapevault"), list.slice(0, 160));

  // 4. The item form's 2FA "Scan QR code", camera already allowed.
  await aimCamera("totp");
  await page.click("New");
  await page.text(/Scan QR code/);
  await page.click("Scan QR code");
  let scanned = "";
  for (let i = 0; i < 40 && scanned !== TOTP_CODE; i += 1) {
    await sleep(500);
    scanned = await page.evaluate(`[...document.querySelectorAll("input")].find((i) => /key/i.test(i.placeholder))?.value ?? ""`);
  }
  const form = await page.text(/2FA setup key/);
  await page.screenshot("11-totp-scanned.png");
  check("the item form's Scan QR code fills the 2FA setup key from the camera", scanned === TOTP_CODE && !/not a valid/i.test(form), { filled: scanned === TOTP_CODE });
  await aimCamera("blank");

  // adbd logs every shell command, including the proof's own `input text <master password>`.
  const logcat = sh("logcat", "-d").split("\n").filter((line) => !/ I adbd\s*:/.test(line)).join("\n");
  const leaked = { master: logcat.includes(MASTER), phoneMaster: logcat.includes(PHONE_MASTER), password: logcat.includes("Phone-Bank-7731!"), r2Secret: logcat.includes(R2_KEYS.secretAccessKey) };
  check("the master passwords, a stored password and the R2 secret never reach logcat", !Object.values(leaked).some(Boolean), leaked);
  if (Object.values(leaked).some(Boolean)) fs.writeFileSync(path.join(out, "logcat.txt"), logcat);
} catch (e) {
  check("the proof ran to the end", false, e.stack ?? String(e));
} finally {
  page?.close();
  try {
    sh("shell", "am", "force-stop", APP);
    clearAppFiles();
    sh("reverse", "--remove", `tcp:${r2.port}`);
  } catch {
    // best effort
  }
  await resetLock().catch(() => {});
  await r2.close();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed. Report: ${path.join(out, "report.json")}`);
  process.exitCode = failed ? 1 : 0;
}
