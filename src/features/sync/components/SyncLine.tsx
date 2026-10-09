import { useState } from "react";
import { ArrowsClockwise, CloudSlash } from "@phosphor-icons/react";
import type { SyncReview } from "@/lib/vault-api";
import { relativeTime } from "@/lib/local-date";
import { useMinuteTick, useSync } from "../hooks/use-sync";
import { noBackup, syncLine } from "../lib/sync-line";
import { useFolderCopy } from "@/features/backup/hooks/use-folder-copy";
import { SyncReviewSheet } from "./SyncReviewSheet";
import { SyncSheet } from "./SyncSheet";

// The line under the list's item count ("Synced with MOCK-DESKTOP · 2 min ago"). It opens the Sync sheet,
// or straight to the review when a merge waits for one. Without cloud backup it says only "No backup yet",
// and only while no copy folder is set either.
export function SyncLine({ onShow }: { onShow: (id: string) => void }) {
  const sync = useSync();
  const folder = useFolderCopy().status;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reviewing, setReviewing] = useState<SyncReview | null>(null); // kept while its sheet leaves
  useMinuteTick();
  const status = sync.status;
  if (noBackup(status, folder))
    return (
      <p data-sync-line className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-3">
        <CloudSlash size={12} weight="bold" className="shrink-0" />
        No backup yet
      </p>
    );
  const line = status && syncLine(status, relativeTime);
  if (!status || !line) return null;
  const running = sync.busy || status.state === "running";

  return (
    <div data-sync-line>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => (status.review ? setReviewing(status.review) : setSheetOpen(true))}
        className={`press mt-1 flex max-w-full items-center gap-1.5 rounded text-[12px] focus-ring ${line.tone === "warn" ? "text-warn" : "text-ink-3 hover:text-ink-2"} ${running ? "shimmer" : ""}`}
      >
        <ArrowsClockwise size={12} weight="bold" className="shrink-0" />
        <span className="truncate">{line.text}</span>
      </button>
      {sheetOpen && (
        <SyncSheet
          status={status}
          busy={sync.busy}
          onSyncNow={sync.syncNow}
          onAnswerRestore={sync.answerRestore}
          onAdoptKey={async (master) => {
            const result = await sync.adoptKey(master);
            if (result.status.review) setReviewing(result.status.review); // the merge it opened waits for Apply
            return result.ok ? "" : (result.error ?? "");
          }}
          onRevoke={sync.revoke}
          onRejoin={async (master) => {
            const result = await sync.rejoin(master);
            return result.ok ? "" : (result.error ?? "Could not join again.");
          }}
          onMasterChanged={sync.refresh}
          onReview={() => setReviewing(status.review)}
          onShow={onShow}
          onClose={() => setSheetOpen(false)}
        />
      )}
      {reviewing && <SyncReviewSheet review={reviewing} onApply={sync.apply} onClose={() => setReviewing(null)} />}
    </div>
  );
}
