// The top-level `sync` object (SYNC.md 3.1): everything sync knows about a vault, kept beside `spaces`
// and `entries` so neither changes shape and every old Opener still reads the vault. A `sync` read
// from a file may come from another device, so every part of it is checked before it is used.
import { NewerVaultError, READER_VERSION } from "../vault-format.js";
import { ZERO, compare, isHlc, max, tick } from "./hlc.js";

/**
 * @typedef {import("./hlc.js").Hlc} Hlc
 * @typedef {Record<string, number>} VersionVector installId -> how many of that device's changes the item has seen
 * @typedef {{ dot: [string, number], at: Hlc }} GroupStamp the change that wrote a field group, and when
 * @typedef {{ vv: VersionVector, g: Record<string, GroupStamp>, h?: string }} ItemMeta h: SHA-256 of the item's content
 * @typedef {{ salt: string, n: number, at: Hlc, by: string }} KeyRecord
 * @typedef {{ name: string, platform: string, addedAt: Hlc, revokedAt?: Hlc }} Device
 * @typedef {{
 *   v: 1, vaultId: string, epoch: { id: string, at: Hlc }, keys: KeyRecord[], clock: Hlc,
 *   meta: Record<string, ItemMeta>, gone: Record<string, { vv: VersionVector, at: Hlc }>,
 *   histFloor: Record<string, Hlc>, devices: Record<string, Device>
 * }} Sync
 */

const SYNC_VERSION = 1;

// The top-level fields every device merges. Every other one (cloud, olderBackupsPending, and any a
// later version adds) belongs to the device that wrote it and is never merged. They stay where they
// always were, so an older app version still finds its own settings.
export const SHARED_FIELDS = ["spaces", "entries", "sync"];

/**
 * The sync object for a vault that has none: a new vault, or one saved before sync. Nothing is
 * stamped - every item starts with an empty version vector, so two devices holding the same old item
 * never see a conflict in it. The Personal space is made with the vault and can never be deleted, so
 * its id names the vault: two devices that each open the same old vault agree on it.
 * @param {{ spaces: { id: string, kind: string }[] }} data @param {string} salt the file header's, base64
 * @returns {Sync}
 */
export function newSync(data, salt) {
  const vaultId = data.spaces.find((s) => s.kind === "personal")?.id ?? globalThis.crypto.randomUUID();
  return { v: SYNC_VERSION, vaultId, epoch: { id: vaultId, at: ZERO }, keys: [{ salt, n: 1, at: ZERO, by: "" }], clock: ZERO, meta: {}, gone: {}, histFloor: {}, devices: {} };
}

/** Did a newer version write this vault: a `minReader` above this app's, or a `sync.v` above 1? @param {any} data */
export const isNewerData = (data) => (Number.isInteger(data.minReader) && data.minReader > READER_VERSION) || (typeof data.sync?.v === "number" && data.sync.v > SYNC_VERSION);

/**
 * A vault a newer version wrote is refused. A host calls this on a backup it has opened, before anything
 * is written over the vault it has.
 * @param {any} data
 * @throws {NewerVaultError}
 */
export function checkReader(data) {
  if (isNewerData(data)) throw new NewerVaultError();
}

/**
 * The vault's own sync object, checked, or a new one for a vault saved before sync (or unreadable).
 * A newer version's vault (checkReader) is refused, never replaced by a new object: that would drop
 * its tombstones, device removals and key history.
 * @throws {NewerVaultError}
 */
export function readSync(data, salt) {
  checkReader(data);
  return validSync(data.sync) ?? newSync(data, salt);
}

/**
 * A sync object read from a decrypted file, with every malformed part dropped. Null when it cannot be
 * used at all: not an object, a version this app does not know, or no readable vault id or epoch.
 * @returns {Sync | null}
 */
export function validSync(value) {
  if (!isRecord(value) || value.v !== SYNC_VERSION || !isId(value.vaultId)) return null;
  if (!isRecord(value.epoch) || !isId(value.epoch.id) || !isHlc(value.epoch.at)) return null;
  const sync = /** @type {Sync} */ ({
    v: SYNC_VERSION,
    vaultId: value.vaultId,
    epoch: { id: value.epoch.id, at: value.epoch.at },
    keys: Array.isArray(value.keys) ? value.keys.map(validKey).filter(Boolean) : [],
    clock: isHlc(value.clock) ? value.clock : ZERO,
    meta: membersOf(value.meta, validMeta),
    gone: membersOf(value.gone, validTombstone),
    histFloor: membersOf(value.histFloor, (at) => (isHlc(at) ? at : null)),
    devices: membersOf(value.devices, validDevice),
  });
  // The clock is the highest time this vault has seen, so it is never behind a time the object holds.
  return { ...sync, clock: timesIn(sync).reduce(max, sync.clock) };
}

/**
 * A remote's sync object with its key history cut to what a real snapshot under `salt` (its header's,
 * the one salt that opened it) can hold: that salt's record, and older ones. The newest record is the
 * header's (SYNC.md 3.1), so a record dated after it, or one dated with it under another salt, is not a
 * master change this vault can see: a removed device holding the vault key could write it to hide the
 * lock-out. No record for the header salt: nothing is trusted.
 * mine: this vault's own key history. A snapshot under a salt this vault already holds (the normal sync,
 * opened with today's key) is no master change at all, so only salts this vault holds are kept from it -
 * mergeKeys keeps the earlier record of each, so re-dating one hides nothing (audit run-1 lead 4). A new
 * salt arrives only in a snapshot under that salt, which the user unlocks with its password and reviews.
 * @param {Sync} sync @param {string} salt @param {KeyRecord[]} [mine] @returns {Sync}
 */
export function trustedKeys(sync, salt, mine = []) {
  const held = new Set(mine.map((k) => k.salt));
  if (held.has(salt)) return { ...sync, keys: sync.keys.filter((k) => held.has(k.salt)) };
  const head = sync.keys.find((k) => k.salt === salt);
  return { ...sync, keys: head ? sync.keys.filter((k) => k === head || compare(k.at, head.at) < 0) : [] };
}

/**
 * After a master password change: the new salt joins the key history as the newest.
 * @param {Sync} sync @param {{ salt: string, installId: string, now: number }} change
 * @returns {Sync}
 */
export function addKey(sync, { salt, installId, now }) {
  const at = tick(sync.clock, now, installId);
  const n = Math.max(0, ...sync.keys.map((k) => k.n)) + 1;
  return { ...sync, keys: [...sync.keys, { salt, n, at, by: installId }], clock: at };
}

/**
 * This install in the device list, so the other devices can name it. A new name (the PC was renamed)
 * is written as a newer record, since the later record wins a merge; a revoked install stays revoked.
 * @param {Sync} sync @param {{ installId: string, name: string, platform: string, now: number }} device
 * @returns {Sync} the same object when there is nothing to write
 */
export function registerDevice(sync, { installId, name, platform, now }) {
  const known = sync.devices[installId];
  if (known && (known.revokedAt || (known.name === name && known.platform === platform))) return sync;
  const addedAt = tick(sync.clock, now, installId);
  return { ...sync, clock: addedAt, devices: { ...sync.devices, [installId]: { name, platform, addedAt } } };
}

/**
 * "Make this the vault on all devices" after a restore (SYNC.md 3.7): a new epoch, which every other
 * device adopts in place of its own items (merge.js adoptEpoch). id: a fresh id from the host.
 * @param {Sync} sync @param {{ id: string, installId: string, now: number }} change
 * @returns {Sync}
 */
export function newEpoch(sync, { id, installId, now }) {
  const at = tick(sync.clock, now, installId);
  return { ...sync, epoch: { id, at }, clock: at };
}

/**
 * Another device removed from sync: its snapshots are never merged again. One never registered gets a
 * record of its own; the first removal stands (mergeDevice keeps the earliest).
 * @param {Sync} sync @param {{ id: string, installId: string, now: number }} change
 * @returns {Sync} the same object when it is already removed
 */
export function revokeDevice(sync, { id, installId, now }) {
  const known = sync.devices[id];
  if (known?.revokedAt) return sync;
  const revokedAt = tick(sync.clock, now, installId);
  const device = known ?? { name: "Another device", platform: "", addedAt: ZERO };
  return { ...sync, clock: revokedAt, devices: { ...sync.devices, [id]: { ...device, revokedAt } } };
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
// A name Object.prototype already has ("toString", "__proto__", ...) is no id: a lookup by it on a plain map finds
// a function, not a record. Ids are UUIDs, install ids and "s:<uuid>" keys, so nothing real is refused.
const isId = (value) => typeof value === "string" && value.length > 0 && value.length <= 128 && !(value in Object.prototype);

/** A map's own member, never one it inherits from Object.prototype. @param {Record<string, any>} record @param {string} key */
export const own = (record, key) => (Object.hasOwn(record, key) ? record[key] : undefined);
const isCount = (value) => Number.isSafeInteger(value) && value >= 1;
const SALT = /^[A-Za-z0-9+/]{22}==$/; // 16 bytes

// The well-formed members of a map, each through check (null drops it). Object.fromEntries defines
// keys as data, so a key named "__proto__" stays a plain key and never becomes a prototype.
function membersOf(value, check) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => isId(key))
      .map(([key, item]) => [key, check(item)])
      .filter(([, item]) => item !== null),
  );
}

const versionVector = (value) => membersOf(value, (n) => (isCount(n) ? n : null));

function validMeta(value) {
  if (!isRecord(value)) return null;
  const vv = versionVector(value.vv);
  // A group's dot must be a change the item's own vector has seen; one that is not claims nothing.
  const g = membersOf(value.g, (s) => (isRecord(s) && isDot(s.dot) && vv[s.dot[0]] >= s.dot[1] && isHlc(s.at) ? { dot: [s.dot[0], s.dot[1]], at: s.at } : null));
  return typeof value.h === "string" && /^[0-9a-f]{64}$/.test(value.h) ? { vv, g, h: value.h } : { vv, g };
}

const isDot = (dot) => Array.isArray(dot) && dot.length === 2 && isId(dot[0]) && isCount(dot[1]);

function validTombstone(value) {
  return isRecord(value) && isHlc(value.at) ? { vv: versionVector(value.vv), at: value.at } : null;
}

function validKey(value) {
  if (!isRecord(value) || typeof value.salt !== "string" || !SALT.test(value.salt) || !isCount(value.n) || !isHlc(value.at) || typeof value.by !== "string") return null;
  return { salt: value.salt, n: value.n, at: value.at, by: value.by };
}

function validDevice(value) {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.platform !== "string" || !isHlc(value.addedAt)) return null;
  const device = { name: value.name, platform: value.platform, addedAt: value.addedAt };
  return isHlc(value.revokedAt) ? { ...device, revokedAt: value.revokedAt } : device;
}

/** @param {Sync} sync @returns {Hlc[]} */
function timesIn(sync) {
  return [
    sync.epoch.at,
    ...sync.keys.map((k) => k.at),
    ...Object.values(sync.meta).flatMap((m) => Object.values(m.g).map((s) => s.at)),
    ...Object.values(sync.gone).map((t) => t.at),
    ...Object.values(sync.histFloor),
    ...Object.values(sync.devices).flatMap((d) => (d.revokedAt ? [d.addedAt, d.revokedAt] : [d.addedAt])),
  ];
}
