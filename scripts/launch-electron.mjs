import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// VS Code terminals export ELECTRON_RUN_AS_NODE=1, which makes electron.exe boot as plain Node
// (require("electron") then returns a path string and the app crashes). Strip it for the app.
export function launchElectron(extraEnv = {}) {
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  return spawn(require("electron"), ["."], { stdio: "inherit", env: { ...env, ...extraEnv } });
}
