import { createPortal } from "react-dom";
import { Sheet } from "@/components/Sheet";
import { Button } from "@/components/form";
import type { SyncReview } from "@/lib/vault-api";
import { biometricName } from "@/lib/platform";
import { useAction } from "@/hooks/use-action";
import { reviewSentences } from "../lib/sync-line";

// Titles, in a box that scrolls on its own (and takes Tab, so the keyboard can scroll it too).
function TitleList({ label, titles }: { label: string; titles: string[] }) {
  if (!titles.length) return null;
  return (
    <section>
      <h3 className="mb-1.5 text-[12.5px] font-medium text-ink-2">
        {label} ({titles.length})
      </h3>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable list takes the focus so the arrow keys can scroll it */}
      <ul aria-label={label} tabIndex={0} className="max-h-36 overflow-y-auto rounded-[12px] bg-field px-3.5 py-2 text-[13px] text-ink focus-ring focus-ring-inset">
        {titles.map((title, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: plain titles that can repeat, shown read-only and replaced whole
          <li key={i} className="truncate py-0.5">
            {title}
          </li>
        ))}
      </ul>
    </section>
  );
}

// The mass-change gate (SYNC.md 3.9): a merge that deletes or changes many items waits here. Nothing
// changes until Apply; Not now leaves it waiting (the sync line says so).
export function SyncReviewSheet({ review, onApply, onClose }: { review: SyncReview; onApply: () => Promise<void>; onClose: () => void }) {
  const { busy, run } = useAction();

  return createPortal(
    <Sheet title="Check before syncing" onClose={onClose} width="w-[480px]">
      {(close) => (
        <div className="space-y-4">
          <div className="-mt-1 space-y-1">
            {reviewSentences(review).map((sentence) => (
              <p key={sentence} className="text-[14px] font-medium text-ink">
                {sentence}
              </p>
            ))}
            <p className="text-[13px] text-ink-2">Nothing changes here until you apply it. Not expecting this? Choose Not now and check that device first.</p>
            {review.reasons.includes("key") && <p className="text-[13px] text-ink-2">{biometricName()} turns off. You can turn it on again in Settings.</p>}
          </div>
          <TitleList label="Deleted" titles={review.deleted} />
          <TitleList label="Changed" titles={review.changed} />
          <TitleList label="Added" titles={review.added} />
          <TitleList label="Conflict copies" titles={review.copies} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={close}>
              Not now
            </Button>
            <Button
              type="button"
              variant={review.reasons.includes("deletes") ? "danger" : "primary"}
              disabled={busy}
              onClick={() => run(onApply, close)}
            >
              {busy ? "Applying..." : "Apply"}
            </Button>
          </div>
        </div>
      )}
    </Sheet>,
    document.body,
  );
}
