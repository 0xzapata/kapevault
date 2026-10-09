import { useCallback, useEffect, useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import type { VaultView } from "@/features/vault/types";

export type QuickState = { phase: "loading" } | { phase: "missing" } | { phase: "locked" } | { phase: "open"; vault: VaultView };

// The quick window's view of the vault. Main broadcasts lock / unlock / change to every window, so
// this stays in step with the main app. `shown` bumps each time the window is summoned, so the
// views can refocus their field.
export function useQuickVault() {
  const [state, setState] = useState<QuickState>({ phase: "loading" });
  const [shown, setShown] = useState(0);

  const refresh = useCallback(async () => {
    const status = await vaultApi.status();
    if (!status.exists) return setState({ phase: "missing" });
    const vault = status.unlocked ? await vaultApi.view() : null;
    setState(vault ? { phase: "open", vault } : { phase: "locked" });
  }, []);

  useEffect(() => {
    refresh();
    const offs = [
      vaultApi.onQuickShown(() => {
        refresh();
        setShown((n) => n + 1);
      }),
      vaultApi.onLocked(() => setState({ phase: "locked" })),
      vaultApi.onUnlocked((vault) => setState({ phase: "open", vault })),
      vaultApi.onChanged((vault) => setState({ phase: "open", vault })),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [refresh]);

  const opened = useCallback((vault: VaultView) => setState({ phase: "open", vault }), []);

  return { state, shown, opened };
}
