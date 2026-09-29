// Hybrid logical clock (SYNC.md 3.4): [ms, counter, installId], compared in that order. It follows
// wall time but never runs backwards, so an edit made after seeing another always sorts after it even
// when the two devices' clocks disagree. A clock from more than a day in the future is refused.

/** @typedef {[number, number, string]} Hlc */

export const MAX_AHEAD_MS = 24 * 60 * 60 * 1000;
export const ZERO = /** @type {Hlc} */ ([0, 0, ""]);

/** @param {Hlc} a @param {Hlc} b @returns {number} negative, 0 or positive */
export function compare(a, b) {
  return a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
}

/** @param {Hlc} a @param {Hlc} b */
export const max = (a, b) => (compare(a, b) >= 0 ? a : b);

/** The stamp for a local change: after both the wall clock and everything this vault has seen. */
export function tick(/** @type {Hlc} */ clock, /** @type {number} */ now, /** @type {string} */ installId) {
  return now > clock[0] ? /** @type {Hlc} */ ([now, 0, installId]) : /** @type {Hlc} */ ([clock[0], clock[1] + 1, installId]);
}

/** True when a remote clock is too far ahead of this device's wall clock to be trusted. */
export const tooFarAhead = (/** @type {Hlc} */ remote, /** @type {number} */ now) => remote[0] > now + MAX_AHEAD_MS;

/** A well-formed clock value (from a decrypted snapshot, so still checked). */
export function isHlc(value) {
  return Array.isArray(value) && value.length === 3 && Number.isSafeInteger(value[0]) && value[0] >= 0 && Number.isSafeInteger(value[1]) && value[1] >= 0 && typeof value[2] === "string";
}
