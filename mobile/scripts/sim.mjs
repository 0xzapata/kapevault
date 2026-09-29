// npm run sim       - boot the KAPEVault emulator (a visible window), build, install and open the app.
// npm run sim:live  - the same, but the page comes from the Vite dev server, so edits under src/
//                     show on the emulator in seconds. Debug builds only: the dev server url goes into
//                     that one debug APK, and the Android project's config is put back right after.
// Safe to run again: an emulator already running the KAPEVault AVD is reused.
// `npm run sim -- --no-window` boots it headless (no window, no audio, no clipboard sharing with
// Windows) - what npm run proof wants.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PANORAMA, SETUP_CODE, TOTP_CODE, qrPanorama } from "../src/app/host/test/qr-poster.mjs";
import { adb, emulator, env, sdk } from "./android-env.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const live = process.argv.includes("--live");
const headless = process.argv.includes("--no-window");
const AVD = "KAPEVault";
const APP = "com.brewedops.kapevault";
// Android 17 QPR2, the newest stable image (2026-09-27); Google ships it only with 16 KB pages,
// which Play requires apps to support anyway. Install: android sdk install system-images/android-37.2/google_apis_playstore_ps16k/x86_64
const IMAGE = ["system-images", "android-37.2", "google_apis_playstore_ps16k", "x86_64"];
const IMAGE_NAME = "Android 17";
const DEV_PORT = 5173; // vite.config.mjs; adb reverse makes it the emulator's own localhost:5173
const DEV_URL = `http://localhost:${DEV_PORT}`;
const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
const capacitor = path.join(root, "node_modules", "@capacitor", "cli", "bin", "capacitor");
const webConfig = path.join(root, "android", "app", "src", "main", "assets", "capacitor.config.json");
const apk = path.join(root, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");

let serial = "";
let devServer = null;

const say = (text) => console.log(`sim: ${text}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function adbText(...args) {
  try {
    return execFileSync(adb, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

// Rewrites the copied config from the committed capacitor.config.js, dropping the dev server url.
const restoreConfig = () => spawnSync(process.execPath, [capacitor, "copy", "android"], { cwd: root, env, stdio: "ignore" });

// Every way out of a live session: Ctrl+C, the dev server stopping, a failed step.
let ended = false;
function endLive() {
  if (!live || ended) return;
  ended = true;
  restoreConfig();
  if (serial) adbText("-s", serial, "reverse", "--remove", `tcp:${DEV_PORT}`);
  devServer?.kill();
}

function fail(text) {
  console.error(`sim: ${text}`);
  endLive();
  process.exit(1);
}

function run(label, file, args) {
  say(label);
  const { status } = spawnSync(process.execPath, [file, ...args], { cwd: root, env, stdio: "inherit" });
  if (status !== 0) fail(`${label} failed (exit ${status}).`);
}

// The phone the emulator looks like: the newest Pixel with a device frame on this PC (Android
// Studio ships the frames; there is no Pixel 10 frame yet, and the 10 Pro looks the same).
const DEVICE = { id: "pixel_9_pro", name: "Pixel 9 Pro", width: 1280, height: 2856, density: 480 };
const studioArt = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Android", "Android Studio", "plugins", "android", "resources", "device-art-resources");

// The frame lives in the SDK's skins folder, copied once from Android Studio (KAPEVAULT_SKIN_DIR
// overrides the source). No frame found: the emulator still runs, as a plain rectangle.
function ensureSkin() {
  const dest = path.join(sdk, "skins", DEVICE.id);
  if (fs.existsSync(path.join(dest, "layout"))) return dest;
  const src = process.env.KAPEVAULT_SKIN_DIR ?? path.join(studioArt, DEVICE.id);
  if (!fs.existsSync(path.join(src, "layout"))) {
    say(`no ${DEVICE.name} frame at ${src} - the emulator runs without one.`);
    return null;
  }
  fs.cpSync(src, dest, { recursive: true });
  return dest;
}

// The AVD is made from the installed Google Play image (IMAGE), with no avdmanager needed. The
// device keys are rewritten before every cold boot, so an existing AVD takes a new look (its data stays).
function ensureAvd() {
  const home = process.env.ANDROID_AVD_HOME ?? path.join(os.homedir(), ".android", "avd");
  const dir = path.join(home, `${AVD}.avd`);
  const file = path.join(dir, "config.ini");
  if (!fs.existsSync(path.join(sdk, ...IMAGE))) fail(`missing ${IMAGE.join("/")} - install it: android sdk install ${IMAGE.join("/")}`);
  if (!fs.existsSync(path.join(home, `${AVD}.ini`))) {
    say(`creating the ${AVD} emulator (${DEVICE.name}, ${IMAGE_NAME})`);
    fs.mkdirSync(dir, { recursive: true });
  }
  const current = fs.existsSync(file)
    ? Object.fromEntries(lines(fs.readFileSync(file, "utf8")).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]))
    : {};
  const skin = ensureSkin();
  const sysdir = `${IMAGE.join(path.sep)}${path.sep}`;
  // A new Android version cannot boot the old version's data: that one boot starts clean.
  const wipe = Boolean(current["image.sysdir.1"]) && current["image.sysdir.1"] !== sysdir;
  if (wipe) say(`moving the emulator to ${IMAGE[1]} - its data starts fresh`);
  fs.writeFileSync(path.join(home, `${AVD}.ini`), `avd.ini.encoding=UTF-8\npath=${dir}\npath.rel=avd${path.sep}${AVD}.avd\ntarget=${IMAGE[1]}\n`);
  const config = {
    AvdId: AVD,
    "avd.ini.displayname": AVD,
    "avd.ini.encoding": "UTF-8",
    "abi.type": "x86_64",
    "hw.cpu.arch": "x86_64",
    "disk.dataPartition.size": "6G",
    "hw.keyboard": "yes",
    "hw.mainKeys": "no",
    "hw.initialOrientation": "portrait",
    "PlayStore.enabled": "true",
    ...current,
    // Smooth on this PC (12 threads, 32 GB, a real GPU): the host GPU renders, more cores and RAM.
    "hw.cpu.ncore": 6,
    "hw.ramSize": 4096,
    "hw.gpu.enabled": "yes",
    "hw.gpu.mode": "host",
    "image.sysdir.1": sysdir,
    "tag.id": "google_apis_playstore",
    "tag.ids": "google_apis_playstore,page_size_16kb",
    "tag.display": "Google Play",
    target: IMAGE[1],
    "hw.device.name": DEVICE.id,
    "hw.device.manufacturer": "Google",
    "hw.lcd.width": DEVICE.width,
    "hw.lcd.height": DEVICE.height,
    "hw.lcd.density": DEVICE.density,
    showDeviceFrame: skin ? "yes" : "no",
    "skin.dynamic": "yes",
    "skin.name": skin ? DEVICE.id : `${DEVICE.width}x${DEVICE.height}`,
    "skin.path": skin ?? "_no_skin",
  };
  fs.writeFileSync(file, `${Object.entries(config).map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
  return wipe;
}

// adb on Windows ends lines with \r\r\n, so lines split on any run of line breaks.
const lines = (text) => text.split(/[\r\n]+/);
const runningSerial = () =>
  lines(adbText("devices"))
    .map((line) => line.split("\t"))
    .filter(([id, state]) => id.startsWith("emulator-") && state === "device")
    .map(([id]) => id)
    .find((id) => lines(adbText("-s", id, "emu", "avd", "name"))[0] === AVD);

async function bootEmulator() {
  serial = runningSerial();
  if (serial) {
    say(`reusing the running ${AVD} emulator (${serial})`);
    // The camera panorama is drawn only when the emulator boots.
    say("changed a qr-poster code? restart the emulator to redraw the camera panorama");
  } else {
    const wipe = ensureAvd();
    say(`starting the ${AVD} emulator - the first boot takes a few minutes`);
    // The back camera shows a panorama holding the test QR codes (qr-poster.mjs), so the QR scan can
    // read one: the proofs turn the camera to it (emu-camera.mjs). Emulator 37's virtual room draws no
    // posters, so `virtualscene-image` had nothing to show.
    const panorama = path.join(root, "proof", "camera-panorama.png");
    fs.mkdirSync(path.dirname(panorama), { recursive: true });
    fs.writeFileSync(panorama, qrPanorama([{ text: SETUP_CODE, heading: PANORAMA.setup }, { text: TOTP_CODE, heading: PANORAMA.totp }]));
    const camera = ["-camera-back", `image360:${panorama}`];
    spawn(emulator, ["-avd", AVD, ...camera, ...(wipe ? ["-wipe-data"] : []), ...(headless ? ["-no-window", "-no-audio"] : [])], { env, detached: true, stdio: "ignore" }).unref();
    for (let waited = 0; !serial; waited += 2) {
      if (waited > 300) fail("the emulator did not show up in adb within 5 minutes.");
      await sleep(2000);
      serial = runningSerial();
    }
  }
  // boot_completed can be set while the package manager is still coming up on a first boot.
  const ready = () =>
    adbText("-s", serial, "shell", "getprop", "sys.boot_completed") === "1" && adbText("-s", serial, "shell", "pm", "path", "android").startsWith("package:");
  for (let waited = 0; !ready(); waited += 2) {
    if (waited > 600) fail("the emulator did not finish booting within 10 minutes.");
    await sleep(2000);
  }
}

async function startDevServer() {
  say(`starting the dev server on ${DEV_URL}`);
  devServer = spawn(process.execPath, [vite], { cwd: root, env, stdio: ["ignore", "ignore", "inherit"] });
  devServer.on("exit", () => {
    say("the dev server stopped.");
    endLive();
    process.exit(0);
  });
  for (let waited = 0; ; waited += 0.5) {
    if (waited > 30) fail("the dev server did not answer within 30 s.");
    try {
      if ((await fetch(`http://127.0.0.1:${DEV_PORT}/`)).ok) break;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  const reverse = spawnSync(adb, ["-s", serial, "reverse", `tcp:${DEV_PORT}`, `tcp:${DEV_PORT}`], { env, stdio: "ignore" });
  if (reverse.status !== 0) fail("adb reverse failed.");
}

await bootEmulator();
if (process.argv.includes("--boot-only")) {
  say("the emulator is up; nothing was built or installed.");
  process.exit(0);
}
if (live) await startDevServer();

run("building the page", vite, ["build", "--mode", "debug", "--logLevel", "warn"]);
run("syncing it into the Android project", capacitor, ["sync", "android"]);
if (live) {
  const config = JSON.parse(fs.readFileSync(webConfig, "utf8"));
  fs.writeFileSync(webConfig, JSON.stringify({ ...config, server: { ...config.server, url: DEV_URL } }, null, "\t"));
}
run("building the debug APK", path.join(root, "scripts", "gradle.mjs"), ["assembleDebug", "--quiet"]);

say(`installing on ${serial}`);
if (!/Success/.test(adbText("-s", serial, "install", "-r", apk))) fail("adb install failed.");
adbText("-s", serial, "shell", "am", "force-stop", APP);
// A screen that went to sleep would open the app behind the lock screen.
adbText("-s", serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP");
adbText("-s", serial, "shell", "wm", "dismiss-keyguard");
adbText("-s", serial, "shell", "am", "start", "-n", `${APP}/.MainActivity`);
say("KAPEVault is open on the emulator.");

if (live) {
  // The installed debug APK already carries the url; no later build may pick it up.
  restoreConfig();
  say("live: edits under src/ show in the app. Ctrl+C stops the dev server.");
  const stop = () => {
    endLive();
    say("stopped. Run `npm run sim` to put the normal build back on the emulator.");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
