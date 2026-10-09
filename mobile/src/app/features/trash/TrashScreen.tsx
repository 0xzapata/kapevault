import { useEffect, useState, type ReactNode } from "react";
import { CaretLeft, Trash } from "@phosphor-icons/react";
import { backPill, cardPrimary, cardQuiet } from "../../components/buttons";
import { Card } from "../../components/fields";
import { EntryIcon } from "../../components/icons";
import { useToast } from "../../components/Toast";
import { useHost } from "../../host/host-context";
import { useBackLayer } from "../../hooks/use-back-layer";
import { kindLabel } from "../../lib/entries";
import type { Space, TrashedEntry } from "../../host/types";

interface TrashScreenProps {
  open: boolean;
  trash: TrashedEntry[];
  spaces: Space[];
  onClose: () => void;
}

const daysText = ({ daysLeft: n }: TrashedEntry) => (n === 1 ? "1 day left" : `${n} days left`);
const danger = "press hit h-8 rounded-full px-3 text-[12.5px] font-semibold focus-ring disabled:opacity-50";

// The Trash, pushed over the vault like an item. A trashed item shows no secret and offers no copy,
// open or edit: its page here only says what it is, how long it stays, and offers Restore / Delete now.
// Delete now and Empty Trash ask once, in place, like the other deletes (never a native dialog).
export function TrashScreen({ open, trash, spaces, onClose }: TrashScreenProps) {
  const host = useHost();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [asking, setAsking] = useState<"empty" | "one" | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = trash.find((e) => e.id === selectedId) ?? null;

  // Each visit starts on the list with nothing half-confirmed.
  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setAsking(null);
  }, [open]);

  useBackLayer(open, onClose);
  useBackLayer(open && selected !== null, () => {
    setSelectedId(null);
    setAsking(null);
  });

  async function run(action: () => Promise<void>, done: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast(done);
      setAsking(null);
      setSelectedId(null);
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "Could not do that. Try again.", "error");
    } finally {
      setBusy(false);
    }
  }
  const restore = (e: TrashedEntry) => run(() => host.restoreEntry(e.id), "Restored");
  const deleteNow = (e: TrashedEntry) => run(() => host.deleteForever(e.id), "Deleted for good");
  const empty = () => run(() => host.emptyTrash(), "Trash emptied");

  const n = trash.length;
  return (
    <section aria-label="Trash" inert={!open} data-open={open || undefined} className="push fixed inset-0 z-30 flex flex-col bg-surface pt-[var(--sat)]">
      <div className="flex h-[52px] shrink-0 items-center gap-0.5 pl-3 pr-1.5">
        <button
          type="button"
          onClick={() => {
            if (!selected) return onClose();
            setSelectedId(null);
            setAsking(null);
          }}
          aria-label={selected ? "Back to Trash" : "Back to list"}
          className={backPill}
        >
          <CaretLeft size={17} weight="bold" />
          Back
        </button>
        <span className="flex-1" />
        {!selected && n > 0 && asking !== "empty" && (
          <button type="button" onClick={() => setAsking("empty")} className={`${danger} text-danger`}>
            Empty Trash
          </button>
        )}
      </div>

      {selected ? (
        <div key={selected.id} className="settle no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-12 pt-2">
          <header className="flex flex-col items-center text-center">
            <EntryIcon entry={selected} size="lg" />
            <h1 className="mt-5 max-w-full break-words text-[26px] font-bold leading-tight tracking-[-0.03em]">{selected.title}</h1>
            <p className="mt-1 text-[14px] text-ink-3">
              {kindLabel(selected)} <span className="mx-1">·</span> {spaces.find((s) => s.id === selected.spaceId)?.name}
            </p>
            <span className="mt-2.5 rounded-full bg-field px-2.5 py-1 text-[12px] font-medium text-ink-2">In the Trash · {daysText(selected)}</span>
          </header>
          <p className="mt-8 px-2 text-center text-[13.5px] leading-relaxed text-ink-3">Restore it to see or change what is inside.</p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <button type="button" disabled={busy} onClick={() => restore(selected)} className={`${cardPrimary} min-w-32 disabled:opacity-50`}>
              Restore
            </button>
            {asking === "one" ? (
              <Confirm text="This cannot be undone." confirm="Confirm delete" busy={busy} onCancel={() => setAsking(null)} onConfirm={() => deleteNow(selected)} />
            ) : (
              <button type="button" onClick={() => setAsking("one")} className={`${danger} text-danger`}>
                Delete now
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <h1 className="truncate px-5 text-[26px] font-bold leading-[1.15] tracking-[-0.025em]">Trash</h1>
          <p className="track-small truncate px-5 pb-3 pt-0.5 text-[12.5px] tabular-nums text-ink-3">{n ? `${n} ${n === 1 ? "item" : "items"} · deleted for good after 30 days` : " "}</p>
          {asking === "empty" && (
            <div className="settle mx-3 mb-2.5">
              <Confirm text={`Delete ${n === 1 ? "this item" : `all ${n} items`} for good?`} confirm="Confirm empty" busy={busy} onCancel={() => setAsking(null)} onConfirm={empty} />
            </div>
          )}
          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
            {n === 0 ? (
              <div className="px-6 py-14 text-center">
                <Trash size={28} className="mx-auto text-ink-3" />
                <p className="mt-3 text-[15px] font-semibold text-ink-2">Trash is empty</p>
                <p className="mt-1 text-[13px] text-ink-3">Deleted items wait here for 30 days.</p>
              </div>
            ) : (
              <Card className="mx-2.5 p-1">
                <ul aria-label="Items in the Trash">
                  {trash.map((e) => (
                    <TrashRow key={e.id} entry={e} busy={busy} onOpen={() => setSelectedId(e.id)} onRestore={() => restore(e)} />
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function TrashRow({ entry, busy, onOpen, onRestore }: { entry: TrashedEntry; busy: boolean; onOpen: () => void; onRestore: () => void }) {
  return (
    <li className="flex items-center">
      <button type="button" data-trashed={entry.id} onClick={onOpen} className="press flex min-w-0 flex-1 items-center gap-3 rounded-[10px] px-2.5 py-2 text-left active:bg-hover focus-ring [--focus-ring-offset:-2px]">
        <EntryIcon entry={entry} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold tracking-[-0.01em]">{entry.title}</span>
          <span className="block truncate text-[12.5px] text-ink-3">
            {kindLabel(entry)} · {daysText(entry)}
          </span>
        </span>
      </button>
      <button type="button" disabled={busy} onClick={onRestore} aria-label={`Restore ${entry.title}`} className={`${cardQuiet} mr-1 shrink-0 disabled:opacity-50`}>
        Restore
      </button>
    </li>
  );
}

// The in-place ask: one sentence, then Cancel and the one red button.
function Confirm({ text, confirm, busy, onCancel, onConfirm }: { text: ReactNode; confirm: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-field px-3 py-2">
      <span className="mr-auto px-1 text-[12.5px] text-ink-2">{text}</span>
      <button type="button" onClick={onCancel} className={`${danger} text-ink-2`}>
        Cancel
      </button>
      <button type="button" disabled={busy} onClick={onConfirm} className={`${danger} bg-danger-soft text-danger`}>
        {confirm}
      </button>
    </div>
  );
}
