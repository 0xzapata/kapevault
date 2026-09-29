// Wrong master passwords - unlock, change master password AND restore (restoring the vault file onto
// itself is also a way to test a password): one guess at a time, and after 5 misses in a row a
// growing pause (1s, 2s, 4s ... 30s). The rule is core/unlock-throttle.js (shared with the phone); this
// is the PC's queue and file around it. The count and the next allowed time live in a file, so
// quitting and relaunching does not reset them; a success deletes it.
const fs = require("node:fs");
const { writeFileAtomic } = require("./atomic-write.cjs");
const { nextThrottle, readThrottle, throttleWait } = require("../core/index.js");

// file: unlock-throttle.json beside the vault. Returns throttledUnlock(attemptUnlock, { local }).
function createUnlockThrottle({ file, now = () => Date.now() }) {
  let throttle = readThrottle(readText());
  let unlockQueue = Promise.resolve();

  function readText() {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return null; // none saved, or unreadable
    }
  }

  // Atomic: a crash leaves the old count or the new one.
  function saveThrottle() {
    try {
      if (throttle.failed === 0) fs.rmSync(file, { force: true });
      else writeFileAtomic(file, JSON.stringify(throttle));
    } catch {
      // the count still holds in memory for this run
    }
  }

  // local: false for a password proven on another file (a backup, a kept copy, a snapshot under a new
  // master password): see core nextThrottle.
  function throttledUnlock(attemptUnlock, { local = true } = {}) {
    const run = unlockQueue.then(async () => {
      const wait = throttleWait(throttle, now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const result = await attemptUnlock();
      const next = nextThrottle(throttle, result, { local, now: now() });
      if (next !== throttle) {
        throttle = next;
        saveThrottle();
      }
      return result;
    });
    unlockQueue = run.catch(() => {});
    return run;
  }

  return throttledUnlock;
}

module.exports = { createUnlockThrottle };
