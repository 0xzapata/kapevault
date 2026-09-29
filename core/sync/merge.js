// Merging two copies of the vault (SYNC.md 3.3). Pure and synchronous: it never stamps, never reads a
// clock and never makes a random id, so two devices that merge the same pair write the same bytes.
import { compare, max, ZERO } from "./hlc.js";
import { splitGroups, SPACE_GROUP } from "./groups.js";
import { canonical, contentHash, spaceGroups, spaceKey } from "./stamp.js";
import { HISTORY_LIMIT } from "../entries.js";

/**
 * @typedef {import("./hlc.js").Hlc} Hlc
 * @typedef {import("./shape.js").VersionVector} VersionVector
 * @typedef {import("./shape.js").GroupStamp} GroupStamp
 * @typedef {import("./shape.js").ItemMeta} ItemMeta
 * @typedef {{ item: any, meta: ItemMeta, groups: Record<string, any>, floor?: Hlc }} Side one version of an item as the merge reads it
 * @typedef {{ item: any, meta: ItemMeta, copies: { item: any, meta: ItemMeta }[] }} Merged
 * @typedef {{ devices: Record<string, { name: string }>, sha256: (text: string) => string }} Context
 * @typedef {{ unchanged: boolean, epochDiffers: boolean }} MergeReport unchanged: nothing new came in (data is
 *   `local` itself); epochDiffers: the remote is another epoch, left to the restore flow. What changed
 *   item by item is review.js syncChanges(local, data), which the gate and the sync log both use.
 */

const NO_META = /** @type {ItemMeta} */ ({ vv: {}, g: {} });
// Groups a stolen device could use to hurt (SYNC.md 3.9 mass-change gate): the secrets, and a payee's number.
export const SECRET_GROUPS = ["pw", "totp", "qa", "secret", "body", "dpw", "wifi", "photo", "codes", "pay", "idnum"];
// Nobody types these: a star, a move, an account state and the history list. A closed account drops a
// concurrent change to them instead of copying the item for it.
const NOT_TYPED = new Set(["fav", "space", "life", "history"]);

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
    const own = mine.meta[item.id] ?? NO_META;
    // What the restored vault knows of this item: its versions, or its delete. An item it holds unstamped
    // has no version to see past; an id it never heard of is new here.
    const known = theirs.meta[item.id]?.vv ?? theirs.gone[item.id]?.vv ?? (theirIds.has(item.id) ? {} : null);
    if (!known && isEmpty(own.vv)) {
      entries.push(item);
      continue;
    }
    const unseen = Object.keys(own.g).filter((name) => !seen(own.g[name], known ?? {}));
    if (!unseen.length) continue;
    const copy = conflictCopy({ item, meta: own }, unseen, "conflict copy", { devices, sha256 });
    if (meta[copy.item.id]) continue; // the restored vault already holds this copy
    entries.push(copy.item);
    meta[copy.item.id] = { ...copy.meta, h: contentHash(splitGroups(copy.item), sha256) };
  }
  const spaces = [...remote.spaces];
  for (const space of local.spaces) {
    const key = SPACES.key(space.id);
    if (theirs.meta[key] || theirs.gone[key] || remote.spaces.some((s) => s.id === space.id)) continue;
    spaces.push(space);
    if (mine.meta[key]) meta[key] = mine.meta[key];
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
  const read = (data) => new Map(data[kind.list].map((item) => [item.id, sideOf(item, data.sync.meta[kind.key(item.id)], data.sync.histFloor[kind.key(item.id)])]));
  const living = (id, version) => {
    const tombstone = sync.gone[kind.key(id)];
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
    const result = existing ? kind.mergeTwo(sideOf(existing.item, existing.meta, sync.histFloor[id]), sideOf(copy.item, copy.meta, sync.histFloor[id]), context) : { ...copy, copies: [] };
    merged.set(id, result);
    queue.push(...result.copies);
  }

  const items = [];
  const meta = {};
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
    meta[kind.key(id)] = { vv: result.meta.vv, g: result.meta.g, h };
  }
  return { items, meta, untouched: untouched && items.length === mine.size };
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
    } else if (name !== "life") {
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
    copies: [...lostGroups].map(([side, names]) => conflictCopy(side, names, "conflict copy", context)),
  };
}

// A closed account is final: the tombstone stays as confirmGone left it, and whatever the other device
// typed without having seen the closing is kept in a copy.
function closeOver(closed, open, context) {
  const unseen = Object.keys(open.meta.g).filter((name) => !NOT_TYPED.has(name) && !seen(open.meta.g[name], closed.meta.vv));
  return {
    item: closed.item,
    meta: { vv: maxVv(closed.meta.vv, open.meta.vv), g: closed.meta.g },
    copies: unseen.length ? [conflictCopy(open, unseen, "changed after closing", context)] : [],
  };
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
  const floor = L.floor && R.floor ? max(L.floor, R.floor) : (L.floor ?? R.floor);
  // A side that has not seen the latest "Clear history" still holds what was cleared. Older rows carry
  // only a date, so every row up to the day of the clear goes.
  const kept = (side) => {
    const rows = side.item.history ?? [];
    return !floor || (side.floor && compare(side.floor, floor) === 0) ? rows : rows.filter((row) => row.changedAt.slice(0, 10) > day(floor));
  };
  const [l, r] = [kept(L), kept(R)];
  const [from] = later("history", L, R);
  // Nothing to join: the list stays in the order it was written.
  if (!lostPasswords.length && same(l, r)) return { from, value: l.length ? { history: l } : {} };
  const rows = [...l, ...r, ...lostPasswords].sort((a, b) => compareText(b.changedAt, a.changedAt) || compareText(b.password, a.password));
  const history = rows.filter((row, i) => rows.findIndex((other) => other.password === row.password) === i).slice(0, HISTORY_LIMIT);
  return { from, value: history.length ? { history } : {} };
}

// The losing side's whole item, as a new item every device derives identically. It carries the losing
// write as its only history; its id comes from the item, that write and the copy's content, so the same
// copy made on two devices is one item, and two different copies of one write never overwrite each other.
function conflictCopy(side, names, label, { devices, sha256 }) {
  const stamp = names.map((name) => side.meta.g[name]).reduce((a, b) => (compare(a.at, b.at) >= 0 ? a : b));
  const [device, n] = stamp.dot;
  const { id, lastUsedAt, ...content } = side.item;
  const payee = content.kind === "payee";
  if (payee) delete content.confirmedAt; // nobody called to confirm the number in a copy
  content.title = `${content.title} (${label}, ${devices[device]?.name ?? "another device"}, ${day(stamp.at)})${payee ? " (check this number)" : ""}`;
  const item = { id: copyId(canonical([id, stamp.dot, content]), sha256), ...content };
  const groups = new Set([...Object.keys(splitGroups(item)), ...Object.keys(side.meta.g)]);
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

// Key history: one row per salt, oldest to newest, so the last row is the current key.
function mergeKeys(a, b) {
  const bySalt = new Map();
  for (const key of [...a, ...b]) bySalt.set(key.salt, bySalt.has(key.salt) ? newer(bySalt.get(key.salt), key) : key);
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

function mergeRecords(a, b, both) {
  const out = { ...a };
  for (const [key, value] of Object.entries(b)) out[key] = key in a ? both(a[key], value) : value;
  return out;
}

// --- Causality and order -----------------------------------------------------------------------------

/** @param {VersionVector} a @param {VersionVector} b */
const maxVv = (a, b) => mergeRecords(a, b, Math.max);

/** Every write `other` has seen, `vv` has seen too. @param {VersionVector} vv @param {VersionVector} other */
const covers = (vv, other) => Object.entries(other).every(([device, n]) => (vv[device] ?? 0) >= n);

/** A group's write is known to `vv`. No stamp is the value every device started with. @param {GroupStamp | undefined} stamp @param {VersionVector} vv */
const seen = (stamp, vv) => !stamp || (vv[stamp.dot[0]] ?? 0) >= stamp.dot[1];

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

const newer = (a, b) => ((compare(a.at, b.at) || compareText(canonical(a), canonical(b))) >= 0 ? a : b);

// The UTC day of a clock: the same on every device, unlike a local date.
const day = (/** @type {Hlc} */ at) => new Date(at[0]).toISOString().slice(0, 10);

const same = (a, b) => a === b || canonical(a) === canonical(b);

const sameStamps = (a, b) => same(a.vv, b.vv) && same(a.g, b.g);

// Equal stamps and equal content hashes are one version (lastUsedAt is outside the hash). A remote that
// lied about its hash could only hide its own change; an item never stamped has no hash to compare.
const sameVersion = (L, R) => sameStamps(L.meta, R.meta) && (L.meta.h && L.meta.h === R.meta.h ? L.item.lastUsedAt === R.item.lastUsedAt : same(L.item, R.item));

const isEmpty = (record) => Object.keys(record).length === 0;

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
