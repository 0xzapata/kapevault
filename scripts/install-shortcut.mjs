// npm run shortcut - add KAPEVault to the Start menu (and so to Windows Search). Re-run after moving
// the repo or reinstalling node_modules. The shortcut opens the built app, so run `npm run build`
// (or npm start / e2e, which build) after code changes.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env; // see launch-electron.mjs
const main = fileURLToPath(new URL("./shortcut-main.cjs", import.meta.url));
spawn(require("electron"), [main], { stdio: "inherit", env }).on("exit", (code) => process.exit(code ?? 0));
