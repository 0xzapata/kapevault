// What every session starts from, on the PC and the phone: a vault just decrypted, made ready to use.
import { dueToNotes } from "./due-to-note.js";
import { payeeToNotes } from "./payee-to-note.js";
import { withKeySalt } from "./key-salt.js";
import { readSync } from "./sync/shape.js";
import { repair } from "./sync/stamp.js";
import { READER_VERSION } from "./vault-format.js";

/**
 * Due dates and payees (removed) open as notes; the file keeps them until the next save writes the notes. A vault
 * from before sync gets its sync object (nothing stamped), and whatever an app version without sync
 * changed in it is stamped now (repair); all of it reaches the disk with the next save. The caller has
 * proven the key belongs to the header's salt (a master password derived it, or a key-only unlock checked
 * keySalt first), so the salt is marked in the data (key-salt.js). Every vault opened is saved with
 * `minReader`, the oldest reader that may open it (FORMAT.md); a vault a newer KAPEVault wrote throws
 * NewerVaultError here, before anything is read or repaired, so no save can follow.
 * @param {any} data decrypted, as cleanVault left it @param {string} salt the header's, base64
 * @param {import("./sync/stamp.js").StampContext} stampContext
 */
export function openedVault(data, salt, stampContext) {
  const entries = payeeToNotes(dueToNotes(data.entries));
  const marked = withKeySalt({ ...data, minReader: READER_VERSION, entries, sync: readSync({ ...data, entries }, salt) }, salt);
  return { ...marked, sync: repair(/** @type {Parameters<typeof repair>[0]} */ (marked), stampContext) };
}
