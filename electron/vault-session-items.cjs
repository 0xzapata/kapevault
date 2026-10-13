// Changing the vault's items: saving, importing, the Trash, favourites, moves, backup codes, paper copies,
// lifecycle, spaces, history and the generated-password history. Every change goes through the context's
// commit / persist, so the stamping, purges and rollback of a save stay in vault-session.
const core = require("../core/index.js");
const { isNetworkPath } = require("./file-access.cjs");
const { checkImportFolder, tooWide, refusedByName } = require("./vault-session-folders.cjs");

/** @param {import("./vault-session.cjs").VaultContext} ctx */
function createItems(ctx) {
  const { requireOpen, persist, commit, publicView } = ctx;

  // A folder link typed by hand follows the import's rule (audit finding L5, SECURITY-AUDIT-2026-09-28.md):
  // never a whole drive or the home folder. A network folder stays allowed - it lists only after a
  // click. A link saved before this rule keeps working until its folder is changed.
  function saveEntry(input) {
    const stored = requireOpen().entries.find((e) => e.id === input?.id);
    const location = core.cleanText(input?.location);
    if (input?.kind === "link" && input.linkType === "folder" && location !== stored?.location) {
      if (refusedByName(location)) throw new Error("Use a normal folder path, like C:\\Users\\you\\Documents\\Clients.");
      if (!isNetworkPath(location) && tooWide(location)) throw new Error("A whole drive or your home folder cannot be linked. Link a folder inside it.");
    }
    const id = core.upsertEntry(requireOpen(), input);
    persist();
    return { vault: publicView(), id };
  }

  function patchEntry(id, changes) {
    return commit((data) => core.patchEntry(data, id, changes));
  }

  // Bulk add from an import file (core's importEntries: all or nothing). A failed write rolls memory
  // back in persist.
  function importEntries(file) {
    const result = core.importEntries(requireOpen(), file, checkImportFolder);
    persist();
    return { ...result, vault: publicView() };
  }

  // "Delete" moves an item to the Trash (core/trash.js); a closed account's tombstone goes outright.
  function deleteEntry(id) {
    return commit((data) => core.trashEntry(data, id));
  }

  function restoreEntry(id) {
    return commit((data) => core.restoreEntry(data, id));
  }

  // "Delete now" on one item in the Trash.
  function deleteForever(id) {
    return commit((data) => core.deleteForever(data, id));
  }

  function emptyTrash() {
    return commit((data) => core.emptyTrash(data));
  }

  function toggleFavorite(id) {
    return commit((data) => core.toggleFavorite(data, id));
  }

  function moveEntry(id, spaceId) {
    return commit((data) => core.moveEntry(data, id, spaceId));
  }

  function setRecoveryCodes(id, codes) {
    return commit((data) => core.setRecoveryCodes(data, id, codes));
  }

  function markRecoveryCode(id, index, used) {
    return commit((data) => core.markRecoveryCode(data, id, index, used));
  }

  function addPaperCopy(id, where, printedAt) {
    return commit((data) => core.addPaperCopy(data, id, where, printedAt));
  }

  function removePaperCopy(id, index) {
    return commit((data) => core.removePaperCopy(data, id, index));
  }

  function setLifecycle(id, state) {
    return commit((data) => core.setLifecycle(data, id, state));
  }

  function confirmGone(id, clearNotes) {
    return commit((data) => core.confirmGone(data, id, clearNotes));
  }

  // Using an item feeds "Recently used". Saved without a backup upload: it is bookkeeping.
  function touch(id) {
    if (!core.touchEntry(requireOpen(), id)) return publicView();
    persist({ backup: false });
    return publicView();
  }

  function addSpace(name) {
    const id = core.addSpace(requireOpen(), name);
    persist();
    return { vault: publicView(), id };
  }

  function renameSpace(id, name) {
    return commit((data) => core.renameSpace(data, id, name));
  }

  function setSpacePhoto(id, photo) {
    return commit((data) => core.setSpacePhoto(data, id, photo));
  }

  function deleteSpace(id, moveToId) {
    return commit((data) => core.deleteSpace(data, id, moveToId));
  }

  function clearHistory(id) {
    return commit((data) => core.clearHistory(data, id));
  }

  // Generated passwords (core/generated.js): a value that left the generator is kept here the moment it
  // does, before the item is saved, so a lock cannot take the only copy of a password already pasted into
  // a site. The page gets the times only; one value comes through getGenerated.
  function recordGenerated(value) {
    const data = requireOpen();
    const before = data.genHistory;
    core.recordGenerated(data, value);
    if (data.genHistory !== before) persist();
    return core.generatedView(data);
  }

  function generatedList() {
    return core.generatedView(requireOpen());
  }

  function getGenerated(index) {
    return core.generatedValue(requireOpen(), index);
  }

  function clearGenerated() {
    const data = requireOpen();
    if (data.genHistory !== undefined) {
      core.clearGenerated(data);
      persist();
    }
    return core.generatedView(data);
  }

  return {
    saveEntry,
    patchEntry,
    importEntries,
    deleteEntry,
    restoreEntry,
    deleteForever,
    emptyTrash,
    toggleFavorite,
    moveEntry,
    setRecoveryCodes,
    markRecoveryCode,
    addPaperCopy,
    removePaperCopy,
    setLifecycle,
    confirmGone,
    touch,
    addSpace,
    renameSpace,
    setSpacePhoto,
    deleteSpace,
    clearHistory,
    recordGenerated,
    generatedList,
    getGenerated,
    clearGenerated,
  };
}

module.exports = { createItems };
