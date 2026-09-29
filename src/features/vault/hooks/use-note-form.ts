import { useEffect, useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import type { EntryInput, NoteEntry } from "../types";

// The note part of the item form. The body is null until the stored one arrives; saving while null
// keeps it.
export function useNoteForm(entry: NoteEntry | null) {
  const [body, setBody] = useState<string | null>(entry?.hasBody ? null : "");

  // Editing loads the body, only if nothing was typed while it loaded. Locked mid-edit, the load fails
  // quietly: the lock screen takes over.
  useEffect(() => {
    if (entry?.hasBody) vaultApi.getSecret(entry.id, "body").then((stored) => setBody((typed) => typed ?? stored), () => {});
  }, [entry]);

  const input = (): Partial<EntryInput> => ({ body: body ?? undefined });

  return { body, setBody, input };
}
