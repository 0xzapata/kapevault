// Replaces a file so that a crash or a power cut leaves either the old contents or the new ones,
// never an empty or half-written file. Used for the vault and for every small file beside it.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// A fresh temp name beside the file (never an existing file: wx), flushed to disk, then renamed over
// it in one step. The temp file is removed when anything fails.
function writeFileAtomic(file, data, { mode } = {}) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(tmp, "wx", mode);
  try {
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd); // without it a power cut can leave the renamed file empty
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  syncDir(dir);
}

// The rename is only on disk once its folder is flushed. Windows cannot flush a folder (NTFS journals
// the rename itself), and elsewhere it is best effort: the file is already safe either way.
function syncDir(dir) {
  if (process.platform === "win32") return;
  let fd;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch {
    // some file systems refuse; the old or the new file is there either way
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { writeFileAtomic };
