import { useState } from "react";
import { ArrowsClockwise, CaretRight, CloudCheck, CloudSlash, Desktop, DeviceMobile, WarningCircle } from "@phosphor-icons/react";
import { Sheet } from "../../components/Sheet";
import { Button } from "../../components/form";
import { Card, useNow } from "../../components/fields";
import { EntryIcon } from "../../components/icons";
import { useToast } from "../../components/Toast";
import { useHost } from "../../host/host-context";
import { capital, relativeTime } from "../../lib/format";
import { NewMasterForm } from "../sync/NewMasterForm";
import { SyncReviewSheet } from "../sync/SyncReviewSheet";
import { deviceNames, syncLineText } from "../sync/sync-text";
import type { Entry, SyncReview, SyncStatus } from "../../host/types";

// One quiet line under the item count ("Synced with DESKTOP-4F2A · 2 min ago"); it opens
// the Sync sheet, or straight to the review when a merge waits for one. With no R2 (it is optional) it
// only says so, never asks.
export function SyncLine({ status, onOpen }: { status: SyncStatus | null; onOpen: () => void }) {
  const [reviewing, setReviewing] = useState<SyncReview | null>(null); // kept while its sheet leaves
  useNow();
  if (!status) return null;
  const line = syncLineText(status, relativeTime);
  const warn = line.tone === "warn";
  return (
    <>
      <button
        type="button"
        onClick={() => (status.review ? setReviewing(status.review) : onOpen())}
        className={`press track-small -mt-3 mx-3.5 flex min-h-11 max-w-[calc(100%-28px)] shrink-0 items-center gap-1.5 self-start rounded-lg px-1.5 text-[12.5px] focus-ring ${warn ? "text-warn" : "text-ink-3"}`}
      >
        {warn ? <WarningCircle size={14} weight="fill" className="shrink-0" /> : status.state === "off" ? <CloudSlash size={14} className="shrink-0" /> : <CloudCheck size={14} weight="fill" className={`shrink-0 ${line.tone === "ok" ? "text-ok" : ""}`} />}
        {/* Keyed on the state, not the text: "Syncing" -> "Synced" settles in, the "2 min ago" refresh does not replay. */}
        {status.state === "syncing" ? <span className="shimmer accent inline-block h-[3px] w-20 rounded-[3px] bg-line" aria-label="Syncing" /> : <span key={status.state} className="settle truncate">{line.text}</span>}
        <CaretRight size={10} weight="bold" className="shrink-0" />
      </button>
      {reviewing && <SyncReviewSheet review={reviewing} onClose={() => setReviewing(null)} />}
    </>
  );
}

const note = "mt-3 text-[13px] leading-relaxed text-ink-2";

// Devices, what needs a look, and Sync now: the PC Sheet, centred. With no R2 it says the vault is only
// on this phone, and offers Connect.
export function SyncSheet({ status, entries, onOpenItem, onConnect, onClose }: { status: SyncStatus; entries: Entry[]; onOpenItem: (id: string) => void; onConnect: () => void; onClose: () => void }) {
  const host = useHost();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState<SyncReview | null>(null);
  useNow();

  async function syncNow() {
    setBusy(true);
    const result = await host.syncNow();
    setBusy(false);
    const after = await host.syncStatus();
    if (!result.ok) toast(result.error, "error");
    else if (after.apart) toast("Backed up");
    else if (!after.review && !after.newMaster && !after.removed && !after.problems.length) toast(`Synced with ${after.peer ?? "your devices"}`);
  }

  const copies = status.conflicts.map((c) => entries.find((e) => e.id === c.id)).filter((e): e is Entry => Boolean(e));
  const syncing = busy || status.state === "syncing";
  const off = status.state === "off";
  const problems = [status.error, ...status.problems].filter((p): p is string => Boolean(p));

  return (
    <Sheet
      title="Sync"
      onClose={onClose}
      footer={(close) => (
        <>
          {off ? (
            <Button
              variant="primary"
              onClick={() => {
                close();
                onConnect();
              }}
            >
              Connect to R2
            </Button>
          ) : (
            <Button variant="primary" onClick={syncNow} disabled={syncing} className="min-w-[120px]">
              <ArrowsClockwise size={15} weight="bold" />
              {syncing ? <span className="shimmer inline-block h-[3px] w-14 rounded-[3px] bg-on-accent-2" aria-label="Syncing" /> : status.apart || status.removed ? "Back up now" : "Sync now"}
            </Button>
          )}
          <span className="flex-1" />
          <Button onClick={close}>Done</Button>
        </>
      )}
    >
      {(close) => (
        <>
          {off && <p className={note}>Backup is off, so this vault is only on this phone. Connect your own Cloudflare R2 bucket to back it up and sync it with your PC.</p>}
          {!off && !status.apart && !status.removed && <p className="mt-1 text-[13px] text-ink-3">Your devices share their changes through your own R2 bucket, encrypted.</p>}
          {status.apart && <p className={note}>This phone backs up to R2 but does not sync: the bucket holds another vault. To sync, use that vault in Settings &gt; Backup and sync.</p>}
          {status.removed && <p className={note}>This phone was removed from sync on another device, so it no longer shares changes with your other devices. It still backs up. To sync again, clear KAPEVault's data in Android Settings (or reinstall it) and restore from your backup: it then joins as a new device.</p>}
          {status.manual && !off && !status.apart && !status.removed && <p className="mt-2 text-[12.5px] text-ink-3">Automatic backup is off: this phone syncs only when you tap Sync now.</p>}

          {status.newMaster && !status.review && <NewMasterForm device={status.newMaster} onOpened={() => void host.syncStatus().then((s) => s.review && setReviewing(s.review))} />}

          {status.review && (
            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-warn-soft p-4">
              <p className="flex-1 text-[13px] leading-relaxed text-ink-2">Changes from {deviceNames(status.review.from)} wait for you before they sync.</p>
              <Button className="shrink-0 bg-raised" onClick={() => setReviewing(status.review ?? null)}>
                Review
              </Button>
            </div>
          )}

          {problems.map((problem) => (
            <p key={problem} className="mt-3 flex items-start gap-2 text-[13px] text-warn">
              <WarningCircle size={16} weight="fill" className="mt-px shrink-0" />
              {problem}
            </p>
          ))}

          {!off && (
            <Card className="mt-5">
              {status.devices.map((d) => (
                <div key={d.id} className="flex min-h-14 items-center gap-3 border-b border-line py-2 pl-4 pr-4 last:border-b-0">
                  {d.platform === "android" || d.platform === "ios" ? <DeviceMobile size={20} className="shrink-0" /> : <Desktop size={20} className="shrink-0" />}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[14px] font-semibold">{d.name}</span>
                    <span className="track-small text-[12px] text-ink-3">{d.model}</span>
                  </span>
                  <span className="track-small text-[12px] text-ink-3">{d.lastSyncAt ? capital(relativeTime(d.lastSyncAt)) : "Never"}</span>
                </div>
              ))}
            </Card>
          )}
          {!off && !status.apart && status.fingerprint && status.devices.length > 1 && (
            <p className="mt-2 px-0.5 text-[12.5px] text-ink-3">
              Check code <span className="font-mono text-ink-2">{status.fingerprint}</span> - the same on each device once all have synced.
            </p>
          )}
          {copies.length > 0 && (
            <>
              <p className="track-small mx-0.5 mb-1.5 mt-5 text-[12.5px] font-semibold text-ink-3">Needs a look</p>
              <Card>
                {copies.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => {
                      close();
                      onOpenItem(e.id);
                    }}
                    className="press flex min-h-[60px] w-full items-center gap-3 border-b border-line px-4 py-2 text-left last:border-b-0 focus-ring"
                  >
                    <span className="scale-90">
                      <EntryIcon entry={e} size="sm" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[14px] font-semibold">{e.title}</span>
                      <span className="track-small text-[12px] text-ink-3">Changed on both devices</span>
                    </span>
                    <CaretRight size={12} weight="bold" className="shrink-0 text-ink-3" />
                  </button>
                ))}
              </Card>
            </>
          )}
          {reviewing && <SyncReviewSheet review={reviewing} onClose={() => setReviewing(null)} />}
        </>
      )}
    </Sheet>
  );
}
