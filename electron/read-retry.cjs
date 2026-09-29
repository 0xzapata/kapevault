// Reads a small file beside the vault (settings.json, hello.json, touchid.json). Antivirus or a sync
// tool can hold a file for a moment (EBUSY / EPERM), which is not the same as the file being gone or
// damaged: a failed read is tried again briefly, then thrown. null = there is no such file.
const fs = require("node:fs");

const TRIES = 3;
const RETRY_MS = 100;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function readFileRetry(file) {
  for (let tries = 1; ; tries++) {
    try {
      return fs.readFileSync(file, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") return null;
      if (tries === TRIES) throw e;
      pause(RETRY_MS);
    }
  }
}

module.exports = { readFileRetry };
