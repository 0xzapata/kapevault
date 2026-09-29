// Spaces: the personal space every vault starts with, plus one per client.
import { cleanText, removeEntries } from "./entries.js";
/** @import { VaultData } from "./entries.js" */

/** @returns {VaultData} */
export function newVaultData() {
  return { spaces: [{ id: globalThis.crypto.randomUUID(), name: "Personal", kind: "personal" }], entries: [] };
}

/** @param {VaultData} data @param {string} name @returns {string} the new space's id */
export function addSpace(data, name) {
  const clean = cleanText(name);
  if (!clean) throw new Error("Name is required");
  const space = { id: globalThis.crypto.randomUUID(), name: clean, kind: "client" };
  data.spaces = [...data.spaces, space];
  return space.id;
}

/** @param {VaultData} data @param {string} id @param {string} name */
export function renameSpace(data, id, name) {
  const clean = cleanText(name);
  if (!clean) throw new Error("Name is required");
  if (!data.spaces.some((s) => s.id === id)) throw new Error("Unknown space");
  data.spaces = data.spaces.map((s) => (s.id === id ? { ...s, name: clean } : s));
}

// Deleting a client either moves its items to another space or deletes them with it.
// The personal space is the fallback home for everything and cannot be deleted.
/** @param {VaultData} data @param {string} id @param {string} [moveToId] */
export function deleteSpace(data, id, moveToId) {
  const space = data.spaces.find((s) => s.id === id);
  if (!space) throw new Error("Unknown space");
  if (space.kind === "personal") throw new Error("Your personal space cannot be deleted");
  if (moveToId) {
    if (moveToId === id || !data.spaces.some((s) => s.id === moveToId)) throw new Error("Unknown space");
    data.entries = data.entries.map((e) => (e.spaceId === id ? { ...e, spaceId: moveToId } : e));
  } else {
    removeEntries(data, new Set(data.entries.filter((e) => e.spaceId === id).map((e) => e.id)));
  }
  data.spaces = data.spaces.filter((s) => s.id !== id);
}
