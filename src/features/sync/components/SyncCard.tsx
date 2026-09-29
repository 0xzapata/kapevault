import { ArrowsClockwise } from "@phosphor-icons/react";
import { Button } from "@/components/form";
import type { SyncStatus } from "@/lib/vault-api";
import { relativeTime } from "@/lib/local-date";
import { syncLine } from "../lib/sync-line";

// Sync's state and Sync now, as a card: in the Sync sheet and in Settings > Backup. A run in
// progress shimmers (a skeleton, never a spinner).
export function SyncCard({ status, busy, onSyncNow }: { status: SyncStatus; busy: boolean; onSyncNow: () => void }) {
  const line = syncLine(status, relativeTime);
  const running = busy || status.state === "running";
  const warn = line?.tone === "warn";
  const canSync = status.off === null; // after a restore, the restore question resumes sync (SyncSheet)

  return (
    <div className={`flex items-center gap-3 rounded-[12px] bg-field px-3.5 py-3 ${running ? "shimmer" : ""}`}>
      <ArrowsClockwise size={22} weight="duotone" className={warn ? "text-warn" : "text-accent"} />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-ink">Sync</p>
        <p aria-live="polite" className={`text-[12.5px] ${warn ? "text-warn" : "text-ink-3"}`}>
          {line?.text}
        </p>
      </div>
      <Button type="button" className="h-8 shrink-0 bg-raised" disabled={running || !canSync} onClick={onSyncNow}>
        Sync now
      </Button>
    </div>
  );
}
