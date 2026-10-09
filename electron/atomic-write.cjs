// Replaces a file so that a crash or a power cut leaves either the old contents or the new ones,
// never an empty or half-written file. Used for the vault and for every small file beside it.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// A fresh temp name beside the file (never an existing file: wx), flushed to disk, then renamed over
// it in one step. The temp file is removed when anything fails.
function writeFileAtomic(file, data, { mode = 0o600 } = {}) {
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

// A hard kill or a power cut between the open and the rename leaves the temp behind, and it is the vault
// as it was (it opens with the master password of that day - what the no-.bak rule avoids). Swept when
// the session is made; only our own name pattern, and only files older than any write can run, so a
// second KAPEVault (a dev run) never loses one in flight.
const OWN_TEMP = /^\..+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
const STALE_MS = 60 * 60 * 1000;

function sweepStale(dir, now = Date.now()) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => OWN_TEMP.test(name));
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      if (now - fs.statSync(file).mtimeMs > STALE_MS) fs.rmSync(file, { force: true });
    } catch {
      // in use or gone
    }
  }
}

module.exports = { writeFileAtomic, sweepStale };
