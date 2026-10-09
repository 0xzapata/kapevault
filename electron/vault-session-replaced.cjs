// The one kept copy of a replaced vault (replaced.kapevault) and the staged copy beside it
// (replaced-next.kapevault), for vault-session. Owns those two paths and nothing else of the session:
// it needs only where the vault file is.
const fs = require("node:fs");
const path = require("node:path");
const core = require("../core/index.js");
const { openFile, parseVaultFile, MAX_VAULT_BYTES } = require("./vault-crypto.cjs");
const { writeFileAtomic } = require("./atomic-write.cjs");
const { newerResult } = require("./vault-session-newer.cjs");

function createReplacedCopy(filePath) {
  // A restore made while locked cannot upload the vault it replaces (no saved R2 keys, and typed keys
  // may be someone else's bucket), so the file is kept here first, as it is: still encrypted, opening
  // only with its own master password. One slot - a later restore never replaces it (keepReplacedCopy)
  // - and Settings can restore it or delete it. Nothing to keep when there is no vault here (a new PC).
  const replacedPath = path.join(path.dirname(filePath), "replaced.kapevault");
  const stagedPath = path.join(path.dirname(filePath), "replaced-next.kapevault");

  // An occupied slot is never overwritten (code "slot-taken"): after a lock-screen restore of someone's
  // own file it holds the real vault, and a second restore would wipe it without any password. The
  // caller offers to replace the vault with no copy kept instead; deleting the slot needs its password.
  // A staged vault still waiting for the slot counts as a kept one: nothing else may take the slot first.
  function keepReplacedCopy() {
    if (!fs.existsSync(filePath)) return;
    settleStagedCopy();
    if (fs.existsSync(replacedPath) || fs.existsSync(stagedPath)) throw Object.assign(new Error("A replaced vault is already kept."), { code: "slot-taken" });
    writeFileAtomic(replacedPath, fs.readFileSync(filePath));
  }

  // Restoring the replaced copy itself: the slot holds the backup being restored, so the current vault
  // waits beside it until the restore is written (commitRestore slot "staged"), then takes the slot.
  // A staged vault that could not be settled is never overwritten either.
  function stageReplacedCopy() {
    settleStagedCopy();
    if (fs.existsSync(stagedPath)) throw Object.assign(new Error("A replaced vault is still waiting to be kept."), { code: "slot-taken" });
    writeFileAtomic(stagedPath, fs.readFileSync(filePath));
  }

  function stagedIsLive() {
    try {
      return fs.readFileSync(stagedPath).equals(fs.readFileSync(filePath));
    } catch {
      return false;
    }
  }

  // commitRestore's last moves for a "staged" restore, and for a "clear" one while the slot still holds the
  // restored backup. They throw as the plain fs calls do; commitRestore decides what a failure means.
  function dropStaged() {
    fs.rmSync(stagedPath);
  }

  function promoteStaged() {
    fs.renameSync(stagedPath, replacedPath);
  }

  function clearIfHolds(text) {
    if (fs.existsSync(replacedPath) && fs.readFileSync(replacedPath).equals(Buffer.from(text))) fs.rmSync(replacedPath);
  }

  // A slot restore whose last move failed (or that died before it) leaves the vault it replaced as
  // replaced-next.kapevault. The copy is made from the vault file, the restore is written only while
  // the two still match (commitRestore), and every other write to the vault file settles first
  // (settleBeforeWrite). So a copy equal to the vault is one the restore never used (dropped), and one
  // that differs means the restore WAS written - saves may have followed. The slot then holds the
  // restored backup or nothing (keepReplacedCopy and staging wait while a copy is here), so the copy
  // takes it. A move that fails is tried again at the next start, save or restore; a file it cannot
  // read, or an unused copy it cannot drop, is thrown (see settleBeforeWrite). Never lost.
  function settleStagedCopy() {
    let staged;
    try {
      staged = fs.readFileSync(stagedPath);
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    if (staged.equals(fs.readFileSync(filePath))) return fs.rmSync(stagedPath, { force: true });
    try {
      fs.renameSync(stagedPath, replacedPath);
    } catch {
      // the restore is written, so this copy is proven: it waits for the slot, blocking any other copy
    }
  }

  // Before the vault file changes: once it changes, an unused staged copy (equal to it now) would read
  // as a written restore. So one that cannot be settled first stops the write.
  function settleBeforeWrite() {
    try {
      settleStagedCopy();
    } catch {
      throw new Error("Another program is holding a file in the KAPEVault folder, so nothing was changed. Try again in a moment.");
    }
  }

  // Whether a picked file is the slot, by file identity - however the path to it was spelled.
  function isReplacedCopy(file) {
    try {
      const a = fs.statSync(file, { bigint: true });
      const b = fs.statSync(replacedPath, { bigint: true });
      return a.dev === b.dev && a.ino === b.ino;
    } catch {
      return false;
    }
  }

  // Proof of owning a kept copy (the replaced vault, the old BOVault vault) before it is deleted: its
  // OWN master password opens it. Unlocked is not enough - a restore of someone's own file at the lock
  // screen leaves them unlocked in it. Nothing is kept: the key is wiped at once.
  async function proveCopy(file, master) {
    let opened;
    try {
      if (fs.statSync(file).size > MAX_VAULT_BYTES) throw new Error("too big");
      const bytes = fs.readFileSync(file);
      const parsed = parseVaultFile(bytes);
      if (!parsed && core.isNewerVaultFile(bytes)) return newerResult();
      if (!parsed) throw new Error("not a vault");
      opened = await openFile(String(master), parsed);
    } catch {
      return { ok: false, error: "That file is not a KAPEVault vault." };
    }
    if (!opened) return { ok: false, error: "Wrong master password for that vault." };
    opened.key.fill(0);
    return { ok: true };
  }

  // null only when there is none: a delete skips the password proof for a missing copy, so a stat that
  // fails any other way (antivirus holding it) is an error, never "nothing there".
  function replacedCopyInfo() {
    try {
      const { mtimeMs, size } = fs.statSync(replacedPath);
      return { path: replacedPath, at: mtimeMs, size };
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw new Error("The replaced vault cannot be read right now. Try again in a moment.");
    }
  }

  function deleteReplacedCopy() {
    fs.rmSync(replacedPath, { force: true });
  }

  return {
    keepReplacedCopy,
    stageReplacedCopy,
    settleStagedCopy,
    settleBeforeWrite,
    stagedIsLive,
    dropStaged,
    promoteStaged,
    clearIfHolds,
    isReplacedCopy,
    proveCopy,
    replacedCopyInfo,
    deleteReplacedCopy,
  };
}

module.exports = { createReplacedCopy };
