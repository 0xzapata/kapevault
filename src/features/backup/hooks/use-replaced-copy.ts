import { useEffect, useState } from "react";
import { vaultApi, type VaultStatus } from "@/lib/vault-api";

// The vault the last restore replaced, kept on this device. Restore it: main loads it into the file
// restore, and the restore sheet asks for its own master password (onPicked). Delete: with that same
// password (main checks it) - being unlocked does not prove the replaced vault is yours.
export function useReplacedCopy(onPicked: (name: string) => void) {
  const [copy, setCopy] = useState<VaultStatus["replacedCopy"]>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    vaultApi.status().then((s) => setCopy(s.replacedCopy));
  }, []);

  async function restore() {
    setError("");
    const result = await vaultApi.pickReplacedCopy();
    if (result.ok) onPicked(result.name);
    else setError(result.error);
  }

  async function remove(master: string) {
    setError("");
    const result = await vaultApi.deleteReplacedCopy(master);
    if (result.ok) setCopy(result.status.replacedCopy);
    else setError(result.error);
  }

  return { copy, error, restore, remove };
}
