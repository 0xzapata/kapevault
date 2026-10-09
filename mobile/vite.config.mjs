import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { buildNotices } from "./scripts/lib/notices.mjs";

// The built pages get a strict CSP: only the app's own script, style, font and images (plus blob: for
// an ID's photo, made in the page from the vault), no requests of any kind. The dev server (npm run sim:live, debug builds only) goes without it, since reloads need
// its websocket.
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'none'";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

// index.html is the vault. shell.html, the native shell check scripts/proof.mjs drives, goes only into
// debug builds (`vite build --mode debug`: npm run sim, apk and proof); a plain `vite build` leaves it
// out, and the release Gradle build refuses web assets that still hold it.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    {
      // Settings > About > Open source licences: the texts of what ships, made from the lockfile and the
      // committed Android list on every build, so they cannot go stale (scripts/lib/notices.mjs).
      name: "kapevault-notices",
      resolveId: (id) => (id === "virtual:kapevault-notices" ? "\0virtual:kapevault-notices" : null),
      load: (id) => (id === "\0virtual:kapevault-notices" ? `export default ${JSON.stringify(buildNotices())};` : null),
    },
    {
      name: "kapevault-csp",
      apply: "build",
      transformIndexHtml: (html) => html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  ],
  resolve: {
    // core/ is the only code shared with the PC app: the vault's data rules.
    alias: { "@core": here("../core/index.js") },
  },
  build: {
    // No data: URLs - the CSP would block them.
    assetsInlineLimit: 0,
    rolldownOptions: {
      input: { index: here("index.html"), ...(mode === "debug" && { shell: here("shell.html") }) },
      // React and the icon set get chunks of their own, which keeps the app's chunk under 500 kB. The
      // page preloads all three at once from the APK's own files, so unlock waits on no extra step.
      output: {
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "icons", test: /node_modules[\\/]@phosphor-icons[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [here("..")] }, // core/ sits beside mobile/
  },
}));
