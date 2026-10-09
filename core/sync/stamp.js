// Stamping (SYNC.md 3.2): what this device changed, derived from the data itself. The host calls
// stamp() on every save with the vault as last saved and the vault about to be written, so no write
// path can forget it, and repair() on open to catch up with what an app version without sync changed.
// Pure: the same inputs always give the same output. Neither ever edits the sync object it is given.
import { splitGroups, SPACE_GROUP } from "./groups.js";
import { tick } from "./hlc.js";

/** @import { Sync } from "./shape.js" */

/**
 * @typedef {{ installId: string, now: number, sha256: (text: string) => string }} StampContext
 * @typedef {{ key: string, content: Record<string, any> | null, changed?: string[], clearsHistory?: boolean }} Change
 *   content: the item's groups, null when it was deleted; changed: the groups this device wrote
 */

/** JSON with every object's keys sorted, so equal content gives equal text - and hash - on every device. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const fields = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${fields.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A space's one field group: everything but its id. Its key in `meta` and `gone` is spaceKey(id). */
export function spaceGroups({ id, ...fields }) {
  return { [SPACE_GROUP]: fields };
}

/** A space's key in `meta`, `gone` and `histFloor`; an item's is its own id. @param {string} id */
export const spaceKey = (id) => `s:${id}`;

/** The hash `meta.h` holds: SHA-256 (the host's) of an item's field groups, canonical. */
export const contentHash = (/** @type {Record<string, any>} */ groups, /** @type {(text: string) => string} */ sha256) => sha256(canonical(groups));

/**
 * The sync object for `current`, with every change since `saved` stamped by this device. No install
 * id (settings.json unreadable this run) stamps nothing; the next open's repair() catches up.
 * @param {{ entries: any[], spaces: any[] }} saved @param {{ entries: any[], spaces: any[], sync: Sync }} current
 * @param {StampContext} context @returns {Sync}
 */
export function stamp(saved, current, context) {
  if (!context.installId) return current.sync;
  const live = new Set(current.entries.map((e) => e.id));
  const entries = { key: (e) => e.id, content: splitGroups, compared: (e) => splitGroups(withoutDeadLink(e, live)) };
  const spaces = { key: (s) => spaceKey(s.id), content: spaceGroups, compared: spaceGroups };
  const changes = [...diff(saved.entries, current.entries, entries), ...diff(saved.spaces, current.spaces, spaces)];
  return record(current.sync, changes, context);
}

/**
 * Repair on open: an item whose content no longer matches its hash was edited by an app version
 * without sync - stamped as this device's edit, of every group (which one changed is unknown). An id
 * with metadata but no item and no tombstone was deleted by one - tombstoned.
 * @param {{ entries: any[], spaces: any[], sync: Sync }} data @param {StampContext} context @returns {Sync}
 */
export function repair(data, context) {
  const { sync } = data;
  if (!context.installId) return sync;
  const items = new Map(/** @type {[string, any][]} */ ([...data.entries.map((e) => [e.id, splitGroups(e)]), ...data.spaces.map((s) => [spaceKey(s.id), spaceGroups(s)])]));
  const changes = [];
  for (const [key, content] of items) {
    const meta = sync.meta[key];
    if (meta && meta.h !== contentHash(content, context.sha256)) changes.push({ key, content, changed: [...new Set([...Object.keys(content), ...Object.keys(meta.g)])] });
  }
  for (const key of Object.keys(sync.meta)) {
    if (!items.has(key) && !sync.gone[key]) changes.push({ key, content: null });
  }
  return record(sync, changes, context);
}

// A sign-in link to an item that is gone reads as unset (SYNC.md 3.2), so removing it along with that
// item is not an edit of this one.
function withoutDeadLink(entry, live) {
  return entry.viaEntryId === undefined || live.has(entry.viaEntryId) ? entry : { ...entry, viaEntryId: undefined };
}

// What changed between two lists of items, matched by key. Every change replaces an item's object, so
// an item that is still the same object was not touched and is never compared.
/** @returns {Change[]} */
function diff(before, after, view) {
  if (before === after) return [];
  const left = new Map(before.map((item) => [view.key(item), item]));
  const changes = [];
  for (const item of after) {
    const key = view.key(item);
    const was = left.get(key);
    left.delete(key);
    if (was === item) continue;
    const old = was ? view.compared(was) : {};
    const now = view.compared(item);
    const changed = [...new Set([...Object.keys(old), ...Object.keys(now)])].filter((g) => canonical(old[g]) !== canonical(now[g]));
    changes.push({ key, content: view.content(item), changed, clearsHistory: Boolean(old.history && !now.history) });
  }
  for (const key of left.keys()) changes.push({ key, content: null });
  return changes;
}

// Writes the changes into a copy of sync. Every stamp of one save shares one clock tick; a change with
// no group written only refreshes the item's hash (lastUsedAt, a dead sign-in link dropped).
/** @param {Sync} sync @param {Change[]} changes @param {StampContext} context @returns {Sync} */
function record(sync, changes, context) {
  if (!changes.length) return sync;
  const { installId, now } = context;
  const at = tick(sync.clock, now, installId);
  const meta = { ...sync.meta };
  const gone = { ...sync.gone };
  const histFloor = { ...sync.histFloor };
  let stamped = false;
  for (const { key, content, changed = [], clearsHistory } of changes) {
    const prev = meta[key];
    if (!content) {
      gone[key] = { vv: bump(prev?.vv, installId), at };
      delete meta[key];
      stamped = true;
      continue;
    }
    const h = contentHash(content, context.sha256);
    if (changed.length) {
      const vv = bump(prev?.vv, installId);
      const dot = /** @type {[string, number]} */ ([installId, vv[installId]]);
      meta[key] = { vv, g: { ...prev?.g, ...Object.fromEntries(changed.map((g) => [g, { dot, at }])) }, h };
      if (clearsHistory) histFloor[key] = at; // "Clear history": older passwords must not merge back in
      stamped = true;
    } else if (prev && prev.h !== h) {
      meta[key] = { ...prev, h };
    }
  }
  return stamped ? { ...sync, clock: at, meta, gone, histFloor } : { ...sync, meta };
}

const bump = (vv = {}, installId) => ({ ...vv, [installId]: (vv[installId] ?? 0) + 1 });
