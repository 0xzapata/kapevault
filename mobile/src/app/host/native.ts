// Everything the real host needs from Android, in one place: the app's private files, native HTTP, the
// VaultKeystore, SecureClipboard, QrScanner, ScreenCapture, Billing and DurableFile plugins (mobile/android/.../kapevault/), and
// the phone's browser.
import { CapacitorHttp, registerPlugin } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { Keystore } from "./biometric";
import type { Billing } from "./pro";
import type { Transport } from "./r2";
import type { HostDeps } from "./real-host";
import type { RawFs } from "./storage";

const VaultKeystore = registerPlugin<Keystore>("VaultKeystore");
const SecureClipboard = registerPlugin<{ copy(options: { text: string }): Promise<void>; clear(): Promise<void> }>("SecureClipboard");
const QrScanner = registerPlugin<{ scan(options: { purpose: "setup" | "totp" }): Promise<{ text: string }> }>("QrScanner");
const ScreenCapture = registerPlugin<{ setHidden(options: { hidden: boolean }): Promise<void> }>("ScreenCapture");
const PlayBilling = registerPlugin<Billing>("Billing");
const DurableFile = registerPlugin<{ replace(options: { name: string; text: string }): Promise<void> }>("DurableFile");

// Directory.Data = the app's private files folder: no other app reads it, and
// android:allowBackup="false" keeps it out of Google's cloud backup.
const at = (path: string) => ({ path, directory: Directory.Data });
const missing = (e: unknown) => (e as { code?: string })?.code === "OS-PLUG-FILE-0008"; // FilesystemErrors.doesNotExist

const fs: RawFs = {
  async read(name) {
    try {
      const { data } = await Filesystem.readFile({ ...at(name), encoding: Encoding.UTF8 });
      return typeof data === "string" ? data : await data.text();
    } catch (e) {
      if (missing(e)) return null;
      throw e;
    }
  },
  // Filesystem.writeFile never syncs to flash and Filesystem.rename deletes the target first, so saves
  // go through DurableFile (see DurableFilePlugin.kt). Reads and deletes are Filesystem's.
  replace: (name, text) => DurableFile.replace({ name, text }),
  async remove(name) {
    try {
      await Filesystem.deleteFile(at(name));
    } catch (e) {
      if (!missing(e)) throw e;
    }
  },
};

// R2 requests go out through Android's HttpURLConnection (CapacitorHttp, built into @capacitor/core),
// never the WebView: the bucket has no CORS for this origin, and the page CSP allows no requests.
// A body is written only with a Content-Type; the reply comes back as text, or already parsed when R2
// labels it JSON. Redirects are refused, as on the PC.
const transport: Transport = async ({ method, url, headers, body }) => {
  const res = await CapacitorHttp.request({
    method,
    url,
    headers: body === undefined ? headers : { ...headers, "Content-Type": "application/octet-stream" },
    data: body,
    responseType: "text",
    disableRedirects: true,
    connectTimeout: 15_000,
    readTimeout: 60_000,
  });
  return { status: res.status, body: typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "") };
};

// "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A...; wv)" -> "Pixel 8".
function phoneModel() {
  const model = /Android [^;]+; ([^;)]+?)(?: Build\/[^;)]*)?[;)]/.exec(navigator.userAgent)?.[1]?.trim();
  return model && model !== "K" ? model : "Android phone";
}

export function nativeDeps(): HostDeps {
  return {
    fs,
    transport,
    keystore: VaultKeystore,
    clipboard: {
      copySecret: (text) => SecureClipboard.copy({ text }),
      // Not a secret, but an account number or a username still should not sit in the keyboard's
      // clipboard history: the sensitive clipboard, which clears itself (SECURITY-AUDIT-2026-09-28.md).
      copyText: (text) => SecureClipboard.copy({ text }),
      clear: () => SecureClipboard.clear(),
    },
    scanQr: async (purpose) => (await QrScanner.scan({ purpose })).text,
    hideFromCapture: (hidden) => ScreenCapture.setHidden({ hidden }),
    billing: PlayBilling,
    // Capacitor opens any page outside the app in the phone's browser.
    openUrl: (url) => void window.open(url, "_blank", "noopener"),
    model: phoneModel(),
    // The shell fires kapevault:resume when the app comes back (MainActivity), the page sees it visible.
    onResume(fn) {
      window.addEventListener("kapevault:resume", fn);
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && fn());
    },
  };
}
