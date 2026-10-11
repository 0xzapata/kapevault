// Merging two copies of the vault (SYNC.md 3.3). Pure and synchronous: it never stamps, never reads a
// clock and never makes a random id, so two devices that merge the same pair write the same bytes.
import { compare, max, ZERO } from "./hlc.js";
import { splitGroups, SPACE_GROUP } from "./groups.js";
import { canonical, contentHash, spaceGroups, spaceKey } from "./stamp.js";
import { own } from "./shape.js";
import { HISTORY_LIMIT } from "../entries.js";
/** @import { Hlc } from "./hlc.js" */
/** @import { VersionVector, GroupStamp, ItemMeta } from "./shape.js" */

/**
 * @typedef {{ item: any, meta: ItemMeta, groups: Record<string, any>, floor?: Hlc }} Side one version of an item as the merge reads it
 * @typedef {{ item: any, meta: ItemMeta, copies: { item: any, meta: ItemMeta }[] }} Merged
 * @typedef {{ devices: Record<string, { name: string }>, sha256: (text: string) => string }} Context
 * @typedef {{ unchanged: boolean, epochDiffers: boolean }} MergeReport unchanged: nothing new came in (data is
 *   `local` itself); epochDiffers: the remote is another epoch, left to the restore flow. What changed
 *   item by item is review.js syncChanges(local, data), which the gate and the sync log both use.
 */

const NO_META = /** @type {ItemMeta} */ ({ vv: {}, g: {} });
// Groups a stolen device could use to hurt (SYNC.md 3.9 mass-change gate): the secrets.
export const SECRET_GROUPS = ["pw", "totp", "qa", "secret", "body", "dpw", "wifi", "photo", "codes", "idnum"];
// Nobody types these: a star, a move, an account state, the Trash and the history list. A closed account
// drops a concurrent change to them instead of copying the item for it.
const NOT_TYPED = new Set(["fav", "space", "life", "history", "trash"]);

/** Two vaults from different lineages: never merged (SYNC.md 3.5). */
export class VaultMismatchError extends Error {
  constructor() {
    super("This bucket holds a different vault");
    this.name = "VaultMismatchError";
  }
}

/**
 * Merges a remote vault into this device's. Device-local keys (cloud, olderBackupsPending, ...) come from
 * `local` untouched; `spaces`, `entries` and `sync` are merged. `sha256` is the host's, as for stamp().
 * @param {any} local @param {any} remote @param {{ sha256: (text: string) => string }} host
 * @returns {{ data: any, report: MergeReport }}
 */
export function merge(local, remote, { sha256 }) {
  const mine = local.sync;
  const theirs = remote.sync;
  if (mine.vaultId !== theirs.vaultId) throw new VaultMismatchError();
  // A restore made the other device's vault a new epoch; replacing ours is the restore flow's call.
  if (mine.epoch.id !== theirs.epoch.id) return { data: local, report: { unchanged: true, epochDiffers: true } };

  const sync = {
    ...mine,
    clock: max(mine.clock, theirs.clock),
    keys: mergeKeys(mine.keys, theirs.keys),
    devices: mergeRecords(mine.devices, theirs.devices, mergeDevice),
    histFloor: mergeRecords(mine.histFloor, theirs.histFloor, max),
    gone: mergeRecords(mine.gone, theirs.gone, (a, b) => ({ vv: maxVv(a.vv, b.vv), at: max(a.at, b.at) })),
    meta: {},
  };
  const context = { devices: sync.devices, sha256 };
  const spaces = mergeList(SPACES, local, remote, sync, context);
  const entries = mergeList(ENTRIES, local, remote, sync, context);
  sync.meta = { ...spaces.meta, ...entries.meta };
  // Nothing new came in: the host writes and uploads nothing.
  const unchanged = spaces.untouched && entries.untouched && same(recordsOf(sync), recordsOf(mine));
  const data = unchanged ? local : { ...local, spaces: spaces.items, entries: entries.items, sync };
  return { data, report: { unchanged, epochDiffers: false } };
}

const recordsOf = ({ meta, ...records }) => records;

/**
 * A newer epoch from another device - a restore made "the vault on all devices" (SYNC.md 3.7): its items
 * and spaces replace this device's. Nothing typed here is lost: an item with a change the restored vault
 * never saw is kept beside it as a conflict copy, and an item it never knew that was never stamped (made
 * before sync) stays as it is, as does a space it never knew. Pure, like merge.
 * @param {any} local @param {any} remote @param {{ sha256: (text: string) => string }} host
 * @returns {{ data: any, report: MergeReport }}
 */
export function adoptEpoch(local, remote, { sha256 }) {
  const mine = local.sync;
  const theirs = remote.sync;
  if (mine.vaultId !== theirs.vaultId) throw new VaultMismatchError();
  const devices = mergeRecords(mine.devices, theirs.devices, mergeDevice);
  const meta = { ...theirs.meta };
  const entries = [...remote.entries];
  const theirIds = new Set(entries.map((e) => e.id));
  for (const item of local.entries) {
    const stamps = own(mine.meta, item.id) ?? NO_META;
    // What the restored vault knows of this item: its versions, or its delete. An item it holds unstamped
    // has no version to see past; an id it never heard of is new here.
    const known = own(theirs.meta, item.id)?.vv ?? own(theirs.gone, item.id)?.vv ?? (theirIds.has(item.id) ? {} : null);
    if (!known && isEmpty(stamps.vv)) {
      entries.push(item);
      continue;
    }
    const context = { devices, sha256 };
    const there = remote.entries.find((e) => e.id === item.id);
    let copies;
    if (there && isClosed(there) && !isClosed(item)) {
      // The restored vault closed this account: what it wiped never rides back in (closingCopies).
      const closed = { item: there, meta: own(theirs.meta, item.id) ?? NO_META, groups: splitGroups(there) };
      copies = closingCopies(closed, { item, meta: stamps, groups: splitGroups(item) }, context);
    } else {
      const unseen = Object.keys(stamps.g).filter((name) => !seen(stamps.g[name], known ?? {}));
      // What the restored vault cleared stays cleared in the copy too.
      const floors = { mine: own(mine.histFloor, item.id), theirs: own(theirs.histFloor, item.id) };
      copies = unseen.length ? [conflictCopy(withoutCleared({ item, meta: stamps, floor: floors.mine }, mergedFloor({ floor: floors.mine }, { floor: floors.theirs })), unseen, "conflict copy", context)] : [];
    }
    for (const copy of copies) {
      if (own(meta, copy.item.id)) continue; // the restored vault already holds this copy
      entries.push(copy.item);
      meta[copy.item.id] = { ...copy.meta, h: contentHash(splitGroups(copy.item), sha256) };
    }
  }
  const spaces = [...remote.spaces];
  for (const space of local.spaces) {
    const key = SPACES.key(space.id);
    if (own(theirs.meta, key) || own(theirs.gone, key) || remote.spaces.some((s) => s.id === space.id)) continue;
    spaces.push(space);
    if (own(mine.meta, key)) meta[key] = mine.meta[key];
  }
  const sync = { ...theirs, clock: max(mine.clock, theirs.clock), keys: mergeKeys(mine.keys, theirs.keys), devices, meta };
  const data = { ...local, spaces, entries, sync };
  return { data, report: { unchanged: false, epochDiffers: false } };
}

const laterOf = (a, b, id) => (compare(a.at, b.at) || compareText(id(a), id(b))) > 0;

/** `epoch` is a later restore than `than` (by clock, then id): a device on `than` adopts it. */
export const isNewerEpoch = (epoch, than) => laterOf(epoch, than, (e) => e.id);

/**
 * The remote vault's current master password key is a later change than this vault's (SYNC.md 3.6):
 * this device adopts it. A key this vault already holds is a device that is behind; of two changes
 * made apart (a fork), the later one wins on both.
 * @param {{ keys: import("./shape.js").KeyRecord[] }} remote @param {{ keys: import("./shape.js").KeyRecord[] }} local
 */
export function isNewerKey(remote, local) {
  if (!remote.keys.length || !local.keys.length) return false;
  const newest = (keys) => keys.reduce((a, b) => (laterOf(b, a, (k) => k.salt) ? b : a));
  return laterOf(newest(remote.keys), newest(local.keys), (k) => k.salt);
}

/**
 * A restore over this vault (SYNC.md 3.7) never undoes a removal or a lock-out (3.9). `sync` is the
 * backup's sync object with every device removal of the vault it replaces carried in (the earliest
 * `revokedAt` stands, as in a merge). keepKey: the backup is under a master password a lock-out retired -
 * one set before a device was removed, while this vault's key was set after that removal - so the restored
 * vault must be written under this vault's key, and `sync` then carries this vault's key history too. Under
 * the backup's key, the removed device's copy of it would open every snapshot the restore uploads, and its
 * own snapshots under that key would merge again. A backup key this vault's history does not hold counts
 * as retired when there is a lock-out at all (nothing says the removed device never had it).
 * @param {import("./shape.js").Sync} current this vault's @param {string} currentSalt its header's
 * @param {import("./shape.js").Sync} backup the backup's, read (readSync) @param {string} backupSalt its header's
 * @returns {{ sync: import("./shape.js").Sync, keepKey: boolean }}
 */
export function carryLockOut(current, currentSalt, backup, backupSalt) {
  const removals = Object.fromEntries(Object.entries(current.devices).filter(([, d]) => d.revokedAt));
  const devices = mergeRecords(backup.devices, removals, mergeDevice);
  const keyNow = current.keys.find((k) => k.salt === currentSalt);
  const keyThen = current.keys.find((k) => k.salt === backupSalt) ?? backup.keys.find((k) => k.salt === backupSalt);
  const retired = (/** @type {{ revokedAt?: Hlc }} */ d) => Boolean(d.revokedAt && keyNow && compare(keyNow.at, d.revokedAt) > 0 && (!keyThen || compare(keyThen.at, d.revokedAt) < 0));
  const keepKey = backupSalt !== currentSalt && Object.values(removals).some(retired);
  const sync = { ...backup, clock: max(backup.clock, current.clock), devices, ...(keepKey && { keys: mergeKeys(current.keys, backup.keys) }) };
  return { sync, keepKey };
}

/** The shared state as one string with a stable key order: what two synced devices must agree on. */
export function sharedState(data) {
  const { meta, ...sync } = data.sync;
  const byId = (/** @type {any[]} */ list) => [...list].sort((a, b) => compareText(a.id, b.id));
  // meta.h is left out: it is derived from the content, which is already here. A never-stamped item's
  // meta says nothing, so having one or not is the same state.
  const causal = Object.fromEntries(Object.entries(meta).filter(([, m]) => !isEmpty(m.vv)).map(([key, { h, ...rest }]) => [key, rest]));
  return canonical({ spaces: byId(data.spaces), entries: byId(data.entries), sync: { ...sync, meta: causal } });
}

// --- Items -------------------------------------------------------------------------------------------

const ENTRIES = { list: "entries", key: (/** @type {string} */ id) => id, groupsOf: splitGroups, mergeTwo: mergeEntry };
const SPACES = { list: "spaces", key: spaceKey, groupsOf: spaceGroups, mergeTwo: mergeSpace };

// One list (entries or spaces): every id either side holds is merged, and conflict copies join the list.
// A delete removes each version of an item it saw. A version it never saw (an edit made without seeing
// the delete) keeps the item, as that version alone: what the delete saw never rides back in with it.
function mergeList(kind, local, remote, sync, context) {
  const sideOf = (item, meta, floor) => ({ item, meta: meta ?? NO_META, groups: kind.groupsOf(item), floor });
  const read = (data) => new Map(data[kind.list].map((item) => [item.id, sideOf(item, own(data.sync.meta, kind.key(item.id)), own(data.sync.histFloor, kind.key(item.id)))]));
  const living = (id, version) => {
    const tombstone = own(sync.gone, kind.key(id));
    return version && !(tombstone && covers(tombstone.vv, version.meta.vv)) ? version : undefined;
  };
  const mine = read(local);
  const theirs = read(remote);

  /** @type {Map<string, Merged>} */
  const merged = new Map();
  const queue = [];
  for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
    const l = living(id, mine.get(id));
    const r = living(id, theirs.get(id));
    if (!l && !r) continue;
    // Most items are the same on both devices: nothing to merge.
    const result = l && r && !sameVersion(l, r) ? kind.mergeTwo(l, r, context) : { ...(l ?? r), copies: [] };
    merged.set(id, result);
    queue.push(...result.copies);
  }
  // A copy another device already made (same id, same dots) merges with it as one item.
  for (let i = 0; i < queue.length; i++) {
    const copy = living(queue[i].item.id, queue[i]);
    if (!copy) continue;
    const id = copy.item.id;
    const existing = merged.get(id);
    const result = existing ? kind.mergeTwo(sideOf(existing.item, existing.meta, own(sync.histFloor, id)), sideOf(copy.item, copy.meta, own(sync.histFloor, id)), context) : { ...copy, copies: [] };
    merged.set(id, result);
    queue.push(...result.copies);
  }

  const items = [];
  const meta = new Map();
  let untouched = true; // every item of this device came through as it was, and nothing else came in
  for (const [id, result] of merged) {
    const l = mine.get(id);
    const r = theirs.get(id);
    // An unchanged item keeps its object: the host diffs by identity.
    const item = l && same(result.item, l.item) ? l.item : r && same(result.item, r.item) ? r.item : result.item;
    items.push(item);
    if (item !== l?.item || !(result.meta === l.meta || sameStamps(result.meta, l.meta))) untouched = false;
    // A never-stamped item keeps no meta, as before. The hash is the one stamp() writes, so a later
    // repair() on open finds nothing to repair; an item this device kept as it was keeps its own.
    if (isEmpty(result.meta.vv)) continue;
    const h = item === l?.item && l.meta.h ? l.meta.h : contentHash(kind.groupsOf(item), context.sha256);
    meta.set(kind.key(id), { vv: result.meta.vv, g: result.meta.g, h });
  }
  return { items, meta: Object.fromEntries(meta), untouched: untouched && items.length === mine.size };
}

/** @param {Side} L @param {Side} R @returns {Merged} */
function mergeSpace(L, R) {
  const { from } = lww(SPACE_GROUP, L, R);
  const stamp = from.meta.g[SPACE_GROUP];
  return { item: from.item, meta: { vv: maxVv(L.meta.vv, R.meta.vv), g: stamp ? { [SPACE_GROUP]: stamp } : {} }, copies: [] };
}

/** @param {Side} L @param {Side} R @param {Context} context @returns {Merged} */
function mergeEntry(L, R, context) {
  if (isClosed(L.item) !== isClosed(R.item)) return isClosed(L.item) ? closeOver(L, R, context) : closeOver(R, L, context);
  const fields = { id: L.item.id };
  /** @type {Record<string, GroupStamp>} */
  const g = {};
  const lostGroups = new Map();
  const lostPasswords = [];
  for (const name of groupNames(L, R)) {
    if (name === "history") continue; // after the loop: it takes the passwords the loop replaced
    const { from, value, loser } = name === "codes" ? mergeCodes(L, R) : lww(name, L, R);
    take(fields, g, name, from, value);
    if (!loser) continue;
    if (name === "pw") {
      if (loser.item.password) lostPasswords.push({ password: loser.item.password, changedAt: new Date(loser.meta.g.pw.at[0]).toISOString() });
    } else if (name !== "life" && name !== "trash") {
      lostGroups.set(loser, [...(lostGroups.get(loser) ?? []), name]);
    }
  }
  const history = mergeHistory(L, R, lostPasswords);
  take(fields, g, "history", history.from, history.value);
  const lastUsedAt = Math.max(L.item.lastUsedAt ?? 0, R.item.lastUsedAt ?? 0);
  if (lastUsedAt) fields.lastUsedAt = lastUsedAt;
  return {
    item: fields,
    meta: { vv: maxVv(L.meta.vv, R.meta.vv), g },
    copies: [...lostGroups].map(([side, names]) => conflictCopy(withoutCleared(side, mergedFloor(L, R)), names, "conflict copy", context)),
  };
}

// A closed account is final: the tombstone stays as confirmGone left it, and what the other device typed
// without having seen the closing is kept in a copy (closingCopies). Its history never rides along.
function closeOver(closed, open, context) {
  return {
    item: closed.item,
    meta: { vv: maxVv(closed.meta.vv, open.meta.vv), g: closed.meta.g },
    copies: closingCopies(closed, open, context),
  };
}

// The core fields a title edit also touches, and the star: not worth a copy on their own.
const CORE_NOT_TYPED = new Set(["title", "tags", "favorite", "updatedAt"]);
const DROPPED_BY_CLOSING = new Set(["signIn", "viaEntryId", "heldFor"]);

// What `open` (a side that never saw the account closed) typed since, as at most one "changed after closing"
// copy: it is made for an unseen secret group, or for an unseen core group that differs from the tombstone
// in a field a person types (notes, username, url, ...). A title edit, a move or a star makes none. The copy
// holds the core and the space and only the secret groups the open side changed: what the closing wiped
// never rides back in, and it holds no history, so nothing a "Clear history" removed can return in it.
// The core fields the closing dropped (signIn, a link to another login) cannot tell an edit from the old
// value, and neither can notes when the closing cleared them: those two never make a copy by themselves.
function closingCopies(closed, open, context) {
  const unseen = Object.keys(open.meta.g).filter((name) => !NOT_TYPED.has(name) && !seen(open.meta.g[name], closed.meta.vv));
  const secrets = unseen.filter((name) => SECRET_GROUPS.includes(name));
  const [then, now] = [closed.groups.core ?? {}, open.groups.core ?? {}];
  const fields = new Set([...Object.keys(then), ...Object.keys(now)]);
  const typed = unseen.includes("core") && [...fields].some((field) => !CORE_NOT_TYPED.has(field) && !DROPPED_BY_CLOSING.has(field) && !(field === "notes" && then.notes === "") && !same(then[field], now[field]));
  const names = [...(typed ? ["core"] : []), ...secrets];
  return names.length ? [conflictCopy(open, names, "changed after closing", context, ["core", "space", ...secrets])] : [];
}

// --- Groups ------------------------------------------------------------------------------------------

// Causal last-writer-wins for one group. A side that has seen the other's write holds that value or a
// successor, whatever the clocks say. Two writes neither side saw are a real conflict: the later HLC
// wins and the other is returned as `loser` for the caller to keep.
function lww(name, L, R) {
  const rSawL = seen(L.meta.g[name], R.meta.vv);
  const lSawR = seen(R.meta.g[name], L.meta.vv);
  if (rSawL !== lSawR) return { from: rSawL ? R : L };
  const [from, other] = later(name, L, R);
  const conflict = !rSawL && !same(L.groups[name], R.groups[name]);
  return { from, loser: conflict ? other : undefined };
}

// Backup codes: on the same set, a code marked used on either device stays used and the rest follows the
// later write; a replaced set is an ordinary conflict, and the losing set goes to a copy.
function mergeCodes(L, R) {
  const top = dominant(L, R);
  if (top) return { from: top };
  const l = L.item.recoveryCodes;
  const r = R.item.recoveryCodes;
  if (!l || !r || !same(l.codes.map((c) => c.code), r.codes.map((c) => c.code))) return lww("codes", L, R);
  const [from, other] = later("codes", L, R);
  const spent = other.item.recoveryCodes.codes;
  const codes = from.item.recoveryCodes.codes.map((c, i) => (spent[i].used && !c.used ? { ...c, used: true } : c));
  return { from, value: { recoveryCodes: { ...from.item.recoveryCodes, codes } } };
}

// History is a union: passwords either device replaced, plus the ones this merge replaced, newest first.
function mergeHistory(L, R, lostPasswords) {
  const top = dominant(L, R);
  if (top) return { from: top }; // it has seen everything the other has, so it already holds the union
  const floor = mergedFloor(L, R);
  const [l, r] = [keptRows(L, floor), keptRows(R, floor)];
  const [from] = later("history", L, R);
  // Nothing to join: the list stays in the order it was written.
  if (!lostPasswords.length && same(l, r)) return { from, value: l.length ? { history: l } : {} };
  const rows = [...l, ...r, ...lostPasswords].sort((a, b) => compareText(b.changedAt, a.changedAt) || compareText(b.password, a.password));
  const history = rows.filter((row, i) => rows.findIndex((other) => other.password === row.password) === i).slice(0, HISTORY_LIMIT);
  return { from, value: history.length ? { history } : {} };
}

// The "Clear history" floor of two sides of one item: the later one.
const mergedFloor = (L, R) => (L.floor && R.floor ? max(L.floor, R.floor) : (L.floor ?? R.floor));

// A side's history rows that the floor leaves. A side that has not seen the latest "Clear history" still
// holds what was cleared; older rows carry only a date, so every row up to the day of the clear goes (a row
// with no date can not be told from one before it, so it goes too).
function keptRows(side, floor) {
  const rows = side.item.history ?? [];
  return !floor || (side.floor && compare(side.floor, floor) === 0) ? rows : rows.filter((row) => typeof row.changedAt === "string" && row.changedAt.slice(0, 10) > day(floor));
}

// A side without the rows a "Clear history" removed, for a copy to be built from: a copy has no floor of
// its own, so the cleared passwords would come back in it.
function withoutCleared(side, floor) {
  const rows = keptRows(side, floor);
  if (rows === side.item.history || !side.item.history) return side;
  const { history, ...rest } = side.item;
  return { ...side, item: rows.length ? { ...rest, history: rows } : rest };
}

// The losing side's whole item, as a new item every device derives identically. It carries the losing
// write as its only history; its id comes from the item, that write and the copy's content, so the same
// copy made on two devices is one item, and two different copies of one write never overwrite each other.
// `only`: the groups the copy holds, when it is not the whole item.
function conflictCopy(side, names, label, { devices, sha256 }, only) {
  const stamp = names.map((name) => side.meta.g[name]).reduce((a, b) => (compare(a.at, b.at) >= 0 ? a : b));
  const [device, n] = stamp.dot;
  const { id, lastUsedAt, ...whole } = side.item;
  const content = only ? Object.assign({}, ...only.map((name) => side.groups[name])) : whole;
  content.title = `${content.title} (${label}, ${own(devices, device)?.name ?? "another device"}, ${day(stamp.at)})`;
  const item = { id: copyId(canonical([id, stamp.dot, content]), sha256), ...content };
  const groups = new Set([...Object.keys(splitGroups(item)), ...(only ? [] : Object.keys(side.meta.g))]);
  return { item, meta: { vv: { [device]: n }, g: Object.fromEntries([...groups].map((name) => [name, stamp])) } };
}

// UUID-shaped (version 8: derived, not random): the same on every device, and one length however often
// copies are copied again.
function copyId(source, sha256) {
  const hex = sha256(source);
  const variant = (8 + (parseInt(hex[16], 16) % 4)).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function take(fields, g, name, from, value = from.groups[name]) {
  Object.assign(fields, value);
  if (from.meta.g[name]) g[name] = from.meta.g[name];
}

const groupNames = (L, R) => new Set([...Object.keys(L.groups), ...Object.keys(R.groups), ...Object.keys(L.meta.g), ...Object.keys(R.meta.g)]);

const isClosed = (item) => item.lifecycle?.state === "gone";

// --- Shared sync records -----------------------------------------------------------------------------

// Key history: one row per salt, oldest to newest, so the last row is the current key. A salt both sides
// hold keeps the EARLIER record: the change was made once, and a later `at` can only be a re-stamp, which
// would pass for a master change after a removal (the lock-out check, carryLockOut). A vault key holder can
// write any record, so a remote's unknown salts are first cut to what a real header allows (trustedKeys).
function mergeKeys(a, b) {
  const bySalt = new Map();
  for (const key of [...a, ...b]) bySalt.set(key.salt, bySalt.has(key.salt) ? earlier(bySalt.get(key.salt), key) : key);
  return [...bySalt.values()].sort((x, y) => compare(x.at, y.at) || compareText(x.salt, y.salt));
}

// A device record has no rename clock, so the record added later wins (then by content, so both argument
// orders agree). A revocation is final: the earliest one stands.
function mergeDevice(a, b) {
  const { revokedAt: revokedA, ...deviceA } = a;
  const { revokedAt: revokedB, ...deviceB } = b;
  const device = (compare(deviceA.addedAt, deviceB.addedAt) || compareText(canonical(deviceA), canonical(deviceB))) >= 0 ? deviceA : deviceB;
  const revokedAt = revokedA && revokedB ? (compare(revokedA, revokedB) <= 0 ? revokedA : revokedB) : (revokedA ?? revokedB);
  return revokedAt ? { ...device, revokedAt } : device;
}

// Own keys only: a key named "toString" or "__proto__" is a plain key here, never a prototype member.
function mergeRecords(a, b, both) {
  const out = new Map(Object.entries(a));
  for (const [key, value] of Object.entries(b)) out.set(key, out.has(key) ? both(out.get(key), value) : value);
  return Object.fromEntries(out);
}

// --- Causality and order -----------------------------------------------------------------------------

/** @param {VersionVector} a @param {VersionVector} b */
const maxVv = (a, b) => mergeRecords(a, b, Math.max);

/** Every write `other` has seen, `vv` has seen too. @param {VersionVector} vv @param {VersionVector} other */
const covers = (vv, other) => Object.entries(other).every(([device, n]) => (own(vv, device) ?? 0) >= n);

/** A group's write is known to `vv`. No stamp is the value every device started with. @param {GroupStamp | undefined} stamp @param {VersionVector} vv */
const seen = (stamp, vv) => !stamp || (own(vv, stamp.dot[0]) ?? 0) >= stamp.dot[1];

// The side that has seen everything the other has, if exactly one has.
function dominant(L, R) {
  const l = covers(L.meta.vv, R.meta.vv);
  return l === covers(R.meta.vv, L.meta.vv) ? undefined : l ? L : R;
}

// The two sides of a group, later write first: by HLC, then by content so both argument orders agree.
function later(name, L, R) {
  const l = L.meta.g[name];
  const r = R.meta.g[name];
  const order = compare(l?.at ?? ZERO, r?.at ?? ZERO) || compareText(canonical([l, L.groups[name]]), canonical([r, R.groups[name]]));
  return order >= 0 ? [L, R] : [R, L];
}

const earlier = (a, b) => ((compare(a.at, b.at) || compareText(canonical(a), canonical(b))) <= 0 ? a : b);

// The UTC day of a clock: the same on every device, unlike a local date.
const day = (/** @type {Hlc} */ at) => new Date(at[0]).toISOString().slice(0, 10);

const same = (a, b) => a === b || canonical(a) === canonical(b);

const sameStamps = (a, b) => same(a.vv, b.vv) && same(a.g, b.g);

// Equal stamps and equal content hashes are one version (lastUsedAt is outside the hash). A remote that
// lied about its hash could only hide its own change; an item never stamped has no hash to compare.
const sameVersion = (L, R) => sameStamps(L.meta, R.meta) && (L.meta.h && L.meta.h === R.meta.h ? L.item.lastUsedAt === R.item.lastUsedAt : same(L.item, R.item));

const isEmpty = (record) => Object.keys(record).length === 0;

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
