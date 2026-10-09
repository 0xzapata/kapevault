import { useState } from "react";
import { Sheet } from "../../components/Sheet";
import { Button } from "../../components/form";
import { useToast } from "../../components/Toast";
import { useHost } from "../../host/host-context";
import { reviewSentences } from "./sync-text";
import type { SyncReview } from "../../host/types";

// Titles, in a box that scrolls on its own.
function TitleList({ label, titles }: { label: string; titles: string[] }) {
  if (!titles.length) return null;
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 text-[12.5px] font-medium text-ink-2">
        {label} ({titles.length})
      </h3>
      <ul aria-label={label} className="max-h-36 overflow-y-auto rounded-xl bg-field px-3.5 py-2 text-[13.5px] text-ink">
        {titles.map((title, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: plain titles that can repeat, shown read-only and replaced whole
          <li key={i} className="truncate py-1">
            {title}
          </li>
        ))}
      </ul>
    </section>
  );
}

// The mass-change gate (SYNC.md 3.9), as the PC's review: a merge that deletes or changes many items,
// adopts a restored vault or another device's master password waits here. Nothing changes until Apply;
// Not now leaves it waiting (the sync line says so).
export function SyncReviewSheet({ review, onClose }: { review: SyncReview; onClose: () => void }) {
  const host = useHost();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const deletes = review.reasons.includes("deletes");

  async function apply(close: () => void) {
    setBusy(true);
    const result = await host.applySync();
    setBusy(false);
    if (!result.ok) return toast(result.error, "error");
    toast(result.biometricOff ? "Synced. Fingerprint unlock is off: turn it on again in Settings." : "Synced");
    close();
  }

  return (
    <Sheet
      title="Check before syncing"
      onClose={onClose}
      footer={(close) => (
        <>
          <span className="flex-1" />
          <Button onClick={close}>Not now</Button>
          <Button variant={deletes ? "danger" : "primary"} disabled={busy} onClick={() => apply(close)} className="min-w-[96px]">
            {busy ? <span className="shimmer inline-block h-[3px] w-12 rounded-[3px] bg-line" role="img" aria-label="Applying" /> : "Apply"}
          </Button>
        </>
      )}
    >
      {() => (
        <>
          <div className="mt-3 flex flex-col gap-1">
            {reviewSentences(review).map((sentence) => (
              <p key={sentence} className="text-[14px] font-medium text-ink">
                {sentence}
              </p>
            ))}
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">Nothing changes on this phone until you apply it. Not expecting this? Choose Not now and check that device first.</p>
          {review.reasons.includes("key") && <p className="mt-2 text-[13px] leading-relaxed text-ink-2">Fingerprint unlock turns off. You can turn it on again in Settings.</p>}
          <TitleList label="Deleted" titles={review.deleted} />
          <TitleList label="Changed" titles={review.changed} />
          <TitleList label="Added" titles={review.added} />
          <TitleList label="Conflict copies" titles={review.copies} />
        </>
      )}
    </Sheet>
  );
}
