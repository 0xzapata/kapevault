// "Keep a copy in a folder": after every save the vault file is copied as it is (ciphertext) into a
// folder the user picked once - a OneDrive, Google Drive or Dropbox folder carries it off this PC -
// with the Forever Opener beside it. A local write, so it works under Air Wall. Debounced like the
// R2 backup, and flushed before lock and quit.
const fs = require("node:fs");
const path = require("node:path");
const { writeFileAtomic } = require("./atomic-write.cjs");
const { isNetworkPath } = require("./file-access.cjs");
const { writeOpenerBeside } = require("./opener.cjs");
const { MAX_VAULT_BYTES } = require("./vault-crypto.cjs");

const COPY_NAME = "KAPEVault backup.kapevault";
const NOTHING_YET = { at: null, error: "", opener: null };
const FOREIGN = "That folder holds a copy of a different vault. Restore it, move it out of the folder, or choose another folder.";

// The folder as it will be saved, or a plain reason. Network paths are refused by name before any
// disk call (touching one offers Windows' NTLM hash to that host).
function checkCopyFolder(dir, vaultDir) {
  if (isNetworkPath(String(dir))) throw new Error("Network folders cannot be used. Choose a folder on this PC - OneDrive, Google Drive and Dropbox folders work.");
  if (typeof dir !== "string" || !path.isAbsolute(dir)) throw new Error("Choose a folder on this PC.");
  const folder = path.resolve(dir);
  if (!fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) throw new Error("That folder is not there.");
  if (folder.toLowerCase() === path.resolve(vaultDir).toLowerCase()) throw new Error("Choose a folder outside KAPEVault's own.");
  return folder;
}

// The vault file as it is, written atomically, with the Forever Opener beside it: "Save encrypted
// copy" and the folder copy. The opener's outcome is returned; its failure never fails the copy.
function copyVaultWithOpener(vaultPath, file, version) {
  writeFileAtomic(file, fs.readFileSync(vaultPath));
  try {
    return writeOpenerBeside(path.dirname(file), version);
  } catch {
    return "failed";
  }
}

function reason(e) {
  if (e.message === FOREIGN) return FOREIGN;
  if (e.code === "ENOENT") return "The folder is not there. Plug the drive in, or choose another folder.";
  if (e.code === "EACCES" || e.code === "EPERM") return "KAPEVault may not write to that folder.";
  return "Could not copy the vault to that folder.";
}

// folder() / setFolder(dir): the path kept in settings.json, which only ever holds a checked, local one
// (checkCopyFolder here, the network check when it is read). ownsFile(bytes): a file of this vault
// (vault-session). onStatus(status) runs after every change.
function createFolderCopy({ vaultPath, folder, setFolder, ownsFile, version, delayMs, onStatus = () => {} }) {
  let timer = null;
  let last = NOTHING_YET;

  // Never over a copy this vault cannot prove is its own: another vault's (a dead PC's only copy, a
  // second PC sharing the folder) or a file that is not one. No copy there yet is fine.
  function refuseForeign(dir) {
    const file = path.join(dir, COPY_NAME);
    const size = fs.statSync(file, { throwIfNoEntry: false })?.size;
    if (size === undefined) return;
    if (size > MAX_VAULT_BYTES || !ownsFile(fs.readFileSync(file))) throw new Error(FOREIGN);
  }

  function copyNow() {
    clearTimeout(timer);
    timer = null;
    const dir = folder();
    if (!dir) return;
    try {
      refuseForeign(dir);
      last = { at: Date.now(), error: "", opener: copyVaultWithOpener(vaultPath, path.join(dir, COPY_NAME), version) };
    } catch (e) {
      last = { ...last, error: reason(e) };
    }
    onStatus(status());
  }

  function schedule() {
    if (!folder()) return;
    clearTimeout(timer);
    timer = setTimeout(copyNow, delayMs);
  }

  // Before lock and quit: a waiting copy is written now.
  function flush() {
    if (timer) copyNow();
  }

  // A new folder gets its first copy straight away.
  function choose(dir) {
    const checked = checkCopyFolder(dir, path.dirname(vaultPath));
    try {
      refuseForeign(checked);
    } catch (e) {
      throw new Error(reason(e));
    }
    setFolder(checked);
    last = NOTHING_YET;
    copyNow();
    return status();
  }

  // The copy already in the folder stays; nothing more is written there.
  function stop() {
    clearTimeout(timer);
    timer = null;
    setFolder("");
    last = NOTHING_YET;
    onStatus(status());
    return status();
  }

  // at: this run's last copy, else when the copy in the folder was last written (a previous run).
  function status() {
    const dir = folder();
    let at = last.at;
    try {
      if (dir && at === null) at = fs.statSync(path.join(dir, COPY_NAME)).mtimeMs;
    } catch {
      // no copy there yet, or the drive is out
    }
    return { folder: dir, at, error: last.error, opener: last.opener };
  }

  return { schedule, flush, choose, stop, status };
}

module.exports = { createFolderCopy, checkCopyFolder, copyVaultWithOpener, COPY_NAME };
