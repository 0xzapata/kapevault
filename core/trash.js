// Trash: deleting an item moves it here for 30 days. An item in the Trash is an ordinary entry with a
// `trashedAt` (a UTC ISO timestamp, like a history row's changedAt). Every list the user sees is built
// from `liveEntries`, so a new place that lists items has one helper to call and nothing to remember.
// Syncing it needs nothing new: `trashedAt` is its own field group (sync/groups.js), so a trash or a
// restore on one device reaches the other, and a purge is the delete sync already carries.
import { findEntry, isTrashed, removeEntries } from "./entries.js";
/** @import { Entry, VaultData } from "./entries.js" */

export const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The items that are not in the Trash: what every list, search, count and check works from. @template {Record<string, any>} T @param {T[]} entries @returns {T[]} */
export const liveEntries = (entries) => entries.filter((e) => !isTrashed(e));

// When the Trash lets go of an item. A timestamp that does not parse never expires (kept, not lost).
// `trashedAt` is written by the device that trashed the item, and a phone whose clock is months behind
// writes a date months ago - read against this device's clock, that would purge a fresh trash everywhere.
// The sync stamp of the same change (SYNC.md 3.4) is a hybrid clock that never trails what its device had
// last synced, so the stay starts at the later of the two. Without `data` (or without a stamp, a vault
// from before sync) it is trashedAt alone.
function expiresAt(entry, data) {
  const trashed = Date.parse(entry.trashedAt);
  if (Number.isNaN(trashed)) return Infinity;
  const stamped = data?.sync?.meta?.[entry.id]?.g?.trash?.at?.[0];
  return Math.max(trashed, Number.isSafeInteger(stamped) ? stamped : 0) + TRASH_DAYS * DAY_MS;
}

/** Whole days left before the Trash lets go (a clock set ahead never shows more than 30). @param {Entry} entry @param {number} [now] ms @param {VaultData} [data] the vault, for its sync stamps */
export function trashDaysLeft(entry, now = Date.now(), data) {
  return Math.max(0, Math.min(TRASH_DAYS, Math.ceil((expiresAt(entry, data) - now) / DAY_MS)));
}

/**
 * Moves an item to the Trash. A closed account's tombstone holds no secret and is not worth a month in
 * the Trash: it is deleted outright (false), as it always was.
 * @param {VaultData} data @param {string} id @param {number} [now] ms @returns {boolean} true when it went to the Trash
 */
export function trashEntry(data, id, now = Date.now()) {
  const entry = findEntry(data, id);
  if (entry.lifecycle?.state === "gone") {
    removeEntries(data, new Set([id]));
    return false;
  }
  if (isTrashed(entry)) return true;
  data.entries = data.entries.map((e) => (e.id === id ? { ...e, trashedAt: new Date(now).toISOString() } : e));
  return true;
}

/** @param {VaultData} data @param {string} id */
export function restoreEntry(data, id) {
  if (!isTrashed(findEntry(data, id))) throw new Error("That item is not in the Trash");
  data.entries = data.entries.map((e) => (e.id === id ? { ...e, trashedAt: undefined } : e));
}

/** "Delete now": only an item already in the Trash can be deleted for good. @param {VaultData} data @param {string} id */
export function deleteForever(data, id) {
  if (!isTrashed(findEntry(data, id))) throw new Error("That item is not in the Trash");
  removeEntries(data, new Set([id]));
}

/** "Empty Trash". @param {VaultData} data @returns {number} how many went */
export function emptyTrash(data) {
  const ids = new Set(data.entries.filter(isTrashed).map((e) => e.id));
  if (ids.size) removeEntries(data, ids);
  return ids.size;
}

/** Deletes what has been in the Trash 30 days (the delete sync carries). @param {VaultData} data @param {number} [now] ms @returns {number} how many went */
export function purgeTrash(data, now = Date.now()) {
  const ids = new Set(data.entries.filter((e) => isTrashed(e) && expiresAt(e, data) <= now).map((e) => e.id));
  if (ids.size) removeEntries(data, ids);
  return ids.size;
}

/** Is anything past its 30 days? A cheap check before a save is made for it. @param {VaultData} data @param {number} [now] ms */
export const hasExpiredTrash = (data, now = Date.now()) => data.entries.some((e) => isTrashed(e) && expiresAt(e, data) <= now);
