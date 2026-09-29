import { ClockCounterClockwise } from "@phosphor-icons/react";
import { Button, ErrorText } from "@/components/form";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { formatDay, localToday } from "@/lib/local-date";
import { formatBackupSize } from "@/lib/format";
import { useReplacedCopy } from "../hooks/use-replaced-copy";

// Settings > Backup: the vault the last restore replaced, while it is kept here. Hidden when there is none.
export function ReplacedCopy({ onRestore }: { onRestore: (name: string) => void }) {
  const replaced = useReplacedCopy(onRestore);
  if (!replaced.copy) return null;

  return (
    <div className="settle space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] bg-field px-3.5 py-3">
        <ClockCounterClockwise size={22} weight="duotone" className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-ink">Replaced vault</p>
          <p className="text-[12.5px] text-ink-3">
            {formatDay(localToday(new Date(replaced.copy.at)))} · {formatBackupSize(replaced.copy.size)}
          </p>
        </div>
        <Button type="button" className="h-8 shrink-0 bg-raised" onClick={replaced.restore}>
          Restore it
        </Button>
        <ConfirmDelete password={{ label: "Its master password", note: "It may be the only copy of that vault, so only its own password deletes it." }} onConfirm={replaced.remove} />
      </div>
      <ErrorText message={replaced.error} />
    </div>
  );
}
