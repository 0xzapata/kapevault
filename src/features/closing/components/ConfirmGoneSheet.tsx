import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import { Button, ErrorText } from "@/components/form";
import { useToast } from "@/components/Toast";
import { vaultApi } from "@/lib/vault-api";
import { useAction } from "@/hooks/use-action";
import type { LoginEntry } from "@/features/vault/types";

// The confirm step before a closed account's secrets are wiped for good. What stays is a tombstone.
export function ConfirmGoneSheet({ entry, onGone, onClose }: { entry: LoginEntry; onGone: () => void; onClose: () => void }) {
  const toast = useToast();
  const [clearNotes, setClearNotes] = useState(false);
  const { busy, run } = useAction();
  const [error, setError] = useState("");

  function confirm(close: () => void) {
    setError("");
    run(
      () => vaultApi.confirmGone(entry.id, clearNotes),
      () => {
        toast(`${entry.title} moved to Closed`);
        close();
        onGone();
      },
      setError,
    );
  }

  return (
    <Sheet title="Confirm it's gone" onClose={onClose} width="w-[480px]">
      {(close) => (
        <div className="space-y-5">
          <p className="text-[13.5px] leading-relaxed text-ink-2">Only do this once {entry.title} says the account is deleted.</p>
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            Its passwords, 2FA key, backup codes and answers are wiped for good. The title, website, username and notes stay in Closed. Older backups
            still hold them.
          </p>
          {entry.notes && (
            <label className="flex items-start gap-2.5">
              <input type="checkbox" checked={clearNotes} onChange={(e) => setClearNotes(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-accent" />
              <span className="text-[13.5px] text-ink">Also clear the notes</span>
            </label>
          )}
          <ErrorText message={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" autoFocus onClick={close}>
              Cancel
            </Button>
            <Button type="button" variant="danger" disabled={busy} onClick={() => confirm(close)}>
              Wipe secrets
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
