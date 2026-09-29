import { useState } from "react";
import type { EntryInput, PayeeEntry } from "@/features/vault/types";

// The payee part of the item form. A payee left untitled is saved as "Who Provider" (autoTitle).
export function usePayeeForm(entry: PayeeEntry | null) {
  const [who, setWho] = useState(entry?.who ?? "");
  const [relation, setRelation] = useState(entry?.relation ?? "");
  const [provider, setProvider] = useState(entry?.provider ?? "");
  const [number, setNumber] = useState(entry?.number ?? "");
  const [accountName, setAccountName] = useState(entry?.accountName ?? "");
  const autoTitle = who.trim() && provider ? `${who.trim()} ${provider}` : ""; // "Mama GCash"

  // What stops a save, in words; "" when it can be saved.
  function problem(): string {
    if (!who.trim()) return "Add who this payee is.";
    if (!provider) return "Pick where the money goes.";
    return "";
  }

  const input = (): Partial<EntryInput> => ({ who, relation, provider, number, accountName });

  return { entry, who, setWho, relation, setRelation, provider, setProvider, number, setNumber, accountName, setAccountName, autoTitle, problem, input };
}
