import { CaretLeft } from "@phosphor-icons/react";
import { EntryIcon } from "./EntryIcon";
import { TitleBar } from "@/components/TitleBar";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { Button } from "@/components/form";
import { useAction } from "@/hooks/use-action";
import type { LayoutMode } from "@/hooks/use-layout";
import { kindLabel } from "../lib/entry-text";
import { trashLine } from "../lib/trash-text";
import type { Entry, Space } from "../types";

interface TrashDetailProps {
  entry: Entry;
  spaces: Space[];
  mode: LayoutMode;
  onBack?: () => void;
  onRestore: (id: string) => Promise<void>;
  onDeleteNow: (id: string) => Promise<void>;
}

// An item in the Trash, read only. Just what it is and how long it has left: no secrets, no copy,
// no open, no edit. Restore is the one filled button; Delete now is the quiet one beside it.
export function TrashDetail({ entry, spaces, mode, onBack, onRestore, onDeleteNow }: TrashDetailProps) {
  const { busy, run } = useAction();
  const compact = mode === "compact";
  const space = spaces.find((s) => s.id === entry.spaceId);

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-surface">
      <TitleBar edgeLeft={compact} edgeRight>
        <div className="flex flex-1 items-center gap-1 px-3">
          {compact && onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to list"
              title="Back to list"
              className="press flex h-8 items-center gap-0.5 rounded-full pl-1.5 pr-3 text-[14px] font-medium text-accent transition-colors hover:bg-accent-soft focus-ring"
            >
              <CaretLeft size={17} weight="bold" />
              Back
            </button>
          )}
        </div>
      </TitleBar>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div key={entry.id} data-flip className={`${compact ? "push" : "settle"} mx-auto flex max-w-[680px] flex-col items-center px-5 pb-12 pt-2 text-center`}>
          <EntryIcon entry={entry} size="lg" />
          <h1 data-focus-home tabIndex={-1} className="mt-5 max-w-full truncate outline-none text-[26px] font-bold leading-tight tracking-[-0.03em]">{entry.title}</h1>
          <p className="mt-1 text-[14px] text-ink-3">
            {kindLabel(entry)} <span className="mx-1">·</span> {space?.name}
          </p>
          <p className="mt-4 rounded-full bg-field px-3 py-1 text-[12.5px] font-medium text-ink-2">In the Trash · {trashLine(entry)}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button type="button" variant="primary" disabled={busy} onClick={() => run(() => onRestore(entry.id))}>
              Restore
            </Button>
            <ConfirmDelete label="Delete now" onConfirm={async () => void (await run(() => onDeleteNow(entry.id)))} />
          </div>
        </div>
      </div>
    </main>
  );
}
