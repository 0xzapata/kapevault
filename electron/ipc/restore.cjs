// Restores: from a saved file, from the replaced slot, and from a cloud snapshot. The order and the
// refusals live in restore.cjs; this wires them to the page and to what follows a restore.
const fs = require("node:fs");
const path = require("node:path");
const { dialog } = require("electron");
const { createRestores } = require("../restore.cjs");
const { parseVaultFile, MAX_VAULT_BYTES } = require("../vault-crypto.cjs");

function register({ handle, attempt, requireUnlocked, vault, cloud, sync, folderCopy, throttledUnlock, proveOwnsCopy, vaultStatus, clearCopiedPassword, setLastMasterAt, changed, unlocked, biometricKeyChanged, windows, isMac }) {
  let pendingRestore = null; // { text, name } picked in the file dialog, until its password is checked

  // Restores (a file, the replaced slot, a cloud snapshot): the order and the refusals are in restore.cjs.
  const restores = createRestores({ vault, cloud, throttledUnlock, device: isMac ? "Mac" : "PC" });

  // Restore from a saved copy, in two steps: pick the file, then prove its master password.
  // Nothing on this PC changes until that password opens the backup.
  handle("restore:pickFile", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(windows.main(), {
      title: "Restore KAPEVault from a file",
      filters: [{ name: "KAPEVault vault", extensions: ["kapevault", "bovault"] }], // .bovault = saved before the rename
      properties: ["openFile", "dontAddToRecent"],
    });
    if (canceled || !filePaths[0]) return { ok: false, canceled: true };
    return pendRestore(filePaths[0]);
  });
  // The vault a restore replaced (the local slot) goes back the same way: its own master password is
  // asked next, through restore:fromFile. The page never names the path.
  handle("restore:pickReplaced", () =>
    attempt(() => {
      const copy = vault.replacedCopyInfo();
      return copy ? pendRestore(copy.path) : { ok: false, error: "There is no replaced vault to restore." };
    }),
  );
  // The file is read now and held until its password is proven; the copy on disk may go meanwhile.
  // fromReplaced: it is the replaced slot itself, however it was picked.
  function pendRestore(file) {
    try {
      const info = fs.statSync(file);
      if (!info.isFile() || info.size > MAX_VAULT_BYTES) throw new Error("too big");
      const text = fs.readFileSync(file, "utf8");
      if (!parseVaultFile(text)) throw new Error("not a vault");
      pendingRestore = { text, name: path.basename(file), fromReplaced: vault.isReplacedCopy(file) };
      return { ok: true, name: pendingRestore.name };
    } catch {
      pendingRestore = null;
      return { ok: false, error: "That file is not a KAPEVault vault." };
    }
  }

  // Deleting the replaced vault loses the way back from that restore: the page confirms first.
  handle("restore:deleteReplaced", (master) =>
    attempt(async () => {
      requireUnlocked();
      const copy = vault.replacedCopyInfo();
      if (copy) await proveOwnsCopy(copy.path, master);
      vault.deleteReplacedCopy();
      return { status: vaultStatus() };
    }),
  );

  // What follows every restore (file, slot or cloud), run as soon as it is written and before any
  // await, so a lock meanwhile is never followed by its unlock.
  function afterRestore(restored) {
    clearCopiedPassword();
    setLastMasterAt(Date.now()); // it was opened with that backup's master password
    sync.pauseAfterRestore();
    changed(restored.vault); // an open window shows the restored vault
    unlocked(restored); // the lock screen (and quick search) open it
    cloud.schedule();
    folderCopy.schedule();
  }

  // Never alongside a sync or a master password change. The restored vault has a different key, so
  // Windows Hello / Touch ID goes off.
  async function runRestore(request, onRestored) {
    const result = await sync.exclusive("restore", () => restores.restore(request, onRestored));
    if (result.ok) await biometricKeyChanged();
    return result;
  }

  // The picked file (or the replaced slot) with its own master password; see restores.restore.
  // current: the vault here's own master password, asked for (needsMaster) only to replace it without a
  // copy while locked.
  handle("restore:fromFile", (master, confirmed, current) =>
    attempt(() => {
      const pending = pendingRestore; // a pick while this runs must not swap the file under the proven password
      if (!pending) return { ok: false, error: "Choose the backup file first." };
      const request = { load: () => pending.text, fromReplaced: pending.fromReplaced, master, confirmed, current };
      return runRestore(request, (restored) => {
        if (pendingRestore === pending) pendingRestore = null;
        afterRestore(restored);
      });
    }),
  );

  // Same order as a file restore: nothing on this PC changes until the backup's own master password
  // opens it, and the current vault is kept first (never uploaded with keys typed for the restore:
  // they may be someone else's bucket). If it cannot be kept, nothing is replaced - unless it could not
  // be kept locally (the slot is taken, or the disk refused) and the page confirmed replacing it with no
  // copy kept (confirmed, the second click; the lock screen has no other way to a restore then - locked,
  // with the vault here's own master password, current). Then the restored vault opens straight away.
  handle("cloud:restore", (key, input, master, confirmed, current) =>
    attempt(() => {
      const load = async () => (await cloud.download(String(key), input ?? undefined)).toString("utf8");
      return runRestore({ load, master, confirmed, current }, afterRestore);
    }),
  );
}

module.exports = { register };
