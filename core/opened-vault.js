// What every session starts from, on the PC and the phone: a vault just decrypted, made ready to use.
import { dueToNotes } from "./due-to-note.js";
import { withKeySalt } from "./key-salt.js";
import { readSync } from "./sync/shape.js";
import { repair } from "./sync/stamp.js";

/**
 * Due dates (removed) open as notes; the file keeps them until the next save writes the notes. A vault
 * from before sync gets its sync object (nothing stamped), and whatever an app version without sync
 * changed in it is stamped now (repair); all of it reaches the disk with the next save. The caller has
 * proven the key belongs to the header's salt (a master password derived it, or a key-only unlock checked
 * keySalt first), so the salt is marked in the data (key-salt.js).
 * @param {any} data decrypted, as cleanVault left it @param {string} salt the header's, base64
 * @param {import("./sync/stamp.js").StampContext} stampContext
 */
export function openedVault(data, salt, stampContext) {
  const entries = dueToNotes(data.entries);
  const marked = withKeySalt({ ...data, entries, sync: readSync({ ...data, entries }, salt) }, salt);
  return { ...marked, sync: repair(marked, stampContext) };
}
