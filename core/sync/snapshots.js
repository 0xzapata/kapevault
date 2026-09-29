// Snapshots in R2 (SYNC.md 3.5): their names, which ones sync reads, and which ones a device thins out.
// A snapshot's key names the install that made it and a time from that device's clock; which one is
// newest is decided by R2's own LastModified, never the name.
import { MAX_VAULT_BYTES } from "../vault-format.js";

// kapevault/snapshots/[<install id>/]<time>[-before-restore].kapevault, and the same under bovault/
// from before the app was renamed. No install id folder = made before install ids.
const SNAPSHOT_KEYS = ["kapevault", "bovault"].map(
  (n) => new RegExp(`^${n}/snapshots/(?:([0-9a-f-]{36})/)?(\\d{4}-\\d{2}-\\d{2})T(\\d{2})-(\\d{2})-(\\d{2})-(\\d{3})Z(-before-restore)?\\.${n}$`),
);

// Where snapshots are listed: under the current name, and under the name from before the rename
// (those still list, restore and get thinned out).
export const SNAPSHOT_PREFIXES = ["kapevault/snapshots/", "bovault/snapshots/"];

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEAD_AFTER_MS = 180 * DAY_MS;
const KEEP_RECENT = 20; // every one of the newest 20
const KEEP_DAYS = 60; // then the newest of each local day for 60 days
const KEEP_UNDO_DAYS = 30; // every -before-restore snapshot, so a restore can be undone
// A name time further ahead than a wrong clock explains was not made by any device's clock: it is never
// ranked as the newest (names dated 2099 pushed the real ones out).
const FUTURE_MS = DAY_MS;
const TRIES = 3; // a device whose three newest snapshots cannot be opened is an error

/**
 * A snapshot's key, read: who made it (null before install ids), its name time, whether it is the copy a
 * restore replaced, and whether it predates the rename. Null for any other object.
 * @param {string} key @returns {{ owner: string | null, time: number, beforeRestore: boolean, legacy: boolean } | null}
 */
export function readSnapshotKey(key) {
  for (const [i, pattern] of SNAPSHOT_KEYS.entries()) {
    const m = pattern.exec(key);
    if (m) return { owner: m[1] ?? null, time: Date.parse(`${m[2]}T${m[3]}:${m[4]}:${m[5]}.${m[6]}Z`), beforeRestore: Boolean(m[7]), legacy: i === 1 };
  }
  return null;
}

/**
 * A new snapshot's key: kapevault/snapshots/<install id>/<UTC time>[-<note>].kapevault. No install id
 * (settings could not be read this run): no folder, like snapshots from before install ids.
 * @param {Date} now @param {string} [installId] @param {string} [note] "before-restore", or none
 */
export function snapshotKey(now, installId = "", note = "") {
  return `${SNAPSHOT_PREFIXES[0]}${installId ? `${installId}/` : ""}${now.toISOString().replace(/[:.]/g, "-")}${note ? `-${note}` : ""}.kapevault`;
}

/**
 * Which of an install's own snapshots to delete: every one of the newest 20, then each local day's
 * newest for 60 days are kept. A -before-restore snapshot is kept 30 days, the newest one for good, and
 * takes no place from the others. Keys that are not snapshots, or named more than a day ahead of `now`,
 * are never deleted.
 * @param {string[]} keys @param {number} now @returns {string[]}
 */
export function snapshotsToPrune(keys, now) {
  const time = (/** @type {string} */ key) => readSnapshotKey(key)?.time ?? null;
  const undo = (/** @type {string} */ key) => Boolean(readSnapshotKey(key)?.beforeRestore);
  const ours = keys.filter((k) => time(k) !== null && Number(time(k)) <= now + FUTURE_MS).sort((a, b) => Number(time(b)) - Number(time(a)));
  const daysKept = new Set();
  const regular = ours.filter((key) => !undo(key)).filter((key, i) => {
    const at = Number(time(key));
    const day = new Date(at).toLocaleDateString("en-CA"); // the local day, so "one per day" is the user's day
    const keep = i < KEEP_RECENT || (!daysKept.has(day) && now - at < KEEP_DAYS * DAY_MS);
    daysKept.add(day);
    return !keep;
  });
  const undone = ours.filter(undo).filter((key, i) => i > 0 && now - Number(time(key)) >= KEEP_UNDO_DAYS * DAY_MS);
  return [...regular, ...undone];
}

/**
 * The other devices' snapshots sync may read, per device, newest first by LastModified (the first
 * three: an older one is a safe subset when the newest will not open). Never this install's own, a
 * restore's undo copy, an un-named or pre-rename one, or a revoked device's. dead: nothing new in 180
 * days - read only by an explicit Sync now.
 * @param {{ key: string, lastModified: number | null }[]} objects
 * @param {{ installId: string, devices: Record<string, { revokedAt?: unknown }>, now: number }} context
 * @returns {{ device: string, keys: string[], lastSeen: number, dead: boolean }[]}
 */
export function pickSnapshots(objects, { installId, devices, now }) {
  const byDevice = new Map();
  for (const object of objects) {
    const info = readSnapshotKey(object.key);
    if (!info?.owner || info.legacy || info.beforeRestore || info.owner === installId || devices[info.owner]?.revokedAt) continue;
    // Bigger than any vault can be: never downloaded. The phone reads a reply whole, and a planted 2 GB
    // object crashed every sync (SECURITY-AUDIT-2026-09-28.md, L9).
    if (Number(object.size) > MAX_VAULT_BYTES) continue;
    if (!byDevice.has(info.owner)) byDevice.set(info.owner, []);
    byDevice.get(info.owner).push(object);
  }
  const when = (object) => object.lastModified ?? 0;
  return [...byDevice]
    .map(([device, list]) => {
      list.sort((a, b) => when(b) - when(a) || compareText(b.key, a.key));
      const lastSeen = when(list[0]);
      return { device, keys: list.slice(0, TRIES).map((o) => o.key), lastSeen, dead: now - lastSeen > DEAD_AFTER_MS };
    })
    .sort((a, b) => compareText(a.device, b.device));
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
