import { useEffect } from "react";
import { vaultApi } from "@/lib/vault-api";
import { useQuickVault } from "./hooks/use-quick-vault";
import { QuickPalette } from "./components/QuickPalette";
import { QuickUnlock } from "./components/QuickUnlock";

// The Ctrl+Shift+Space window (the built page loaded with #quick): search and copy without
// leaving the app you are in. Translucent so the window's acrylic shows; nothing in it drags.
export default function QuickSearch() {
  const { state, shown, opened } = useQuickVault();

  // Escape hides the window unless something inside used it first (the search clears its query).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) vaultApi.quickHide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="glass h-full text-ink">
      {state.phase === "open" && <QuickPalette vault={state.vault} shown={shown} />}
      {state.phase === "locked" && <QuickUnlock shown={shown} onOpen={opened} />}
      {state.phase === "missing" && (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <p className="text-[15px] font-semibold text-ink-2">No vault yet</p>
          <p className="mt-1 text-[13px] text-ink-3">Open KAPEVault to create one.</p>
        </div>
      )}
    </div>
  );
}
