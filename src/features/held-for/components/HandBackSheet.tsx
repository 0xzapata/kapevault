import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import { Button, ErrorText } from "@/components/form";
import { useToast } from "@/components/Toast";
import { vaultApi } from "@/lib/vault-api";
import { useAction } from "@/hooks/use-action";
import type { Entry } from "@/features/vault/types";

interface HandBackSheetProps {
  person: string;
  entries: Entry[]; // the items kept for this person
  onClose: () => void;
}

const PREVIEW = 6;

// "Hand back": a PDF of what you keep for someone, to give them when they take it over. Passwords
// are left out unless ticked, like the R2 keys on the Emergency Kit.
export function HandBackSheet({ person, entries, onClose }: HandBackSheetProps) {
  const toast = useToast();
  const [withSecrets, setWithSecrets] = useState(false);
  const { busy, run } = useAction();
  const [error, setError] = useState("");
  const titles = entries.map((e) => e.title).sort((a, b) => a.localeCompare(b));
  const more = titles.length - PREVIEW;

  function save(close: () => void) {
    setError("");
    run(
      () => vaultApi.handBack(person, withSecrets),
      (result) => {
        if (!result.ok) setError(result.error);
        else if (!result.canceled) {
          toast(`Saved ${result.name}`);
          close();
        }
      },
      () => setError("Could not make the PDF. Try again."),
    );
  }

  return (
    <Sheet title={`Hand back to ${person}`} onClose={onClose} width="w-[480px]">
      {(close) => (
        <div className="space-y-5">
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            A PDF of the {entries.length === 1 ? "item" : `${entries.length} items`} you keep for {person}, ready to print.
          </p>
          <ul aria-label={`Kept for ${person}`} className="flex flex-wrap gap-1.5">
            {titles.slice(0, PREVIEW).map((t, i) => (
              <li key={`${t}-${i}`} className="max-w-full truncate rounded-full bg-field px-2.5 py-1 text-[12px] font-medium text-ink-2">
                {t}
              </li>
            ))}
            {more > 0 && <li className="px-1 py-1 text-[12px] text-ink-3">and {more} more</li>}
          </ul>
          <label className="flex items-start gap-2.5">
            <input type="checkbox" checked={withSecrets} onChange={(e) => setWithSecrets(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-accent" />
            <span className="text-[13.5px] text-ink">
              Include passwords and secrets
              <span className={`block text-[12.5px] ${withSecrets ? "text-danger" : "text-ink-3"}`}>
                {withSecrets
                  ? "Anyone who sees the PDF can read them. Save it outside OneDrive or Drive, hand it over in person, then delete it."
                  : "Anyone with the printout could sign in."}
              </span>
            </span>
          </label>
          <ErrorText message={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={close}>
              Cancel
            </Button>
            <Button type="button" variant="primary" autoFocus disabled={busy} onClick={() => save(close)}>
              {busy ? "Making the PDF..." : "Save PDF..."}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
