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
