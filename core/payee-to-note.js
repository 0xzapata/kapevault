// Payee Check was removed on 2026-10-09. A vault, restore, sync copy or import file made before then can
// still hold `payee` items, so each one opens as a secure note with the same id, title, space, tags,
// heldFor, favorite and dates. Its body keeps every payee field as a plain line, then the item's notes
// (a note never shows its notes field, so they move into the body). The number was never a secret as a
// payee; in a note body it is part of the secret body, which stays in main like any other.
// Anything that is not a payee passes through untouched. A field of the wrong type (cleanVault does not
// check a kind it no longer knows) is left out of the body, never guessed at.

const text = (v) => (typeof v === "string" ? v.trim() : "");

/** @param {any[]} entries a vault's stored entries, or an import file's items @returns {any[]} */
export function payeeToNotes(entries) {
  return entries.map((entry) => {
    if (entry?.kind !== "payee") return entry;
    const { who, relation, provider, number, accountName, confirmedAt, notes, ...rest } = entry;
    const lines = [];
    const add = (label, value) => {
      if (text(value)) lines.push(`${label}: ${text(value)}`);
    };
    add("Name", who);
    add("Relation", relation);
    add("Wallet or bank", provider);
    add("Number", number);
    add("Account name", accountName);
    add("Confirmed", confirmedAt);
    return { ...rest, kind: "note", notes: "", body: [lines.join("\n"), text(notes)].filter(Boolean).join("\n\n") };
  });
}
