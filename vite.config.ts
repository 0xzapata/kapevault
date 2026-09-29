import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Production pages get a strict CSP: nothing loads or connects outside the app itself.
// Dev skips it because Vite's HMR needs inline scripts and a websocket.
// kapevault-file: is the main process's checked file protocol (previews of linked folders only).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: kapevault-file:",
  "media-src kapevault-file:",
  "frame-src kapevault-file:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "kapevault-csp",
    apply: "build",
    transformIndexHtml: (html) => html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  // Relative asset paths so dist/index.html works when Electron loads it from disk.
  base: "./",
  resolve: {
    alias: { "@": "/src" },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});
