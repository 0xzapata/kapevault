import { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { vaultApi } from "@/lib/vault-api";
import { useToast } from "@/components/Toast";
import { Card } from "@/components/Card";
import { SecretField } from "@/components/SecretField";
import { formatDay } from "@/lib/local-date";
import { useAction } from "@/hooks/use-action";

interface PasswordHistoryProps {
  entryId: string;
  history: { changedAt: string }[]; // newest first; values come from main one at a time
}

// Old passwords, closed by default. Clearing asks once more; the page refreshes from vault:changed.
export function PasswordHistory({ entryId, history }: PasswordHistoryProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { busy, run } = useAction();

  async function clear() {
    await run(
      () => vaultApi.clearHistory(entryId),
      () => toast("Password history cleared"),
      () => toast("Could not clear history", "error"),
    );
    setConfirming(false);
  }

  const textButton = "press h-8 rounded-full px-3 text-[12.5px] font-semibold transition-colors focus-ring";

  return (
    <section className="mt-5">
      <Card>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="password-history"
          onClick={() => setOpen(!open)}
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl px-4 text-left text-[14px] font-medium hover:bg-hover @md:px-5 focus-ring"
        >
          Password history ({history.length})
          <CaretDown size={15} weight="bold" className={`shrink-0 text-ink-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div id="password-history" className="settle border-t border-line">
            {history.map((h, i) => (
              <SecretField
                // biome-ignore lint/suspicious/noArrayIndexKey: history is addressed by position (the main process takes the index); the timestamp in the key makes a shifted list remount its rows, so a revealed password never sticks to another one
                key={`${h.changedAt}-${i}`}
                label={`Replaced ${formatDay(h.changedAt)}`}
                reveal={() => vaultApi.getSecret(entryId, "history", i)}
                copy={() => vaultApi.copySecret(entryId, "history", i)}
                copyLabel="Copy old password (clears in 30s)"
                copiedToast="Password copied - clears in 30s"
                revealLabel="Reveal old password"
                hideLabel="Hide old password"
              />
            ))}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-3 py-2">
              {confirming ? (
                <>
                  <span className="mr-auto px-1 text-[12.5px] text-ink-3">Old passwords cannot be brought back.</span>
                  <button type="button" onClick={() => setConfirming(false)} className={`${textButton} text-ink-2 hover:bg-field`}>
                    Cancel
                  </button>
                  <button type="button" onClick={clear} disabled={busy} className={`${textButton} bg-danger-soft text-danger hover:bg-danger hover:text-on-accent`}>
                    Confirm clear
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirming(true)} className={`${textButton} text-danger hover:bg-danger-soft`}>
                  Clear history
                </button>
              )}
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
