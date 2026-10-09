// "Scan a label": reads the text on a device sticker photo with Windows' own offline OCR
// (Windows.Media.Ocr through PowerShell WinRT, the same bridge style as windows-hello.cjs). The photo
// goes to PowerShell on stdin, never to a file, and the text comes back only to main - nothing leaves
// the machine. Anywhere else (a Mac, a PC without an OCR language) it is "unavailable" and the form
// lets the user type.
const fs = require("node:fs");
const path = require("node:path");
const { runPsJson } = require("./system-tools.cjs");

const TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // the page sends a downscaled JPEG; far below this

// Test stand-in (KAPEVAULT_OCR_FAKE, unpacked only): "label" reads this mock router sticker,
// "blank" reads nothing, "unavailable" has no OCR at all.
const FAKE_LABEL = [
  "tp-link",
  "Model: Archer C6",
  "Default Access: http://tplinkwifi.net",
  "Username: admin Password: mock-admin-77",
  "Wireless Network Name (SSID): Mock_Home_2.4G",
  "Wireless Password/PIN: mockwifi-4821",
  "MAC: 50-C7-BF-12-34-56",
  "S/N: 2231MOCK09876",
].join("\n");

async function runOcr(base64) {
  // Electron's fs reads inside app.asar; powershell.exe cannot, so the script travels inline.
  const script = fs.readFileSync(path.join(__dirname, "label-ocr.ps1"), "utf8").replace(/^\uFEFF/, "");
  try {
    return await runPsJson({ script, stdin: base64, timeoutMs: TIMEOUT_MS });
  } catch (e) {
    throw new Error(e.timedOut ? "Reading the label took too long" : "Could not read the label");
  }
}

// image: a data URL from the page (JPEG or PNG). Returns { status: "ok", text } or { status: "unavailable" }.
/** @param {string} image @param {{ fake?: any }} [options] */
async function readLabelText(image, { fake } = {}) {
  const m = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(typeof image === "string" ? image : "");
  if (!m || (m[1].length * 3) / 4 > MAX_IMAGE_BYTES) throw new Error("That photo could not be read");
  if (fake) return fake === "unavailable" ? { status: "unavailable" } : { status: "ok", text: fake === "label" ? FAKE_LABEL : "" };
  if (process.platform !== "win32") return { status: "unavailable" };
  const result = await runOcr(m[1]);
  if (result.status === "Unavailable") return { status: "unavailable" };
  if (result.status !== "Success") throw new Error("Could not read the label");
  const lines = Array.isArray(result.lines) ? result.lines : [result.lines]; // one line comes back as a bare string
  return { status: "ok", text: lines.filter((l) => typeof l === "string").join("\n") };
}

module.exports = { readLabelText, FAKE_LABEL };
