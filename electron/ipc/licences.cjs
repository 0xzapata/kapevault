// Settings > General > Open source licences: the four texts the installer ships (LICENSE,
// LICENSE-EXCEPTION, NOTICE, THIRD-PARTY-NOTICES.txt). The page passes nothing and names no path: main
// reads this fixed list, from resources/legal/ when packaged, from the repo when not.
const fs = require("node:fs");
const path = require("node:path");

const FILES = [
  { name: "LICENSE", file: "LICENSE" },
  { name: "LICENSE-EXCEPTION", file: "LICENSE-EXCEPTION" },
  { name: "NOTICE", file: "NOTICE" },
  { name: "THIRD-PARTY-NOTICES", file: "THIRD-PARTY-NOTICES.txt" },
];
const MAX_BYTES = 4 * 1024 * 1024; // the real set is well under 1 MB; a bigger file is not one of ours

/**
 * Where each text lives. Packaged: package.json build.extraResources puts all four in
 * resources/legal/. Unpacked: the repo-root files, and the notices script's output in dist/legal/.
 * @param {{ packaged: boolean, resourcesPath: string, root: string }} where
 * @returns {{ name: string, path: string }[]}
 */
function licencePaths({ packaged, resourcesPath, root }) {
  return FILES.map(({ name, file }) => ({
    name,
    path: packaged ? path.join(resourcesPath, "legal", file) : path.join(root, file === "THIRD-PARTY-NOTICES.txt" ? "dist/legal" : "", file),
  }));
}

/**
 * Reads the texts. A missing or oversized file is left out, never an error: a dev tree that has not
 * been built has no notices file yet.
 * @param {{ name: string, path: string }[]} list
 * @returns {{ name: string, text: string }[]}
 */
function readLicences(list) {
  const out = [];
  for (const { name, path: p } of list) {
    try {
      if (fs.statSync(p).size > MAX_BYTES) continue;
      out.push({ name, text: fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n") });
    } catch {
      // missing or unreadable: skipped
    }
  }
  return out;
}

/** @param {{ handle: (channel: string, fn: (...args: any[]) => any) => void, app: { isPackaged: boolean, getVersion: () => string }, resourcesPath: string, root: string }} deps */
function register({ handle, app, resourcesPath, root }) {
  handle("app:licences", () => readLicences(licencePaths({ packaged: app.isPackaged, resourcesPath, root })));
  handle("app:version", () => app.getVersion());
}

module.exports = { register, licencePaths, readLicences, MAX_BYTES };
