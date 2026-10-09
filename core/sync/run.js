// The pure steps of one sync run (SYNC.md 3.5-3.9), the same on the PC (electron/sync.cjs) and the phone
// (mobile host/sync.ts): merging the downloaded snapshots in, the sync log, and what a review shows.
// Listing, downloads, the commit and when a run may start stay in each host.
import { dueToNotes } from "../due-to-note.js";
import { payeeToNotes } from "../payee-to-note.js";
import { tooFarAhead } from "./hlc.js";
import { adoptEpoch, isNewerEpoch, merge, VaultMismatchError } from "./merge.js";
import { NewerVaultError } from "../vault-format.js";
import { readSync, registerDevice } from "./shape.js";

const LOG_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{ device: string, key: string, data: any, salt: string }} Remote another device's snapshot, opened
 * @typedef {{ at: number, with?: string[], added?: number, changed?: number, deleted?: number, copies?: number,
 *   review?: boolean, error?: string, renewedId?: boolean }} LogEntry
 */

/** How the user sees another device: the name it gave itself, never its install id. */
export const nameOf = (/** @type {Record<string, { name?: string }>} */ devices, /** @type {string} */ id) => devices[id]?.name ?? "Another device";

/** What the sync status says of a device whose snapshot is from a newer KAPEVault than this app. */
export const newerProblem = (/** @type {string} */ name) => `${name} runs a newer KAPEVault. Update this app.`;

/**
 * Each remote in turn into the local vault. A device that cannot be merged is left out and named in
 * `problems` - one from a newer KAPEVault too, whose snapshot this app must not touch. epoch: a device restored a backup as the vault on all devices, and this one adopts it
 * (SYNC.md 3.7). From its first run this install is in the device list, so a device that restores or
 * merges its vault names it at once (written once: the same record is a no-op).
 * @template {{ sync: any }} T
 * @template {Remote} R
 * @param {T} local @param {R[]} remotes
 * @param {{ installId: string, device: { name: string, platform: string }, now: number, sha256: (text: string) => string }} context
 * @returns {{ data: T, merged: (R & { name: string })[], problems: string[], epoch: boolean }}
 */
export function mergeRemotes(local, remotes, { installId, device, now, sha256 }) {
  let data = local;
  let epoch = false;
  const merged = [];
  const problems = [];
  for (const remote of remotes) {
    let theirs;
    try {
      theirs = { ...remote.data, entries: payeeToNotes(dueToNotes(remote.data.entries)), sync: readSync(remote.data, remote.salt) };
    } catch (e) {
      if (!(e instanceof NewerVaultError)) throw e;
      problems.push(newerProblem(nameOf(data.sync.devices, remote.device)));
      continue;
    }
    const name = nameOf({ ...theirs.sync.devices, ...data.sync.devices }, remote.device);
    if (tooFarAhead(theirs.sync.clock, now)) {
      problems.push(`${name}'s clock is ${Math.ceil((theirs.sync.clock[0] - now) / DAY_MS)} days ahead. Fix its date, then Sync now.`);
      continue;
    }
    try {
      const { data: next, report } = merge(data, theirs, { sha256 });
      if (!report.epochDiffers) data = next;
      else if (isNewerEpoch(theirs.sync.epoch, data.sync.epoch)) {
        data = adoptEpoch(data, theirs, { sha256 }).data;
        epoch = true;
      } else {
        problems.push(`${name} has not taken the restored vault yet.`); // it adopts this one on its next sync
        continue;
      }
      merged.push({ ...remote, name });
    } catch (e) {
      if (!(e instanceof VaultMismatchError)) throw e;
      problems.push(`This bucket holds a different vault from ${name}.`);
    }
  }
  const sync = registerDevice(data.sync, { installId, ...device, now });
  return { data: sync === data.sync ? data : { ...data, sync }, merged, problems, epoch };
}

/**
 * A run's line in the sync log: the devices it merged or found up to date, plus what it did.
 * @param {number} at @param {{ remotes: { device: string }[], upToDate: string[] }} done @param {Partial<LogEntry>} counts
 * @returns {LogEntry}
 */
export function logEntry(at, { remotes, upToDate }, counts) {
  return { at, with: [...remotes.map((r) => r.device), ...upToDate], ...counts };
}

/**
 * The log with `entry` first, at most 50: a quiet run replaces the quiet run before it, so the log keeps
 * what happened.
 * @param {LogEntry[] | undefined} log @param {LogEntry} entry @returns {LogEntry[]}
 */
export function withEntry(log = [], entry) {
  const quiet = (/** @type {LogEntry | undefined} */ e) => e && !e.error && !e.review && !e.renewedId && !e.added && !e.changed && !e.deleted && !e.copies;
  const rest = quiet(entry) && quiet(log[0]) && String(log[0].with) === String(entry.with) ? log.slice(1) : log;
  return [entry, ...rest].slice(0, LOG_SIZE);
}

/**
 * What a held review shows: who, why, and the items by title.
 * @template {string} W
 * @param {{ entries: { id: string, title: string }[] }} before
 * @param {{ data: { entries: { id: string, title: string }[] }, merged: { name: string }[] }} result
 * @param {ReturnType<typeof import("./review.js").syncChanges>} changes @param {W[]} reasons
 */
export function reviewView(before, result, changes, reasons) {
  const titleIn = (/** @type {{ id: string, title: string }[]} */ entries) => (/** @type {string} */ id) => entries.find((e) => e.id === id)?.title ?? "";
  const after = titleIn(result.data.entries);
  return {
    from: result.merged.map((r) => r.name),
    reasons,
    added: changes.added.map(after),
    changed: changes.changed.map(after),
    deleted: changes.deleted.map(titleIn(before.entries)),
    copies: changes.copies.map(after),
    secretItems: changes.secretItems,
  };
}
