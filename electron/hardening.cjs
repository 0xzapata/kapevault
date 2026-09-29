// The process-wide guards, kept in one place: no debugger on a packaged build, no name lookups, every
// web contents held to KAPEVault's own pages, no network for anything the page shows, and previewed
// files streamed only from inside linked folders under their own CSP. main.cjs calls each at the
// point in startup where it must run.
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { checkPath, isNetworkPath } = require("./file-access.cjs");

const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' kapevault-file:",
  "style-src 'unsafe-inline' kapevault-file:",
  "img-src kapevault-file: data: blob:",
  "media-src kapevault-file: blob:",
  "font-src kapevault-file: data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join("; ");

// A packaged KAPEVault never runs with a debugger attached: a --remote-debugging port or pipe would
// let any program on this PC read the unlocked vault out of the page. The fuses only drop Node's
// --inspect; Chromium's switches have no fuse. hasSwitch also sees Windows' "-x" and "/x" spellings.
// This runs before the debugging server would start, and exit() here ends the process at once.
// Tests launch unpacked (Playwright adds these switches).
// The *-cmd-prefix / launcher / subprocess-path switches start Chromium's helper processes through
// another program, which would then run beside the unlocked vault.
const DEBUG_SWITCHES = ["remote-debugging-port", "remote-debugging-pipe", "remote-debugging-address", "inspect", "inspect-brk", "inspect-brk-node", "inspect-port", "inspect-wait", "inspect-publish-uid", "debug", "debug-brk", "debug-port", "renderer-cmd-prefix", "gpu-launcher", "utility-cmd-prefix", "browser-subprocess-path"];
function refuseDebugging(app) {
  if (app.isPackaged && (DEBUG_SWITCHES.some((s) => app.commandLine.hasSwitch(s)) || process.argv.some((a) => /^[-/]{1,2}(remote-debugging|inspect|debug|renderer-cmd|gpu-launcher|utility-cmd|browser-subprocess)/i.test(a)))) app.exit(1);
}

// Chromium never needs a name looked up (the page is local, R2 goes through curl, links open in the
// browser), and a previewed page's <link rel=dns-prefetch> would resolve past the dead proxy below.
// A dev run keeps its Vite host.
function blockNameLookups(app, devUrl) {
  app.commandLine.appendSwitch("host-resolver-rules", `MAP * ~NOTFOUND${devUrl ? `, EXCLUDE ${new URL(devUrl).hostname}` : ""}`);
}

// Previews stream files through kapevault-file://local/<encoded path>, checked against linked folders.
function registerFileScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: "kapevault-file", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
}

// Belt and braces for every web contents the app ever makes (windows, preview frames' hosts, the
// Emergency Kit printer): no <webview>, no popups, and frames may only show a previewed file,
// a srcdoc Markdown page or the built-in PDF viewer - never some other page a file links to.
const FRAME_OK = /^(kapevault-file:|about:srcdoc|about:blank|chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\/)/; // last = Chromium's PDF viewer
function lockDownWebContents(app) {
  app.on("web-contents-created", (_event, contents) => {
    // WebRTC's direct UDP (STUN) would let a previewed page that was allowed to run send data out
    // past the preview's no-network policy. KAPEVault never uses WebRTC.
    contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
    contents.on("will-attach-webview", (e) => e.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-frame-navigate", (e) => {
      if (!e.isMainFrame && !FRAME_OK.test(e.url)) e.preventDefault();
    });
  });
}

// Once the app is ready. linkedFolders: the folders linked in the unlocked vault (it throws while locked).
async function hardenSession({ session, protocol, net, devUrl, linkedFolders }) {
  // KAPEVault needs no browser permission (camera, mic, notifications, location, ...), so a previewed
  // file asking for one is refused. Full screen stays, for video previews.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === "fullscreen"));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "fullscreen");
  // Nothing the page shows ever needs the internet (R2 requests are signed in main and carried by the
  // system curl, links open in the user's browser). Chromium's traffic goes to a proxy that does not exist, so a previewed
  // page the user let run cannot reach out - not even through a WebRTC TURN relay over TCP.
  // Chromium sends localhost and link-local addresses around any proxy by itself; "<-loopback>"
  // (Chromium net/docs/proxy.md) removes that exception, so a preview cannot reach a local service
  // either. A dev run keeps only its own Vite server direct (a later rule wins).
  const bypass = devUrl ? `<-loopback>,${new URL(devUrl).host}` : "<-loopback>";
  await session.defaultSession.setProxy({ proxyRules: "http://127.0.0.1:9", proxyBypassRules: bypass });
  // CSP 'self' on a file:// page allows every file:// URL, another machine's share included: an
  // <img src="file://host/share/x.jpg"> loads over SMB and offers the NTLM hash (proved on Electron 44
  // with the app's own CSP, audit finding M2 in SECURITY-AUDIT-2026-09-28.md). The page's own files never have
  // a host. Only a page's requests are refused: main's own net.fetch (the kapevault-file handler,
  // which checked the path against the linked folders and a network folder's click) passes here too,
  // with no webContentsId (proved) - refusing it broke previews from a network folder or a mapped drive.
  session.defaultSession.webRequest.onBeforeRequest((details, done) => {
    if (!details.url.startsWith("file:") || details.webContentsId === undefined) return done({});
    let remote = true;
    try {
      const url = new URL(details.url);
      remote = url.hostname !== "" || isNetworkPath(decodeURIComponent(url.pathname));
    } catch {
      // unparseable: refused
    }
    done({ cancel: remote });
  });
  protocol.handle("kapevault-file", async (request) => {
    try {
      const target = checkPath(linkedFolders(), decodeURIComponent(new URL(request.url).pathname.slice(1)));
      if (!fs.statSync(target).isFile()) return new Response("Not a file", { status: 404 });
      // Forward Range headers so video and audio can seek.
      const file = await net.fetch(pathToFileURL(target).href, { headers: request.headers, bypassCustomProtocolHandlers: true });
      // Previewed files (an HTML "artifact" especially) get their own lockdown: they can run and
      // load assets from beside them, but never reach the network, frame, or submit anywhere.
      const headers = new Headers(file.headers);
      headers.set("Content-Security-Policy", PREVIEW_CSP);
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(file.body, { status: file.status, statusText: file.statusText, headers });
    } catch {
      return new Response("Not allowed", { status: 403 });
    }
  });
}

module.exports = { refuseDebugging, blockNameLookups, registerFileScheme, lockDownWebContents, hardenSession };
