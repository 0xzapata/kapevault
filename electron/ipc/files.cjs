// File browser. Every call re-checks the path against the folders linked in the unlocked vault.
const path = require("node:path");
const { shell } = require("electron");
const { resolveInRoot, checkPath, listDir, readTextHead, canOpenInApp } = require("../file-access.cjs");

const TEXT_PREVIEW_BYTES = 1024 * 1024;

function register({ handle, vault }) {
  handle("files:list", (root, rel) => {
    const dir = resolveInRoot(vault.linkedFolders(), String(root), String(rel ?? ""));
    const { items, total } = listDir(dir);
    return { dir, total, items: items.map((i) => ({ ...i, path: path.join(dir, i.name) })) };
  });
  handle("files:open", async (file) => {
    const target = checkPath(vault.linkedFolders(), String(file));
    if (!canOpenInApp(target)) {
      shell.showItemInFolder(target); // only known documents open; anything that could run code is revealed
      return "revealed";
    }
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return "opened";
  });
  handle("files:readText", (file) => readTextHead(checkPath(vault.linkedFolders(), String(file)), TEXT_PREVIEW_BYTES));
  handle("files:reveal", (file) => shell.showItemInFolder(checkPath(vault.linkedFolders(), String(file))));
}

module.exports = { register };
