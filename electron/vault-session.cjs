// The unlocked vault lives here, in the main process. The renderer only ever gets publicView():
// secrets (passwords, 2FA keys, secure note bodies, API key secrets, old passwords, backup codes,
// security question answers, a device's admin and Wi-Fi passwords and label photo, an ID's number and
// photo) are stripped and handed out one at a time through getSecret() (the backup code grid:
// getRecoveryCodes()).
// The vault's data rules live in core/ (shared with the phone); this file is the PC's host around
// them: the key, the file on disk, and the steps that need Node.
// This file owns the session itself (key, data, the last saved copy, persist with its rollback, start,
// lock, the unlock paths, change master). The rest is split by what it touches and receives only the
// VaultContext below: vault-session-items (changing items, spaces, history), -reads (lookups and
// secrets), -sync (sync's side), -backup (cloud setup, restore), -replaced (the kept replaced copy),
// -folders (which folders may be linked), -newer (the "update the app" result).
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const core = require("../core/index.js");
const { createKey, openFile, openFileWithKey, encryptWithKey, MAX_VAULT_BYTES } = require("./vault-crypto.cjs");
const { createItems } = require("./vault-session-items.cjs");
const { createBackup } = require("./vault-session-backup.cjs");
const { createSyncSide } = require("./vault-session-sync.cjs");
const { createReads } = require("./vault-session-reads.cjs");
const { createReplacedCopy } = require("./vault-session-replaced.cjs");
const { newerResult, isNewer } = require("./vault-session-newer.cjs");
const { writeFileAtomic, sweepStale } = require("./atomic-write.cjs");

const TOO_BIG = "The vault would be too big to back up (over 64 MB), so this was not saved. Remove some photos or long notes first.";

const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

/**
 * @typedef {{ key: Buffer, kdf: any, salt: Buffer, data: any }} Session
 * @typedef {object} VaultContext What createVaultSession hands each feature module: the open session and
 *   the steps that change it. A module reaches nothing else of the closure.
 * @property {string} filePath The vault file.
 * @property {Session | null} session The open session, null while locked (read each time: it is replaced
 *   by every open, restore and re-key).
 * @property {() => any} requireOpen The open vault data; throws "Vault is locked".
 * @property {(id: string) => any} findLiveEntry
 * @property {(options?: { backup?: boolean, bySync?: boolean }) => void} persist
 * @property {(change: (data: any) => void) => any} commit One change to the open vault, saved, then the page's view.
 * @property {() => any} publicView
 * @property {number} generation Sessions started so far (every open, restore and re-key starts one).
 * @property {number} revision Sessions and saves so far: a merge read at one revision is written only at that one.
 * @property {ReturnType<typeof createReplacedCopy>} replaced
 * @property {() => string} installId
 * @property {(change: { bySync: boolean }) => void} onPersist
 * @property {(opened: Session) => void} start Begin a session from a file just read or written; wipes the previous key.
 * @property {(key: Buffer, kdf: any, salt: Buffer, data: any) => string} seal The vault's file contents; throws when too big.
 * @property {() => string[]} ownSalts Every master password salt this vault has had.
 * @property {(salt: string) => boolean} hadSalt
 */

// onPersist({ bySync }) runs after every write to disk that should reach the cloud backup; bySync:
// sync's own save, which must not start another sync.
// installId(): this install's id, which sync stamps changes with ("" when settings.json could not be
// read this run: nothing is stamped, and the next open's repair catches up).
function createVaultSession(filePath, { onPersist = (_change) => {}, installId = () => "" } = {}) {
  sweepStale(path.dirname(filePath)); // temp files a hard kill left beside the vault
  const replaced = createReplacedCopy(filePath);
  const { settleBeforeWrite, keepReplacedCopy, stageReplacedCopy, settleStagedCopy, isReplacedCopy, proveCopy, replacedCopyInfo, deleteReplacedCopy } = replaced;
  let session = null; // { key, kdf, salt, data } while unlocked
  // session.data as last opened or saved. Changes replace its top-level fields (entries, spaces, cloud,
  // sync) and never edit them in place, so this shallow copy is the whole state a failed save goes back to.
  let saved = null;
  // The last master-password unlock found the master too easy to guess. Only this boolean is kept, never
  // the password or its score; lock() and every new session (Hello, restore, change master) reset it.
  let masterWeak = false;
  // For sync's commit: generation counts sessions (every open, restore and re-key starts one), revision
  // counts sessions and saves - a merge read at one revision may only be written at that revision.
  let generation = 0;
  let revision = 0;
  // Every salt each vault closed this run has had (vaultId -> Set), recorded as its session ends. An older
  // snapshot of a vault lists no master password set after it, yet a copy of the vault (the folder copy)
  // may be under one - after a restore from the lock screen too. Keyed by vaultId, so it never vouches
  // for another vault's file. Salts are not secret (every file header carries one).
  const seenSalts = new Map();

  const stampContext = () => ({ installId: installId(), now: Date.now(), sha256 });

  // Every session starts from a file just read or written. Any previous key is wiped first. Every
  // caller has proven the key belongs to this header's salt (a master password derived it, or
  // unlockWithKey checked keySalt first): core.openedVault marks it, opens due dates as notes and reads
  // and repairs the sync object.
  function start(opened) {
    lock();
    const data = core.openedVault(opened.data, opened.salt.toString("base64"), stampContext());
    session = { ...opened, data };
    saved = { ...session.data };
    generation++;
    revision++;
  }

  function requireOpen() {
    if (!session) throw new Error("Vault is locked");
    return session.data;
  }

  // Secrets, codes and links never come out of an item in the Trash (core/entries.js).
  function findLiveEntry(id) {
    return core.findLiveEntry(requireOpen(), id);
  }

  // The vault encrypted under a key, as it goes to disk. Bigger than any restore or the Forever Opener
  // would read back: refused like a failed write.
  function seal(key, kdf, salt, data) {
    const contents = JSON.stringify(encryptWithKey(key, kdf, salt, data));
    if (Buffer.byteLength(contents) > MAX_VAULT_BYTES) throw new Error(TOO_BIG);
    return contents;
  }

  // Write to a temp file, then swap it in - a crash never leaves half a vault. No .bak on purpose:
  // an old copy would still open with a changed master password and keep deleted secrets alive.
  // backup: false for bookkeeping only (recently used) - it is saved, but does not upload a snapshot.
  // Every save stamps what changed since the last one, here and nowhere else, so no change can reach
  // the disk unstamped. Stamping replaces `sync`, so a failed save rolls it back with the rest.
  // bySync: sync's own save writes the merged vault as it is - merge never stamps, and restamping it
  // as this device's edit would win conflicts it never took part in.
  function persist({ backup = true, bySync = false } = {}) {
    try {
      settleBeforeWrite();
      // Items 30 days in the Trash go with any save of ours, so stamp() sees the delete and sync carries
      // it. Not on sync's own save: merge never edits what it writes.
      if (!bySync) core.purgeTrash(session.data);
      if (!bySync) core.purgeGenerated(session.data);
      if (!bySync) session.data.sync = core.stamp(saved, session.data, stampContext());
      const contents = seal(session.key, session.kdf, session.salt, session.data);
      writeFileAtomic(filePath, contents);
    } catch (e) {
      // A change that did not reach the disk is dropped from memory too, so the page never shows it
      // and no later save carries it: a retried add is not doubled, a failed delete never happens later.
      session.data = { ...saved };
      throw e;
    }
    saved = { ...session.data };
    revision++;
    if (backup) onPersist({ bySync });
  }

  // Every master password this vault has had: now, its key history, and any seen earlier this run.
  function ownSalts() {
    const { data, salt } = session;
    return [salt.toString("base64"), ...data.sync.keys.map((k) => k.salt), ...(seenSalts.get(data.sync.vaultId) ?? [])];
  }

  const hadSalt = (salt) => session.data.sync.keys.some((k) => k.salt === salt);

  // One change core makes to the open vault, saved, then the page's new view.
  function commit(change) {
    change(requireOpen());
    persist();
    return publicView();
  }

  function publicView() {
    const data = requireOpen();
    return { ...core.publicView(data, core.findIssues(data.entries, core.today(), sha256)), masterWeak };
  }

  function status() {
    return { exists: fs.existsSync(filePath), unlocked: session !== null, path: filePath };
  }

  async function create(master) {
    if (fs.existsSync(filePath)) return { ok: false, error: "A vault already exists." };
    const problem = core.masterProblem(master);
    if (problem) return { ok: false, error: problem };
    start({ ...(await createKey(master)), data: core.newVaultData() });
    try {
      persist();
    } catch (e) {
      lock(); // not on disk, so not a vault
      throw e;
    }
    return { ok: true, vault: publicView() };
  }

  function readFile() {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  async function unlock(master) {
    const file = readFile();
    if (!file) return { ok: false, error: "The vault file is missing or damaged." };
    let opened;
    try {
      opened = await openFile(master, file);
    } catch (e) {
      if (isNewer(e)) return newerResult();
      throw e;
    }
    if (!opened) return { ok: false, error: "Wrong master password." };
    // A damaged sync object can make core.openedVault throw: the derived key must not outlive that.
    // A newer vault's data (minReader, sync.v) is refused there, before anything is saved.
    let unmarked;
    try {
      unmarked = !core.keySaltMatches(opened.data, file.kdf.salt);
      start(opened);
    } catch (e) {
      opened.key.fill(0);
      if (isNewer(e)) return newerResult();
      throw e;
    }
    masterWeak = core.masterProblem(master) !== null;
    // A vault from before keySalt (or one a key unlock refused) gets it on disk now, so the next
    // Windows Hello / Touch ID unlock works. A refused write only means the master is asked again.
    if (unmarked) {
      try {
        persist({ backup: false });
      } catch {
        // written with the next save
      }
    }
    sweepTrash();
    return { ok: true, vault: publicView() };
  }

  // On unlock, what has been 30 days in the Trash goes now rather than at the next edit. A refused
  // write only means it goes with the next save (persist purges too).
  function sweepTrash() {
    if (!core.hasExpiredTrash(session.data)) return;
    try {
      persist();
    } catch {
      // purged by the next save
    }
  }

  // Windows Hello hands back the vault key itself. A key that no longer fits (the vault was restored
  // or re-keyed elsewhere) fails like a wrong password; the caller turns Hello off.
  function unlockWithKey(key) {
    const file = readFile();
    let opened = null;
    try {
      opened = file && openFileWithKey(key, file);
    } catch (e) {
      if (isNewer(e)) {
        key.fill(0);
        return newerResult();
      }
      opened = null;
    }
    if (!opened) {
      key.fill(0);
      return { ok: false, error: "The vault file is missing or damaged." };
    }
    // The key opens the data, but the header's salt may have been edited (it is not covered by the
    // tag): saving now would write a header the master password no longer opens. masterRequired:
    // the key still fits, so the caller keeps Hello on and asks for the master password.
    if (!core.keySaltMatches(opened.data, file.kdf.salt)) {
      key.fill(0);
      return { ok: false, masterRequired: true, error: "Enter your master password to unlock this time." };
    }
    try {
      start(opened); // the same throw unlock() guards against
    } catch (e) {
      opened.key.fill(0);
      key.fill(0);
      if (isNewer(e)) return newerResult();
      throw e;
    }
    sweepTrash();
    return { ok: true, vault: publicView() };
  }

  function lock() {
    if (session) {
      seenSalts.set(session.data.sync.vaultId, new Set(ownSalts()));
      session.key.fill(0);
    }
    session = null;
    saved = null;
    masterWeak = false;
  }

  // A copy of the live key for Windows Hello to wrap. The caller zeroes it when done.
  function keyCopy() {
    requireOpen();
    return Buffer.from(session.key);
  }

  async function changeMaster(current, next) {
    requireOpen();
    const problem = core.masterProblem(next);
    // rule: the new password was refused before the current one was tried - not a guess to count.
    if (problem) return { ok: false, error: problem, rule: true };
    const file = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const check = await openFile(current, file);
    if (!check) return { ok: false, error: "Current password is wrong." };
    check.key.fill(0);

    const fresh = await createKey(next);
    // Auto-lock can fire during the awaits above; re-check before touching the session.
    const data = requireOpen();
    // Write with the new key BEFORE switching to it: if the write fails, the session keeps the
    // password that is actually on disk instead of one the user was told did not take.
    // Cloud snapshots made before now still open with the OLD password; Settings keeps offering to
    // delete them until that is done - flagged only in the copy that is written, so a failed change
    // flags nothing.
    const rekeyed = core.withKeySalt({ ...data, sync: core.addKey(data.sync, { salt: fresh.salt.toString("base64"), installId: installId(), now: Date.now() }) }, fresh.salt.toString("base64"));
    if (data.cloud) rekeyed.olderBackupsPending = true;
    try {
      settleBeforeWrite();
      writeFileAtomic(filePath, JSON.stringify(encryptWithKey(fresh.key, fresh.kdf, fresh.salt, rekeyed)));
    } catch (e) {
      fresh.key.fill(0);
      throw e;
    }
    start({ ...fresh, data: rekeyed });
    onPersist({ bySync: false });
    return { ok: true };
  }

  /**
   * What the feature modules get of this closure: the open session and the steps that change it. They
   * reach nothing else of it.
   * @type {VaultContext}
   */
  const ctx = {
    filePath,
    get session() {
      return session;
    },
    get generation() {
      return generation;
    },
    get revision() {
      return revision;
    },
    replaced,
    installId,
    onPersist,
    start,
    seal,
    ownSalts,
    hadSalt,
    requireOpen,
    findLiveEntry,
    persist,
    commit,
    publicView,
  };
  const { linkedFolders, openTarget, handBack, getSecret, getPassword, getTotpCode, followUpsDue, getRecoveryCodes } = createReads(ctx);
  const { saveEntry, importEntries, deleteEntry, restoreEntry, deleteForever, emptyTrash, toggleFavorite, moveEntry, setRecoveryCodes, markRecoveryCode, addPaperCopy, removePaperCopy, setLifecycle, confirmGone, touch, addSpace, renameSpace, setSpacePhoto, deleteSpace, clearHistory, recordGenerated, generatedList, getGenerated, clearGenerated } = createItems(ctx);
  const { syncBase, openSnapshot, ownsFile, openWithPassword, commitSync, startEpoch, revokeDevice, keepSyncLog } = createSyncSide(ctx);
  const { cloudConfig, cloudView, clearOlderBackups, setCloud, setCloudAuto, verifyBackup, commitRestore } = createBackup(ctx);

  return {
    status,
    create,
    unlock,
    unlockWithKey,
    lock,
    keyCopy,
    publicView,
    linkedFolders,
    openTarget,
    handBack,
    saveEntry,
    importEntries,
    deleteEntry,
    restoreEntry,
    deleteForever,
    emptyTrash,
    toggleFavorite,
    setRecoveryCodes,
    markRecoveryCode,
    addPaperCopy,
    removePaperCopy,
    getRecoveryCodes,
    setLifecycle,
    confirmGone,
    followUpsDue,
    moveEntry,
    touch,
    addSpace,
    renameSpace,
    setSpacePhoto,
    deleteSpace,
    getPassword,
    getSecret,
    getTotpCode,
    clearHistory,
    recordGenerated,
    generatedList,
    getGenerated,
    clearGenerated,
    changeMaster,
    cloudConfig,
    cloudView,
    clearOlderBackups,
    setCloud,
    setCloudAuto,
    verifyBackup,
    commitRestore,
    syncBase,
    openSnapshot,
    ownsFile,
    openWithPassword,
    commitSync,
    startEpoch,
    revokeDevice,
    keepSyncLog,
    keepReplacedCopy,
    stageReplacedCopy,
    settleStagedCopy,
    isReplacedCopy,
    proveCopy,
    replacedCopyInfo,
    deleteReplacedCopy,
  };
}

module.exports = { createVaultSession };
