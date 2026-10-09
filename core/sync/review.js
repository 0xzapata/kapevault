// The mass-change gate (SYNC.md 3.9): a sync that would delete or change many items, replace the
// vault with a restored one, or move to another master password waits until the user has looked.
// Pure: the host merges, asks reviewReasons, and commits only on [] or the user's Apply.
import { splitGroups } from "./groups.js";
import { SECRET_GROUPS } from "./merge.js";
import { canonical } from "./stamp.js";

// A share of the vault counts only from 3 deletes: one or two never wait, however small the vault.
export const REVIEW_LIMITS = { deletes: 5, deleteShare: 0.1, deleteShareMin: 3, secretItems: 20 };

// The title merge.js gives a conflict copy: "<title> (conflict copy, <device>, <YYYY-MM-DD>)", or
// "changed after closing" for a closed account.
const COPY_TITLE = / \((?:conflict copy|changed after closing), (.+), (\d{4}-\d{2}-\d{2})\)$/;

/** An item a sync made from the losing side of a conflict, until the user renames or deletes it. */
export const isConflictCopy = (/** @type {string} */ title) => COPY_TITLE.test(title);

/**
 * A conflict copy's title, read: the title it was copied from, the device whose version it holds and
 * the day of that version. Null for any other title.
 * @param {string} title @returns {{ title: string, device: string, day: string } | null}
 */
export function readCopyTitle(title) {
  const parts = COPY_TITLE.exec(title);
  return parts ? { title: title.slice(0, parts.index), device: parts[1], day: parts[2] } : null;
}

/**
 * What a sync would do to this device's items, by id. A use elsewhere (lastUsedAt) is not a change.
 * secretItems: changed items whose secrets changed (a password, a 2FA key...).
 * @param {{ entries: any[] }} before @param {{ entries: any[] }} after
 * @returns {{ added: string[], changed: string[], deleted: string[], copies: string[], secretItems: number }}
 */
export function syncChanges(before, after) {
  const was = new Map(before.entries.map((e) => [e.id, e]));
  /** @type {{ added: string[], changed: string[], deleted: string[], copies: string[], secretItems: number }} */
  const out = { added: [], changed: [], deleted: [], copies: [], secretItems: 0 };
  for (const entry of after.entries) {
    const old = was.get(entry.id);
    was.delete(entry.id);
    if (!old) out[isConflictCopy(entry.title) ? "copies" : "added"].push(entry.id);
    else if (entry !== old) {
      const [then, now] = [splitGroups(old), splitGroups(entry)];
      const differs = (name) => canonical(then[name]) !== canonical(now[name]);
      if (!Object.keys({ ...then, ...now }).some(differs)) continue;
      out.changed.push(entry.id);
      if (SECRET_GROUPS.some(differs)) out.secretItems++;
    }
  }
  out.deleted.push(...was.keys());
  return out;
}

/**
 * Why a sync must wait for the user, or [] when it may go ahead: more than 5 deletes, or more than 10%
 * of the items when that is 3 or more, secrets changed on more than 20 items, a restored vault (epoch),
 * another master password (key).
 * @param {{ deleted: string[], secretItems: number }} changes @param {number} entryCount this device's items before the sync
 * @param {{ epoch?: boolean, key?: boolean }} [also]
 * @returns {("deletes" | "secrets" | "epoch" | "key")[]}
 */
export function reviewReasons(changes, entryCount, { epoch = false, key = false } = {}) {
  /** @type {("deletes" | "secrets" | "epoch" | "key")[]} */
  const reasons = [];
  const deleted = changes.deleted.length;
  const bigShare = deleted >= REVIEW_LIMITS.deleteShareMin && deleted > entryCount * REVIEW_LIMITS.deleteShare;
  if (deleted > REVIEW_LIMITS.deletes || bigShare) reasons.push("deletes");
  if (changes.secretItems > REVIEW_LIMITS.secretItems) reasons.push("secrets");
  if (epoch) reasons.push("epoch");
  if (key) reasons.push("key");
  return reasons;
}
