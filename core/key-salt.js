// The salt of the master password that last opened the vault, kept INSIDE the encrypted data. The file
// header's copy is not covered by the cipher's tag, so anyone who can write the file can change it; a
// key-only unlock (Windows Hello, Touch ID, a fingerprint) never derives the key from it, and the next
// save wrote the edited header back - after which the master password no longer opened the vault or
// any later copy of it. Every open that derives the key from the password marks its salt here; a
// key-only unlock is refused (the master password is asked for) when the header disagrees.
/** @import { VaultData } from "./entries.js" */

/** @param {VaultData} data @param {string} salt the header's, base64 @returns {VaultData} */
export const withKeySalt = (data, salt) => (data.keySalt === salt ? data : { ...data, keySalt: salt });

/** @param {VaultData} data @param {string} salt the header's, base64 */
export const keySaltMatches = (data, salt) => typeof data.keySalt === "string" && data.keySalt === salt;
