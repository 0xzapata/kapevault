// Wrong master passwords - unlock, change master password and restore - share one throttle, the same
// on the PC (electron/unlock-throttle.cjs) and the phone (mobile host/throttle.ts): after 5 misses in a
// row a growing pause (1 s, 2 s, 4 s ... 30 s). The count and the next allowed time live in
// unlock-throttle.json, so quitting does not reset them; a success deletes it. The real attack is offline
// against a copied file - scrypt and the master password rule cover that; this stops a script hammering
// the running app. Here: the file's rule. The queue (one guess at a time) and the file IO stay in each host.

export const MAX_UNLOCK_PAUSE_MS = 30 * 1000;
const FREE_MISSES = 5;

/** @typedef {{ failed: number, nextAt: number }} ThrottleState failed: misses in a row; nextAt: ms, 0 = now */

/**
 * The saved state, from the file's text. Nothing saved, unreadable or malformed: no misses.
 * @param {string | null | undefined} text @returns {ThrottleState}
 */
export function readThrottle(text) {
  try {
    const { failed, nextAt } = JSON.parse(text ?? "");
    if (Number.isInteger(failed) && failed > 0 && Number.isFinite(nextAt)) return { failed, nextAt };
  } catch {
    // none saved, or unreadable
  }
  return { failed: 0, nextAt: 0 };
}

/** How long the next guess waits, in ms (<= 0: none). Capped, so a clock set back or an edited file can
 * never hold the vault shut for long. @param {ThrottleState} state @param {number} now */
export const throttleWait = (state, now) => Math.min(MAX_UNLOCK_PAUSE_MS, state.nextAt - now);

/**
 * The state after a guess, or `state` itself when the guess changes nothing (nothing to save):
 * - rule: a new master password refused by the rule - the current one was never tried, not a guess;
 * - newer: a file a newer KAPEVault saved, refused whatever was typed - not a guess either;
 * - local false: a password proven on another file (a backup, a kept copy, a snapshot under a new master
 *   password). A miss there counts, but its success never clears the count - restoring your own backup
 *   at the lock screen used to reset it between guesses at this vault.
 * A success clears the count ({ failed: 0 }: the host deletes the file).
 * @param {ThrottleState} state @param {{ ok: boolean, rule?: boolean, newer?: boolean }} result
 * @param {{ local?: boolean, now: number }} context @returns {ThrottleState}
 */
export function nextThrottle(state, result, { local = true, now }) {
  if (result.rule || result.newer || (result.ok && !local)) return state;
  const failed = result.ok ? 0 : state.failed + 1;
  return { failed, nextAt: failed >= FREE_MISSES ? now + Math.min(MAX_UNLOCK_PAUSE_MS, 1000 * 2 ** (failed - FREE_MISSES)) : 0 };
}

// The count is kept per TARGET - the KDF salt of the vault file a guess is aimed at - so a success on
// one file never clears the misses at another: at the lock screen a restored backup of your own and the
// replaced real vault are two files, and unlocking the first used to wipe the count on the second.
// ANY_TARGET holds a guess that names no file, and a count saved before targets existed. A success on
// this vault clears its own target and ANY_TARGET (so a stale or unnamed count never locks it for good).
export const ANY_TARGET = "?";
const MAX_TARGETS = 16;

/** @typedef {Record<string, ThrottleState>} ThrottleTargets */

/**
 * Every saved count, from the file's text. The old file ({ failed, nextAt }) is the ANY_TARGET count.
 * @param {string | null | undefined} text @returns {ThrottleTargets}
 */
export function readTargets(text) {
  try {
    const { targets } = JSON.parse(text ?? "");
    if (targets && typeof targets === "object" && !Array.isArray(targets)) {
      /** @type {ThrottleTargets} */
      const out = {};
      for (const [key, value] of Object.entries(targets).slice(0, MAX_TARGETS)) {
        const state = readThrottle(JSON.stringify(value));
        if (state.failed > 0) out[key] = state;
      }
      return out;
    }
  } catch {
    // none saved, or unreadable
  }
  const old = readThrottle(text);
  return old.failed > 0 ? { [ANY_TARGET]: old } : {};
}

/** The file's text for these counts: the old shape while only ANY_TARGET has one, so an older build
 * still reads it. @param {ThrottleTargets} targets */
export function writeTargets(targets) {
  const keys = Object.keys(targets);
  if (keys.length === 1 && keys[0] === ANY_TARGET) return JSON.stringify(targets[ANY_TARGET]);
  return JSON.stringify({ targets });
}

/** How long a guess at `key` waits, in ms (<= 0: none). @param {ThrottleTargets} targets @param {string} key @param {number} now */
export const targetWait = (targets, key, now) => (targets[key] ? throttleWait(targets[key], now) : 0);

/**
 * The counts after a guess at `key`, or `targets` itself when nothing changes. The rules of nextThrottle
 * apply to that target's count; a local success clears the target and ANY_TARGET.
 * @param {ThrottleTargets} targets @param {string} key @param {{ ok: boolean, rule?: boolean, newer?: boolean }} result
 * @param {{ local?: boolean, now: number }} context @returns {ThrottleTargets}
 */
export function nextTargets(targets, key, result, { local = true, now }) {
  const current = targets[key] ?? { failed: 0, nextAt: 0 };
  const next = nextThrottle(current, result, { local, now });
  if (next === current) return targets;
  if (next.failed === 0) {
    const { [key]: _gone, [ANY_TARGET]: _any, ...rest } = targets;
    return rest; // a success: this target and the unnamed count are cleared
  }
  // A miss keeps every other count, the unnamed one too. Over the cap, the counts with the fewest misses
  // go (the oldest first among equals): a run of junk misses at other files must never push out the count
  // at the file being guessed at.
  const { [key]: _gone, ...rest } = targets;
  const kept = Object.entries({ ...rest, [key]: next });
  const drop = new Set(
    kept
      .map(([k, s], i) => ({ k, failed: s.failed, i }))
      .sort((a, b) => a.failed - b.failed || a.i - b.i)
      .slice(0, Math.max(0, kept.length - MAX_TARGETS))
      .map((e) => e.k),
  );
  return Object.fromEntries(kept.filter(([k]) => !drop.has(k)));
}
