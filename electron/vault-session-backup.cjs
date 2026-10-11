// This device's cloud backup setup and restoring a backup over the vault. The R2 setup lives inside the
// encrypted vault, so it is changed through the context's persist like any other field; a restore
// swaps the whole session through start() once the file is written.
const core = require("../core/index.js");
const { openFile, encryptWithKey, parseVaultFile } = require("./vault-crypto.cjs");
const { writeFileAtomic } = require("./atomic-write.cjs");
const { newerResult, isNewer } = require("./vault-session-newer.cjs");

/** @param {import("./vault-session.cjs").VaultContext} ctx */
function createBackup(ctx) {
  const { filePath, requireOpen, persist, publicView, start, replaced } = ctx;

  // R2 credentials live inside the encrypted vault. Main gets the full config; the page only
  // ever sees cloudView(), which has no secret.
  function cloudConfig() {
    return ctx.session?.data.cloud ?? null;
  }

  function cloudView() {
    const c = cloudConfig();
    return c ? { url: `${c.endpoint}/${c.bucket}`, accessKeyId: c.accessKeyId, auto: c.auto, olderBackups: Boolean(requireOpen().olderBackupsPending) } : null;
  }

  // The older backups were deleted: stop offering it.
  function clearOlderBackups() {
    const data = requireOpen();
    if (!data.olderBackupsPending) return;
    delete data.olderBackupsPending;
    persist({ backup: false });
  }

  // config comes checked from cloud-backup's configFromInput; null disconnects.
  function setCloud(config) {
    const data = requireOpen();
    data.cloud = config ?? undefined;
    persist();
  }

  function setCloudAuto(auto) {
    const data = requireOpen();
    if (!data.cloud) throw new Error("Cloud backup is not set up.");
    data.cloud = { ...data.cloud, auto: Boolean(auto) };
    persist();
  }

  // Restore (a saved copy or a cloud snapshot), in two steps so the caller can save the current vault in between:
  // verifyBackup opens the backup with its master password WITHOUT touching this PC's vault,
  // commitRestore then swaps it in. A wrong file or password never costs the current vault. carry: what
  // the restore must keep of this vault (restoreCarry), passed on to commitRestore.
  async function verifyBackup(text, master) {
    const file = parseVaultFile(text);
    if (!file && core.isNewerVaultFile(text)) return newerResult();
    let opened;
    try {
      if (!file) throw new Error("not a vault");
      opened = await openFile(String(master), file);
    } catch {
      return { ok: false, error: "That file is not a KAPEVault vault." };
    }
    if (!opened) return { ok: false, error: "Wrong master password for that backup." };
    // Its data can be a newer app's under a header this app reads: commitRestore would write it, then refuse to start it.
    try {
      core.checkReader(opened.data);
    } catch (e) {
      opened.key.fill(0);
      if (isNewer(e)) return newerResult();
      throw e;
    }
    const sameVault = isSameVault(opened);
    return { ok: true, opened, sameVault, carry: sameVault ? restoreCarry(opened) : null };
  }

  // Whether the backup is an earlier state of the vault open now (same sync.vaultId). Only then does a
  // restore carry anything of it (audit run-1 4.1): unlocked in someone else's vault - one they handed
  // over, or restored at the lock screen - restoring your own must never take their key, device removals
  // or R2 setup. False while locked: there is no open vault to compare.
  function isSameVault(opened) {
    const session = ctx.session;
    if (!session) return false;
    return core.readSync(opened.data, opened.salt.toString("base64")).vaultId === session.data.sync.vaultId;
  }

  // What a restore keeps of the vault it replaces (SYNC.md 3.7, core carryLockOut): its device removals,
  // and its key when the backup is under a master password a lock-out retired - then `key` is a copy of
  // this vault's key, which the caller wipes if the restore stops before commitRestore. Read by
  // verifyBackup, so before the restore's upload, like the R2 setup (the vault may lock meanwhile). Null
  // while locked: the vault it replaces cannot be read, so there is nothing to keep (SYNC.md 3.7).
  /** @returns {{ sync: any, key: { key: Buffer, kdf: any, salt: Buffer } | null } | null} */
  function restoreCarry(opened) {
    const session = ctx.session;
    if (!session) return null;
    const backupSalt = opened.salt.toString("base64");
    const { sync, keepKey } = core.carryLockOut(session.data.sync, session.salt.toString("base64"), core.readSync(opened.data, backupSalt), backupSalt);
    return { sync, key: keepKey ? { key: Buffer.from(session.key), kdf: session.kdf, salt: Buffer.from(session.salt) } : null };
  }

  // Write first: if the disk refuses (full, antivirus, a sync lock), the current session stays
  // exactly as it was and the backup's key is wiped.
  // cloud: this device's R2 setup, read by the caller BEFORE it uploaded the replaced vault (the vault
  // may lock meanwhile). R2 keys are this device's setup, not vault content: an unlocked restore keeps
  // this device's (keptCloud, so the page can say so) rather than quietly backing up to the backup's
  // bucket. Locked, there are none to keep and the backup's own come with it.
  // slot: when the backup IS the replaced copy - "staged" moves the vault it replaced (stageReplacedCopy)
  // into the slot, "clear" deletes the slot while it still holds the restored backup (the replaced
  // vault went to R2) - never a vault another restore put there meanwhile. Only after the write, and
  // never thrown: the restore has happened. slotOk: false when that last step failed.
  // A "staged" restore is written only while the staged copy is still the vault byte for byte - the
  // proof settleStagedCopy relies on. Any other restore settles a staged copy first, like every write.
  // carry: verifyBackup's (restoreCarry), read before the upload. Its removals go into the restored vault; with its
  // key, the restored vault is written under the key of the vault it replaces (keptKey), never under a
  // master password a lock-out retired.
  /** @param {string} text @param {any} opened @param {{ cloud?: any, slot?: string, carry?: ReturnType<typeof restoreCarry> }} [options] */
  function commitRestore(text, opened, { cloud = null, slot, carry = null } = {}) {
    let contents = text;
    if (carry?.key) {
      opened.key.fill(0);
      opened = { ...opened, ...carry.key, data: core.withKeySalt(opened.data, carry.key.salt.toString("base64")) };
    }
    try {
      if (slot !== "staged") replaced.settleBeforeWrite();
      else if (!replaced.stagedIsLive()) throw new Error("The vault changed while it was being restored, so nothing was replaced. Try again.");
      if (cloud || carry) {
        opened.data = { ...opened.data, ...(cloud && { cloud }), ...(carry && { sync: carry.sync }) };
        contents = JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, opened.data));
      }
      writeFileAtomic(filePath, contents);
    } catch (e) {
      opened.key.fill(0);
      try {
        if (slot === "staged" && replaced.stagedIsLive()) replaced.dropStaged(); // unused: it only repeats the vault
      } catch {
        // dropped by the settle before the next write, which waits for it
      }
      throw e;
    }
    start(opened);
    let slotOk = true;
    try {
      if (slot === "staged") replaced.promoteStaged();
      if (slot === "clear") replaced.clearIfHolds(text);
    } catch {
      slotOk = false; // the staged vault stays on disk as replaced-next.kapevault
    }
    return { ok: true, vault: publicView(), keptCloud: Boolean(cloud), keptKey: Boolean(carry?.key), slotOk };
  }

  return { cloudConfig, cloudView, clearOlderBackups, setCloud, setCloudAuto, verifyBackup, commitRestore };
}

module.exports = { createBackup };
