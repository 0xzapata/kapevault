// Sync's side of the session: read it, open a peer's snapshot, commit a merge (sync.cjs runs the loop).
// What it needs of the session comes through vault-session's context; it keeps no state of its own.
const core = require("../core/index.js");
const { openFile, openFileWithKey, parseVaultFile } = require("./vault-crypto.cjs");
const { writeFileAtomic } = require("./atomic-write.cjs");
const { newerResult } = require("./vault-session-newer.cjs");

/** @param {import("./vault-session.cjs").VaultContext} ctx */
function createSyncSide(ctx) {
  const { filePath, requireOpen, persist, commit, start, seal, ownSalts, hadSalt, installId, onPersist } = ctx;
  const { settleBeforeWrite } = ctx.replaced;

  function syncBase() {
    return { generation: ctx.generation, revision: ctx.revision, data: requireOpen() };
  }

  // A snapshot, opened with this session's key: no scrypt, no password (SYNC.md 3.5). otherKey: written
  // under another master password - behind when it is one this vault had before (that device has not
  // caught up yet). null: not a KAPEVault file, damaged, or made with another key on this salt.
  function openSnapshot(bytes) {
    requireOpen();
    const session = /** @type {import("./vault-session.cjs").Session} */ (ctx.session); // requireOpen threw if locked
    const file = parseVaultFile(bytes);
    if (!file) return null;
    if (file.kdf.salt !== session.salt.toString("base64")) return { otherKey: true, behind: hadSalt(file.kdf.salt) };
    const opened = openFileWithKey(session.key, file);
    return opened ? { data: opened.data, salt: file.kdf.salt } : null;
  }

  // A file of this vault: made under its master password now or an earlier one. False for another
  // vault's file and for anything that is not a vault file.
  function ownsFile(bytes) {
    requireOpen();
    const file = parseVaultFile(bytes);
    return Boolean(file) && ownSalts().includes(/** @type {any} */ (file).kdf.salt);
  }

  // A snapshot under a master password this vault has not seen (SYNC.md 3.6), opened with that
  // password - scrypt with the snapshot's own settings, checked first. The caller runs it through the
  // unlock throttle: a wrong password is a guess.
  async function openWithPassword(bytes, master) {
    requireOpen();
    const file = parseVaultFile(bytes);
    if (!file) return core.isNewerVaultFile(bytes) ? newerResult() : { ok: false, damaged: true, error: "That backup cannot be opened." };
    const opened = await openFile(String(master), file);
    return opened ? { ok: true, opened } : { ok: false, error: "Wrong master password." };
  }

  // The merged vault replaces this one only while nothing was saved since the merge read it; written
  // as it is. False when the vault changed or locked meanwhile: nothing is written.
  // rekey: another device's master password is adopted with the merge (SYNC.md 3.6) - { key, kdf, salt }
  // from openWithPassword. The file is written under it before the session switches to it, as
  // changeMaster does, and this device's older backups are flagged. The session keeps that key; a
  // failed write wipes it.
  /** @param {{ key: Buffer, kdf: any, salt: Buffer } | null} [rekey] */
  function commitSync(data, readAt, rekey = null) {
    if (!ctx.session || readAt !== ctx.revision) {
      rekey?.key.fill(0);
      return false;
    }
    if (!rekey) {
      ctx.session.data = data;
      persist({ bySync: true });
      return true;
    }
    const rekeyed = core.withKeySalt(data.cloud ? { ...data, olderBackupsPending: true } : data, rekey.salt.toString("base64"));
    try {
      settleBeforeWrite();
      const contents = seal(rekey.key, rekey.kdf, rekey.salt, rekeyed);
      writeFileAtomic(filePath, contents);
    } catch (e) {
      rekey.key.fill(0);
      throw e;
    }
    start({ key: rekey.key, kdf: rekey.kdf, salt: rekey.salt, data: rekeyed });
    onPersist({ bySync: true });
    return true;
  }

  // "Make this the vault on all devices" after a restore (SYNC.md 3.7): a new epoch, saved and backed up
  // like any change. id: a fresh one for it.
  function startEpoch(id) {
    commit((data) => {
      data.sync = core.newEpoch(data.sync, { id, installId: installId(), now: Date.now() });
    });
  }

  // Another device removed from sync: its snapshots are never merged again, here or on any device this
  // reaches.
  function revokeDevice(id) {
    commit((data) => {
      data.sync = core.revokeDevice(data.sync, { id, installId: installId(), now: Date.now() });
    });
  }

  // Sync results kept on this device (never merged). In memory until the next write carries them.
  function keepSyncLog(log) {
    requireOpen().syncLog = log;
  }

  return { syncBase, openSnapshot, ownsFile, openWithPassword, commitSync, startEpoch, revokeDevice, keepSyncLog };
}

module.exports = { createSyncSide };
