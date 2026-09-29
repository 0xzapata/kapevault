import { useCallback, useEffect, useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import type { EntryInput, LoginEntry, QuestionInput, SignInMethod } from "../types";

// The login part of the item form. Its website lives in the form: an API key has one too.
export function useLoginForm(entry: LoginEntry | null) {
  const [username, setUsername] = useState(entry?.username ?? "");
  // Null until the stored password arrives; saving while null keeps the stored one.
  const [password, setPassword] = useState<string | null>(entry?.hasPassword ? null : "");
  const [storedPassword, setStoredPassword] = useState<string | null>(null);
  const [signIn, setSignIn] = useState<SignInMethod>(entry?.signIn ?? "password");
  const [viaEntryId, setViaEntryId] = useState(entry?.viaEntryId ?? "");
  const [totp, setTotp] = useState<string | undefined>(undefined); // undefined = untouched
  const [questions, setQuestions] = useState<QuestionInput[] | undefined>(undefined); // undefined = untouched

  // Editing loads the current password so it can be changed in place, only if nothing was typed while
  // it loaded. Locked mid-edit, the load fails quietly: the lock screen takes over, null keeps it.
  useEffect(() => {
    if (!entry?.hasPassword) return;
    vaultApi.getPassword(entry.id).then(
      (stored) => {
        setStoredPassword(stored);
        setPassword((typed) => typed ?? stored);
      },
      () => {},
    );
  }, [entry]);

  // The 2FA box and the questions keep their text themselves and start empty when they mount again,
  // so what they gave the form goes when they unmount (LoginFields calls this then): the save never
  // holds text the form no longer shows.
  const resetRemounted = useCallback(() => {
    setTotp(undefined);
    setQuestions(undefined);
  }, []);

  const replacesPassword = storedPassword !== null && password !== null && password !== storedPassword;
  const input = (): Partial<EntryInput> => ({ username, password: password ?? undefined, signIn, viaEntryId: viaEntryId || undefined, totp, questions });

  return { entry, username, setUsername, password, setPassword, replacesPassword, signIn, setSignIn, viaEntryId, setViaEntryId, setTotp, setQuestions, resetRemounted, input };
}
