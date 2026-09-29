// The device proof's host (device-proof.mjs bundles this and runs it inside the app's WebView): the
// real host over the real native pieces - Filesystem, CapacitorHttp, VaultKeystore, SecureClipboard -
// with one change: R2 requests go to the fake bucket on the PC (adb reverse, the phone's own
// localhost) instead of Cloudflare, still carried by native HTTP and signed for the real R2 host.
import { nativeDeps } from "../native";
import { createRealHost } from "../real-host";

export function proofHost(port: number) {
  const deps = nativeDeps();
  const native = deps.transport;
  return createRealHost({
    ...deps,
    backupDelayMs: 300,
    transport: (request) => {
      const u = new URL(request.url);
      return native({ ...request, url: `http://localhost:${port}${u.pathname}${u.search}`, headers: { ...request.headers, "x-test-host": u.host } });
    },
  });
}
