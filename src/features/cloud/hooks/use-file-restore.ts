import { useState, type FormEvent } from "react";
import { vaultApi, type RestoreKept } from "@/lib/vault-api";
import { ipcMessage } from "@/lib/ipc-message";
import type { VaultView } from "@/features/vault/types";

// Restore from a saved file: pick it, then its own master password opens it. replaced = the vault
// the last restore replaced, already picked. Nothing changes here until that password opens it.
export function useFileRestore(replaced: string | undefined, onOpened: (vault: VaultView, kept: RestoreKept) => void) {
  const [fileName, setFileName] = useState(replaced ?? "");
  const [master, setMasterValue] = useState("");
  const [picking, setPicking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");
  // The backup opened, but the vault here could not be kept (a local copy failed, or an earlier
  // replaced vault holds the slot): replacing it with no copy needs a second click - and, while it is
  // locked, its own master password (needsMaster, typed into current).
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [needsMaster, setNeedsMaster] = useState(false);
  const [current, setCurrent] = useState("");
  const [tries, setTries] = useState(0);

  function askAgain() {
    setNeedsConfirm(false);
    setNeedsMaster(false);
    setCurrent("");
  }

  // A changed password asks the confirm step again.
  function setMaster(value: string) {
    setMasterValue(value);
    askAgain();
  }

  async function pick() {
    setPicking(true);
    setError("");
    try {
      const result = await vaultApi.pickRestoreFile();
      if (result.ok) {
        setFileName(result.name);
        setMasterValue("");
        askAgain();
      } else if (!result.canceled) {
        setFileName("");
        setError(result.error ?? "Could not read that file.");
      }
    } catch (e) {
      setError(ipcMessage(e));
    } finally {
      setPicking(false);
    }
  }

  async function restore(e: FormEvent) {
    e.preventDefault();
    setRestoring(true);
    setError("");
    let result;
    try {
      result = await vaultApi.restoreFromFile(master, needsConfirm, current);
    } catch {
      result = { ok: false as const, error: "Something went wrong restoring the file. Try again." };
    } finally {
      setRestoring(false);
    }
    if (result.ok) {
      onOpened(result.vault, result);
      return;
    }
    setError(result.error);
    if (result.needsConfirm) {
      setNeedsConfirm(true); // keep the password: the next click replaces without asking again
      if (result.needsMaster) {
        setNeedsMaster(true);
        setCurrent("");
        setTries((n) => n + 1); // a fresh, focused field for this try
      }
      return;
    }
    askAgain();
    setMasterValue("");
  }

  return { fileName, master, setMaster, picking, restoring, error, needsConfirm, needsMaster, current, setCurrent, tries, pick, restore };
}
