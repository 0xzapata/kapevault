// The app's own page is served from app://kapevault/ (files of the dist folder only), not file://, so
// Electron's GrantFileProtocolExtraPrivileges fuse can stay off. Previews use kapevault-file (hardening.cjs).
const fs = require("node:fs");
const path = require("node:path");

const APP_ORIGIN = "app://kapevault";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

// The file an app:// URL names, or null: another host, a path that leaves `root` (.. or encoded ..,
// a backslash, a drive letter, a NUL) or anything that is not inside it. The root is "/" -> index.html.
function resolveAppFile(root, requestUrl) {
  let url;
  let pathname;
  try {
    url = new URL(requestUrl);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (url.protocol !== "app:" || url.hostname !== "kapevault" || url.port || url.username || url.password) return null;
  if (pathname.includes("\0")) return null;
  const base = path.resolve(root);
  const target = path.resolve(base, "." + (pathname === "/" ? "/index.html" : pathname));
  return target.startsWith(base + path.sep) ? target : null;
}

// registerSchemesAsPrivileged must run before app ready.
function registerAppScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

function handleAppScheme(protocol, root) {
  protocol.handle("app", async (request) => {
    const file = resolveAppFile(root, request.url);
    if (!file) return new Response("Not found", { status: 404 });
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, { headers: { "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

module.exports = { APP_ORIGIN, resolveAppFile, registerAppScheme, handleAppScheme };
