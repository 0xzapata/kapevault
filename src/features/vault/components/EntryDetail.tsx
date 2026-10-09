import { useEffect, useRef, useState } from "react";
import { ArrowSquareOut, CaretLeft, DoorOpen, DotsThree, HandHeart, PencilSimple, Star } from "@phosphor-icons/react";
import { EntryIcon } from "./EntryIcon";
import { IssueBanner } from "./IssueBanner";
import { PasswordHistory } from "./PasswordHistory";
import { KeyRows, LoginRows, NoteCard } from "./DetailRows";
import { QuickActions } from "./QuickActions";
import { Card, Field } from "@/components/Card";
import { CopyButton, IconButton } from "@/components/IconButton";
import { formatDay, relativeTime } from "@/lib/local-date";
import { kindLabel } from "../lib/entry-text";
import { isLocalPath, isNetworkPath } from "../lib/paths";
import { ipcMessage } from "@/lib/ipc-message";
import { vaultApi } from "@/lib/vault-api";
import { keys } from "@/lib/platform";
import { TitleBar } from "@/components/TitleBar";
import { Menu, useMenu } from "@/components/Menu";
import { barPill } from "@/components/buttons";
import { FolderBrowser } from "@/features/files/components/FolderBrowser";
import { ThingRows } from "@/features/things/components/ThingRows";
import { DeviceRows, ScanPrompt } from "@/features/devices/components/DeviceDetail";
import { SecretPhoto } from "@/components/photo";
import { IdRows } from "@/features/ids/components/IdRows";
import { isBlankDevice } from "@/features/devices/lib/devices";
import { RecoveryCodes } from "@/features/recovery/components/RecoveryCodes";
import { SecurityQuestions } from "@/features/questions/components/SecurityQuestions";
import { ClosingStatus } from "@/features/closing/components/ClosingStatus";
import { CloseAccountSheet } from "@/features/closing/components/CloseAccountSheet";
import { TombstoneCard } from "@/features/closing/components/TombstoneCard";
import { ConfirmGoneSheet } from "@/features/closing/components/ConfirmGoneSheet";
import { isGone } from "@/features/closing/lib/lifecycle";
import type { LayoutMode } from "@/hooks/use-layout";
import type { Entry, Space } from "../types";

interface EntryDetailProps {
  entry: Entry | null;
  entries: Entry[];
  spaces: Space[];
  mode: LayoutMode;
  onBack?: () => void;
  onEdit: () => void;
  onReveal: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onShowClosed: (id: string) => void; // an account just confirmed gone: show it in Closed
  onScan: () => void; // a device with nothing from its sticker yet: edit it, scanning first
}

export function EntryDetail({ entry, entries, spaces, mode, onBack, onEdit, onReveal, onToggleFavorite, onShowClosed, onScan }: EntryDetailProps) {
  const [notice, setNotice] = useState("");
  const [showNetwork, setShowNetwork] = useState(false); // remounted per item, so it resets on selection
  const [replaceCodes, setReplaceCodes] = useState(0); // the Security banner asking for a new set of backup codes
  // Close this account (choose), the erasure email, Confirm it's gone. Held here, not in the status
  // card: the card leaves the moment an account is gone, and a sheet must leave the way it came.
  const [closeSheet, setCloseSheet] = useState<"choose" | "email" | "gone" | null>(null);
  const more = useMenu();
  const moreRef = useRef<HTMLButtonElement>(null);
  const compact = mode === "compact";

  useEffect(() => setNotice(""), [entry?.id]);

  const backButton = compact && onBack && (
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
  );

  if (!entry) {
    return (
      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        <TitleBar edgeLeft={compact} edgeRight>
          <div className="flex flex-1 items-center px-3">{backButton}</div>
        </TitleBar>
        <div className="grid flex-1 place-items-center px-6 pb-[52px] text-center">
          <div>
            <p className="text-[17px] font-semibold text-ink-2">No item selected</p>
            <p className="mt-1 text-[13px] text-ink-3">Pick something on the list, or press {keys("mod", "K")} to search.</p>
          </div>
        </div>
      </main>
    );
  }

  const space = spaces.find((s) => s.id === entry.spaceId);
  const id = entry.id;
  const gone = isGone(entry); // a closed account's tombstone: read only

  // Every Open button opens this item's own link; main looks it up by id.
  async function open() {
    try {
      await vaultApi.openEntry(id);
      setNotice("");
    } catch (e) {
      setNotice(`Could not open it: ${ipcMessage(e)}.`);
    }
  }

  const openButton = () => (
    <IconButton label="Open" onClick={open}>
      <ArrowSquareOut size={16} />
    </IconButton>
  );

  const copyText = (text: string) => () => vaultApi.copyText(text, id);
  const copyLink = (location: string) => <CopyButton copy={copyText(location)} toastText={isLocalPath(location) ? "Path copied" : "Link copied"} />;

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-surface">
      <TitleBar edgeLeft={compact} edgeRight>
        <div className="flex flex-1 items-center gap-1 px-3">
          {backButton}
          <div className="flex-1" />
          {entry.kind === "login" && !entry.lifecycle && (
            <button
              type="button"
              ref={moreRef}
              aria-label="More actions"
              title="More actions"
              onClick={() => moreRef.current && more.openUnder(moreRef.current, "end")}
              className="press grid size-8 place-items-center rounded-full text-ink-3 transition-colors hover:bg-accent-soft hover:text-accent focus-ring"
            >
              <DotsThree size={18} weight="bold" />
            </button>
          )}
          {!gone && (
            <>
              <IconButton label={entry.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => onToggleFavorite(id)}>
                <Star size={18} weight={entry.favorite ? "fill" : "regular"} className={entry.favorite ? "text-sys-orange" : ""} />
              </IconButton>
              <button
                type="button"
                onClick={onEdit}
                aria-label="Edit"
                data-focus-key={`edit-${id}`} // a save remounts this pane: the closing form finds the new Edit by it
                className={barPill}
              >
                <PencilSimple size={14} />
                Edit
              </button>
            </>
          )}
        </div>
      </TitleBar>

      <div className="@container min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {/* key remounts on selection: resets reveal/copy state and replays the settle (or the push in one column) */}
        <div key={id} data-flip className={`${compact ? "push" : "settle"} mx-auto max-w-[680px] px-5 pb-12 pt-2 @lg:px-10`}>
          <header className="flex flex-col items-center text-center">
            <EntryIcon entry={entry} size="lg" />
            <h1 data-focus-home tabIndex={-1} className="mt-5 max-w-full truncate outline-none text-[26px] font-bold leading-tight tracking-[-0.03em] @lg:text-[34px]">{entry.title}</h1>
            <p className="mt-1 text-[14px] text-ink-3">
              {kindLabel(entry)} <span className="mx-1">·</span> {space?.name}
            </p>
            {entry.heldFor && (
              <span className="mt-2.5 flex max-w-full items-center gap-1.5 rounded-full bg-field px-2.5 py-1 text-[12px] font-medium text-ink-2">
                <HandHeart size={13} weight="fill" className="shrink-0 text-ink-3" />
                <span className="truncate">Held for {entry.heldFor}</span>
              </span>
            )}
            {!gone && <QuickActions entry={entry} onOpen={open} />}
          </header>

          <div className="mt-9">
            {entry.kind === "login" && <ClosingStatus entry={entry} onSheet={setCloseSheet} />}
            <IssueBanner entry={entry} onOpen={open} onEdit={onEdit} onReplaceCodes={() => setReplaceCodes((n) => n + 1)} />
            {gone && entry.kind === "login" && <TombstoneCard entry={entry} />}
            {!gone && entry.kind === "note" && <NoteCard entry={entry} />}
            {entry.kind === "device" && <ScanPrompt entry={entry} onScan={onScan} />}
            {!gone && entry.kind !== "note" && !(entry.kind === "device" && isBlankDevice(entry)) && (
              <Card>
                {entry.kind === "login" && <LoginRows entry={entry} entries={entries} copyText={copyText} openButton={openButton} copyLink={copyLink} onReveal={onReveal} />}
                {entry.kind === "key" && <KeyRows entry={entry} copyText={copyText} openButton={openButton} copyLink={copyLink} />}
                {entry.kind === "thing" && <ThingRows entry={entry} />}
                {entry.kind === "device" && <DeviceRows entry={entry} openButton={openButton} copyLink={copyLink} />}
                {entry.kind === "id" && <IdRows entry={entry} />}
                {entry.kind === "link" && (
                  <Field label="Location" actions={entry.location && <>{openButton()}{copyLink(entry.location)}</>}>
                    <span className={isLocalPath(entry.location) ? "font-mono text-[13px]" : "text-accent"}>{entry.location}</span>
                  </Field>
                )}
              </Card>
            )}
            {notice && <p className="mt-3 px-1 text-[13px] text-danger">{notice}</p>}
          </div>

          {entry.kind === "device" && <SecretPhoto entry={entry} label="Label photo" />}
          {entry.kind === "id" && <SecretPhoto entry={entry} label="ID photo" />}

          {entry.kind === "login" && !gone && <RecoveryCodes entry={entry} replaceSignal={replaceCodes} />}

          {entry.kind === "login" && <SecurityQuestions entry={entry} />}

          {entry.kind === "login" && entry.history.length > 0 && <PasswordHistory key={entry.history.length} entryId={id} history={entry.history} />}

          {/* A local folder opens right here as a browsable grid; web links just open in the browser. */}
          {entry.kind === "link" && entry.linkType === "folder" && isLocalPath(entry.location) &&
            (isNetworkPath(entry.location) && !showNetwork ? (
              <button type="button" onClick={() => setShowNetwork(true)} className="press mt-5 flex h-9 items-center gap-2 rounded-full bg-raised px-4 text-[13px] font-semibold text-accent shadow-tile hover:bg-hover focus-ring">
                Show files from this network folder
              </button>
            ) : (
              <FolderBrowser key={entry.location} root={entry.location} />
            ))}

          {entry.tags.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-1.5">
              {entry.tags.map((t) => (
                <span key={t} className="max-w-full truncate rounded-full bg-field px-2.5 py-1 text-[12px] font-medium text-ink-2">
                  {t}
                </span>
              ))}
            </div>
          )}

          {entry.notes && entry.kind !== "note" && (
            <section className="mt-8">
              <h3 className="mb-2 px-1 text-[12.5px] font-semibold text-ink-3">Notes</h3>
              <Card>
                <p className="selectable whitespace-pre-wrap break-words px-4 py-4 text-[14px] leading-relaxed text-ink-2 @md:px-5">{entry.notes}</p>
              </Card>
            </section>
          )}

          <p className="mt-8 px-1 text-center text-[12px] text-ink-3">
            Updated {formatDay(entry.updatedAt)}
            {entry.lastUsedAt ? ` · Last used ${relativeTime(entry.lastUsedAt)}` : null}
          </p>
        </div>
      </div>
      {more.anchor && <Menu label="More actions" anchor={more.anchor} onClose={more.close} items={[{ label: "Close this account...", icon: <DoorOpen size={14} />, onSelect: () => setCloseSheet("choose") }]} />}
      {entry.kind === "login" && (closeSheet === "choose" || closeSheet === "email") && <CloseAccountSheet entry={entry} step={closeSheet} onClose={() => setCloseSheet(null)} />}
      {entry.kind === "login" && closeSheet === "gone" && <ConfirmGoneSheet entry={entry} onGone={() => onShowClosed(id)} onClose={() => setCloseSheet(null)} />}
    </main>
  );
}
