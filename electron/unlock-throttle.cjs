// Wrong master passwords - unlock, change master password AND restore (restoring the vault file onto
// itself is also a way to test a password): one guess at a time, and after 5 misses in a row a
// growing pause (1s, 2s, 4s ... 30s). The rule is core/unlock-throttle.js (shared with the phone); this
// is the PC's queue and file around it. The count and the next allowed time live in a file, so
// quitting and relaunching does not reset them; a success deletes it.
const fs = require("node:fs");
const { parseVaultFile } = require("./vault-crypto.cjs");
const { writeFileAtomic } = require("./atomic-write.cjs");
const { ANY_TARGET, nextTargets, readTargets, targetWait, writeTargets } = require("../core/index.js");

const OTHER_FILE = "?other"; // the count of guesses at another file that names no salt

// file: unlock-throttle.json beside vaultFile. Its KDF salt is the target of every local guess
// (null when unreadable). ownSalt() can supply it instead. Returns throttledUnlock(attemptUnlock, { local, salt }).
/** @param {{ file: string, vaultFile?: string, now?: () => number, ownSalt?: () => string | null, onWait?: (ms: number) => void }} options */
function createUnlockThrottle({ file, vaultFile, now = () => Date.now(), ownSalt, onWait = (_ms) => {} }) {
  const currentSalt = ownSalt ?? (() => {
    try {
      return vaultFile ? parseVaultFile(fs.readFileSync(vaultFile))?.kdf.salt ?? null : null;
    } catch {
      return null;
    }
  });
  /** @type {import("../core/unlock-throttle.js").ThrottleTargets} */
  let throttle = {};
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
      if (Object.keys(throttle).length === 0) fs.rmSync(file, { force: true });
      else writeFileAtomic(file, writeTargets(throttle));
    } catch {
      // the unlock result still returns if the count cannot be saved
    }
  }

  // local: false for a password proven on another file (a backup, a kept copy, a snapshot under a new
  // master password): see core nextThrottle. salt: the KDF salt of the file the guess is aimed at; a local
  // guess is aimed at this vault's own file, one that names none is the ANY_TARGET count (core nextTargets).
  /** @param {() => any} attemptUnlock @param {{ local?: boolean, salt?: string }} [options] */
  function throttledUnlock(attemptUnlock, { local = true, salt } = {}) {
    const run = unlockQueue.then(async () => {
      // A refused save leaves a newer count in memory. A file reload must keep that count.
      const targets = readTargets(readText());
      for (const [key, state] of Object.entries(throttle)) {
        const stored = targets[key];
        if (!stored || state.failed > stored.failed || (state.failed === stored.failed && state.nextAt > stored.nextAt)) targets[key] = state;
      }
      throttle = targets;
      // A guess at another file that names none gets its own count, which an own-vault success never clears:
      // only ANY_TARGET (an unnamed guess at this vault, or an old file's count) is cleared that way.
      const key = salt || (local ? currentSalt() || ANY_TARGET : OTHER_FILE);
      // The longest pause of any file: dropping the oldest kept count (core MAX_TARGETS) must never give a
      // guesser free guesses back, so junk misses at other files cost as much as guessing on.
      const wait = Math.max(0, ...Object.keys(throttle).map((k) => targetWait(throttle, k, now())));
      if (wait > 0) {
        onWait(wait);
        await new Promise((r) => setTimeout(r, wait));
      }
      const result = await attemptUnlock();
      const next = nextTargets(throttle, key, result, { local, now: now() });
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
