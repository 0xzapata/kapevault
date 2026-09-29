import { useEffect, useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import type { EntryInput, KeyEntry } from "../types";

// The API key part of the item form. Its link lives in the form: a login has one too.
export function useKeyForm(entry: KeyEntry | null) {
  const [keyId, setKeyId] = useState(entry?.keyId ?? "");
  // Null until the stored secret arrives; saving while null keeps the stored one.
  const [secret, setSecret] = useState<string | null>(entry?.hasSecret ? null : "");
  const [expires, setExpires] = useState(entry?.expires ?? "");

  // Editing loads the secret, only if nothing was typed while it loaded. Locked mid-edit, the load
  // fails quietly: the lock screen takes over.
  useEffect(() => {
    if (entry?.hasSecret) vaultApi.getSecret(entry.id, "secret").then((stored) => setSecret((typed) => typed ?? stored), () => {});
  }, [entry]);

  const input = (): Partial<EntryInput> => ({ keyId, secret: secret ?? undefined, expires });

  return { keyId, setKeyId, secret, setSecret, expires, setExpires, input };
}
