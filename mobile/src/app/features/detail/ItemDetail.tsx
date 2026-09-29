import { useState } from "react";
import { CaretLeft, HandHeart, PencilSimple, Star } from "@phosphor-icons/react";
import { backPill, barIcon, barPill } from "../../components/buttons";
import { Card } from "../../components/fields";
import { EntryIcon } from "../../components/icons";
import { useHost } from "../../host/host-context";
import { useBackLayer } from "../../hooks/use-back-layer";
import { formatDay, relativeTime } from "../../lib/format";
import { isGone, kindLabel } from "../../lib/entries";
import { ActionDock } from "./ActionDock";
import { ConflictBanner, IssueBanner, PayeeConfirmation } from "./banners";
import { BackupCodesCard, IdPhotoCard, PasswordHistory } from "./extras";
import { DeviceRows, IdRows, KeyRows, LinkRow, LoginRows, NoteRow, PayeeRows, ThingRows } from "./rows";
import type { ConflictCopy, Entry, Space } from "../../host/types";

interface ItemDetailProps {
  entry: Entry | null; // the item on the layer (kept while it slides out)
  open: boolean;
  entries: Entry[];
  spaces: Space[];
  conflicts: ConflictCopy[];
  onBack: () => void;
  onEdit: (entry: Entry) => void;
  onOpenItem: (id: string) => void;
}

// The PC compact detail, pushed over the list from the right (it leaves the same way). No pills
// under the title; the actions sit in the dock at the bottom and every row keeps its own copy.
export function ItemDetail({ entry, open, entries, spaces, conflicts, onBack, onEdit, onOpenItem }: ItemDetailProps) {
  const host = useHost();
  const [starred, setStarred] = useState<string | null>(null); // the item whose star was just tapped: only it blooms
  // The detail stays mounted under the edit sheet: each edit starts its body afresh, so nothing shown
  // before it (a photo, a number) stays shown - or shows the old value - after it. Only this phone's
  // edits reset it: a sync that replaces a photo keeps the shown one until the detail reopens.
  const [edits, setEdits] = useState(0);
  const edit = (item: Entry) => {
    setEdits((n) => n + 1);
    onEdit(item);
  };
  useBackLayer(open, onBack);
  return (
    <section aria-label="Item" inert={!open} data-open={open || undefined} className="push fixed inset-0 z-30 flex flex-col bg-surface pt-[var(--sat)]">
      {entry && (
        <>
          <div className="flex h-[52px] shrink-0 items-center gap-0.5 pl-3 pr-1.5">
            <button type="button" onClick={onBack} aria-label="Back to list" className={backPill}>
              <CaretLeft size={17} weight="bold" />
              Back
            </button>
            <span className="flex-1" />
            {!isGone(entry) && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setStarred(entry.id);
                    void host.toggleFavorite(entry.id);
                  }}
                  aria-label={entry.favorite ? "Remove from favorites" : "Add to favorites"}
                  className={barIcon}
                >
                  <Star key={String(entry.favorite)} size={18} weight={entry.favorite ? "fill" : "regular"} className={entry.favorite ? `text-sys-orange ${starred === entry.id ? "swap-in" : ""}` : "text-ink-3"} />
                </button>
                <button type="button" onClick={() => edit(entry)} className={`${barPill} ml-1`}>
                  <PencilSimple size={14} />
                  Edit
                </button>
              </>
            )}
          </div>
          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <Body key={`${entry.id}:${edits}`} entry={entry} entries={entries} spaces={spaces} conflict={conflicts.find((c) => c.id === entry.id)} onEdit={() => edit(entry)} onOpenItem={onOpenItem} onBack={onBack} />
          </div>
          {!isGone(entry) && <ActionDock key={entry.id} entry={entry} />}
        </>
      )}
    </section>
  );
}

function Body({ entry, entries, spaces, conflict, onEdit, onOpenItem, onBack }: { entry: Entry; entries: Entry[]; spaces: Space[]; conflict?: ConflictCopy; onEdit: () => void; onOpenItem: (id: string) => void; onBack: () => void }) {
  const space = spaces.find((s) => s.id === entry.spaceId);
  return (
    <div className="px-5 pb-12 pt-2">
      <header className="flex flex-col items-center text-center">
        <EntryIcon entry={entry} size="lg" />
        <h1 className="mt-5 max-w-full break-words text-[26px] font-bold leading-tight tracking-[-0.03em]">{entry.title}</h1>
        <p className="mt-1 text-[14px] text-ink-3">
          {kindLabel(entry)} <span className="mx-1">·</span> {space?.name}
        </p>
        {entry.heldFor && (
          <span className="mt-2.5 flex max-w-full items-center gap-1.5 rounded-full bg-field px-2.5 py-1 text-[12px] font-medium text-ink-2">
            <HandHeart size={13} weight="fill" className="shrink-0 text-ink-3" />
            <span className="truncate">Held for {entry.heldFor}</span>
          </span>
        )}
      </header>

      <div className="mt-9">
        {conflict && <ConflictBanner conflict={conflict} onOpen={onOpenItem} onDeleted={onBack} />}
        <IssueBanner entry={entry} onEdit={onEdit} />
        {entry.kind === "payee" && <PayeeConfirmation key={entry.id} entry={entry} />}
        <Card>
          {entry.kind === "login" && <LoginRows entry={entry} entries={entries} onGoTo={onOpenItem} />}
          {entry.kind === "key" && <KeyRows entry={entry} />}
          {entry.kind === "note" && <NoteRow entry={entry} />}
          {entry.kind === "link" && <LinkRow entry={entry} />}
          {entry.kind === "payee" && <PayeeRows entry={entry} />}
          {entry.kind === "thing" && <ThingRows entry={entry} />}
          {entry.kind === "device" && <DeviceRows entry={entry} />}
          {entry.kind === "id" && <IdRows entry={entry} />}
        </Card>
      </div>

      {entry.kind === "id" && entry.hasPhoto && <IdPhotoCard entry={entry} />}

      {entry.kind === "login" && !isGone(entry) && <BackupCodesCard entry={entry} />}
      {entry.kind === "login" && entry.history.length > 0 && <PasswordHistory key={entry.history.length} entry={entry} />}

      {entry.tags.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          {entry.tags.map((t) => (
            <span key={t} className="max-w-full truncate rounded-full bg-field px-2.5 py-1 text-[12px] font-medium text-ink-2">
              {t}
            </span>
          ))}
        </div>
      )}

      {entry.notes && (
        <section className="mt-8">
          <h3 className="mb-2 px-1 text-[12.5px] font-semibold text-ink-3">Notes</h3>
          <Card>
            <p className="selectable whitespace-pre-wrap break-words p-4 text-[14px] leading-relaxed text-ink-2">{entry.notes}</p>
          </Card>
        </section>
      )}

      <p className="mt-8 text-center text-[12px] text-ink-3">
        Updated {formatDay(entry.updatedAt)}
        {entry.lastUsedAt ? ` · Last used ${relativeTime(entry.lastUsedAt)}` : null}
      </p>
    </div>
  );
}
