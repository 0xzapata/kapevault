// Generated passwords: the last values that left the password generator (copied, or put into a form
// field), kept inside the encrypted vault as `genHistory` [{ value, at }], newest first. A lock, a
// sleep or a crash while the item form is open throws the form away, and a password already pasted into
// a site's change-password page then exists nowhere else - this is where it can be found again.
// The list is this device's own (SYNC.md 3.8): never merged. Every value is a secret, so the page gets
// the times only (generatedView) and asks for ONE value by its place in the list (generatedValue).
// Every change replaces `data.genHistory` and never edits it in place, so a failed save puts back the old list.
/** @import { VaultData } from "./entries.js" */

export const GENERATED_LIMIT = 20;
export const GENERATED_DAYS = 90;
// Far longer than the generator makes (64); only a stop for a page sending something else.
export const MAX_GENERATED_LENGTH = 256;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The rows that are still kept, newest first: the newest 20 not older than 90 days. A row whose time
 * cannot be read is kept (never lost on a guess). The stored array itself when nothing is dropped.
 * @param {VaultData} data @param {number} [now] ms
 * @returns {{ value: string, at: string }[]}
 */
export function recentGenerated(data, now = Date.now()) {
  const list = Array.isArray(data.genHistory) ? data.genHistory : [];
  const cutoff = now - GENERATED_DAYS * DAY_MS;
  const fresh = list.filter((g) => !(Date.parse(g.at) < cutoff)).slice(0, GENERATED_LIMIT);
  return fresh.length === list.length ? list : fresh;
}

/**
 * Keeps a value the generator handed out. The time is the caller's clock, not the page's. A value
 * already in the list stays as it is, with its first time (copied, then used, is one row).
 * @param {VaultData} data @param {string} value @param {number} [now] ms
 */
export function recordGenerated(data, value, now = Date.now()) {
  if (typeof value !== "string" || !value || value.length > MAX_GENERATED_LENGTH) throw new Error("Nothing to keep");
  const kept = recentGenerated(data, now);
  const next = kept.some((g) => g.value === value) ? kept : [{ value, at: new Date(now).toISOString() }, ...kept].slice(0, GENERATED_LIMIT);
  if (next !== data.genHistory) data.genHistory = next;
}

/** Lets go of what is past 90 days, and of the field itself when nothing is left. @param {VaultData} data @param {number} [now] ms */
export function purgeGenerated(data, now = Date.now()) {
  if (!Array.isArray(data.genHistory)) return;
  const kept = recentGenerated(data, now);
  if (kept !== data.genHistory) data.genHistory = kept.length ? kept : undefined;
}

/** "Clear" in the generator's list. @param {VaultData} data */
export function clearGenerated(data) {
  data.genHistory = undefined;
}

/** What the page may see: when each was made, never the value. @param {VaultData} data @param {number} [now] ms @returns {{ at: string }[]} */
export function generatedView(data, now = Date.now()) {
  return recentGenerated(data, now).map((g) => ({ at: g.at }));
}

/** ONE value, by its place in generatedView's list; "" for a place that is not there. @param {VaultData} data @param {number} index @param {number} [now] ms @returns {string} */
export function generatedValue(data, index, now = Date.now()) {
  return recentGenerated(data, now)[index]?.value ?? "";
}
