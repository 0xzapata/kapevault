// Which folders the vault may link or import (audit finding L5, SECURITY-AUDIT-2026-09-28.md): never a
// whole drive or the home folder. Pure path rules - no vault state - used by saveEntry, importEntries and
// linkedFolders in vault-session.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isInside } = require("./file-access.cjs");

// An import file can come from someone else: a drive or home folder would open far more to previews
// than anyone means to share. Core has already refused network folders by name, so this path is local.
function checkImportFolder(location, where) {
  if (tooWide(location)) throw new Error(`${where}: a whole drive or home folder cannot be imported. Link a folder inside it.`);
}

// \\?\C:\Users\me and \\.\C: are this PC's own disk under a network-looking prefix, and
// \\localhost\C$ (or any X$ admin share) is a whole drive: refused by name, before any disk call.
const refusedByName = (location) => /^[\\/]{2}[?.][\\/]/.test(location) || /^[\\/]{2}(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)([\\/]|$)/i.test(location) || /^[\\/]{2}[^\\/]+[\\/][a-z]\$([\\/]|$)/i.test(location);

// A whole drive, the home folder or one of its parents: every file on it would open to previews and
// files:readText. Judged by the real path; only for paths already known not to be network paths.
function tooWide(location) {
  const real = path.isAbsolute(location) && realFolder(path.resolve(location));
  // isInside compares case-insensitively on Windows and also catches C:\Users (an ancestor of home).
  return Boolean(real) && (path.parse(real).root === real || isInside(real, realFolder(os.homedir())));
}

// Where a local path really leads, so a junction (C:\Documents and Settings) or an 8.3 short name
// (C:\Users\EXAMPL~1) is judged as the folder it opens. A path that does not exist yet is judged by
// its nearest existing parent. Only for paths already known not to be network paths.
function realFolder(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    const parent = path.dirname(p);
    return parent === p ? p : path.join(realFolder(parent), path.basename(p));
  }
}

module.exports = { checkImportFolder, tooWide, refusedByName };
