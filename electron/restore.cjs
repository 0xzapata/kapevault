// Restoring a backup over this device's vault: a saved file, the replaced slot, or a cloud snapshot.
// The order and the refusals live here, apart from Electron, so tests can hold them; main.cjs wires
// the IPC and what follows a restore (the unlock it broadcasts, turning biometrics off).
// device: "PC" or "Mac", for the page's words.
function createRestores({ vault, cloud, throttledUnlock, device }) {
  // Before any restore replaces the vault on this device, it is kept: uploaded to the SAVED bucket when
  // the vault is unlocked with cloud backup on, otherwise copied beside it as it is on disk (one slot,
  // vault.keepReplacedCopy). fromReplaced: the backup IS that slot, so the current vault is only staged
  // beside it (vault.stageReplacedCopy) and takes the slot once the restore is written.
  // Returns { kept: "cloud" | "local" | null (no vault here, a new PC), cloud } - cloud is this device's
  // R2 setup, read BEFORE the upload: the vault can lock while it runs, and commitRestore must still keep
  // the setup the replaced vault went to.
  // Throws if it could not be kept. A local copy that failed, or a slot already holding a replaced vault
  // (never overwritten, see vault.keepReplacedCopy), is marked `local` and its message is the question
  // the page asks before a restore replaces the vault with no copy kept.
  async function keepBeforeRestore(fromReplaced = false) {
    const config = vault.cloudConfig(); // null while locked
    if (!vault.status().exists) return { kept: null, cloud: config };
    if (config) {
      await cloud.saveBeforeRestore();
      return { kept: "cloud", cloud: config };
    }
    try {
      if (fromReplaced) vault.stageReplacedCopy();
      else vault.keepReplacedCopy();
    } catch (e) {
      const message =
        e.code === "slot-taken"
          ? `A replaced vault is already kept on this ${device}, and it stays as it is. Replace the vault here without keeping a copy, or first restore or delete the kept one in Settings > Backup.`
          : "A copy of the vault on this device could not be kept. Save an encrypted copy first, or replace it with no copy kept.";
      throw Object.assign(new Error(message), { local: true });
    }
    return { kept: "local", cloud: null };
  }

  // Order matters: 1) the backup's password is proven, 2) the current vault is kept (keepBeforeRestore),
  // 3) only then is it replaced. Only when even the local copy fails must the page confirm replacing
  // it with no copy kept (confirmed, the second click) - never silently. keptCopy: the replaced vault
  // is in the local slot; keptCloud: it went to this device's bucket, whose setup stayed
  // (commitRestore). Restoring the slot itself swaps it with the current vault, or clears it when that
  // went to R2 - never a slot that only repeats the vault now open.
  // load: the backup's text (a download may throw). onRestored(result) runs as soon as the restore is
  // written, before any await: a lock meanwhile must never be followed by its unlock.
  // One at a time, from its download to its write: a second restore (file, slot or cloud) meanwhile is
  // refused. Raced, an auto-lock during the first one's upload let the second fill the slot, and the
  // first then worked from a vault and a slot that were no longer the ones it checked.
  let running = false;
  async function restore(request, onRestored) {
    if (running) return { ok: false, error: "A restore is already running." };
    running = true;
    try {
      return await restoreNow(request, onRestored);
    } finally {
      running = false;
    }
  }

  async function restoreNow({ load, fromReplaced = false, master, confirmed, current }, onRestored) {
    const text = await load();
    // The backup's own password, not this vault's: a success never clears the miss count (audit finding L1
    // in SECURITY-AUDIT-2026-09-28.md: restoring your own backup at the lock screen reset it between guesses).
    const check = await throttledUnlock(() => vault.verifyBackup(text, String(master ?? "")), { local: false });
    if (!check.ok) return check;
    // check.carry: what the vault here keeps through the restore (its device removals, and its key after a
    // lock-out), read before keepBeforeRestore's upload; its key copy is wiped with the backup's.
    const abort = (result) => {
      check.opened.key.fill(0);
      check.carry?.key?.key.fill(0);
      return result;
    };
    let keep = null; // stays null when nothing could be kept and the page confirmed replacing anyway
    try {
      keep = await keepBeforeRestore(fromReplaced);
    } catch (e) {
      if (!e.local) return abort({ ok: false, error: e.message });
      // Locked, a confirm alone would let anyone at the keyboard wipe the vault here with a backup of
      // their own. So it also needs the CURRENT vault's own master password (needsMaster), proven the
      // way a kept copy's delete is: it opens the vault file, through the throttle, key wiped at once.
      // Unlocked, the open session is that proof.
      const needsMaster = !vault.status().unlocked;
      const ask = (error) => abort({ ok: false, needsConfirm: true, ...(needsMaster && { needsMaster: true }), error });
      if (confirmed !== true || (needsMaster && !current)) return ask(e.message);
      if (needsMaster) {
        const proof = await throttledUnlock(() => vault.proveCopy(vault.status().path, String(current)));
        if (!proof.ok) return ask(proof.error);
      }
    }
    // Restoring the slot itself, the slot follows what happened: the vault it replaces was staged and
    // takes it, or went to R2 (or there was none) and the slot would only repeat the restored vault.
    // Nothing kept: the slot stays, as the confirm said.
    let slot;
    if (fromReplaced && keep) slot = keep.kept === "local" ? "staged" : "clear";
    const { slotOk, ...result } = vault.commitRestore(text, check.opened, { cloud: keep?.cloud ?? null, slot, carry: check.carry });
    onRestored(result);
    return { ...result, keptCopy: keep?.kept === "local" && slotOk };
  }

  return { restore };
}

module.exports = { createRestores };
