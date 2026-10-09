import { useState } from "react";
import { createPortal } from "react-dom";
import { CopySimple, Desktop, DeviceMobile, WarningCircle } from "@phosphor-icons/react";
import { Sheet } from "@/components/Sheet";
import { Button } from "@/components/form";
import type { SyncStatus } from "@/lib/vault-api";
import { DEVICE, isMac } from "@/lib/platform";
import { relativeTime } from "@/lib/local-date";
import { deviceNames } from "../lib/sync-line";
import { NewMasterCard } from "./NewMasterCard";
import { LockOutCard } from "./LockOutCard";
import { RestoreQuestion } from "./RestoreQuestion";
import { SyncCard } from "./SyncCard";

const heading = "mb-2 text-[12.5px] font-medium text-ink-2";
const rows = "divide-y divide-line overflow-hidden rounded-[12px] bg-field";

// A device on this bucket. onRemove: another device, which can be removed from sync after a confirm in
// place (for a lost or sold one).
function DeviceRow({ name, platform, note, onRemove }: { name: string; platform: string; note: string; onRemove?: () => void }) {
  const [asking, setAsking] = useState(false);
  const Icon = platform === "android" || platform === "ios" ? DeviceMobile : Desktop;
  return (
    <li className="px-3.5 py-2.5">
      <div className="flex items-center gap-3">
        <Icon size={18} className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-ink">{name}</span>
          <span className="block truncate text-[12.5px] text-ink-3">{note}</span>
        </span>
        {onRemove && !asking && (
          <Button type="button" className="h-8 shrink-0 bg-raised" onClick={() => setAsking(true)}>
            Remove from sync
          </Button>
        )}
      </div>
      {asking && (
        <div className="settle mt-2 flex flex-wrap items-center justify-end gap-2">
          <p className="min-w-0 flex-1 text-[12.5px] text-ink-2">Its changes will never sync again. For a lost or sold device. Two steps to lock it out for good follow.</p>
          <Button type="button" autoFocus className="h-8 shrink-0 bg-raised" onClick={() => setAsking(false)}>
            Cancel
          </Button>
          <Button type="button" variant="danger" className="h-8 shrink-0" onClick={onRemove}>
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}

interface SyncSheetProps {
  status: SyncStatus;
  busy: boolean; // a Sync now on its way
  onSyncNow: () => void;
  onAnswerRestore: (everywhere: boolean) => void;
  onAdoptKey: (master: string) => Promise<string>; // "" when it opened; the review follows
  onRevoke: (ref: string) => void;
  onMasterChanged: () => void; // the master password was changed from the lock-out card
  onReview: () => void; // opens the held merge's review on top
  onShow: (id: string) => void; // a conflict copy, in the list
  onClose: () => void;
}

// The devices on this bucket, what needs a look, and Sync now. Portaled: the list it opens from
// moves with the sidebar, and a moving parent would carry a fixed sheet with it.
export function SyncSheet({ status, busy, onSyncNow, onAnswerRestore, onAdoptKey, onRevoke, onMasterChanged, onReview, onShow, onClose }: SyncSheetProps) {
  const problems = [status.error, ...status.problems].filter(Boolean);
  // Set once the master password was changed from the lock-out card: the names it was for, and whether quick unlock went off.
  const [finished, setFinished] = useState<{ names: string[]; biometricOff: boolean } | null>(null);
  const lockOut = status.lockOut.map((d) => d.name);

  return createPortal(
    <Sheet title="Sync" onClose={onClose} width="w-[480px]">
      {(close) => (
        <div className="space-y-5">
          <p className="-mt-1 text-[13px] text-ink-3">Your devices share their changes through your own R2 bucket, encrypted.</p>

          {status.off === "restored" ? <RestoreQuestion busy={busy} onAnswer={onAnswerRestore} /> : <SyncCard status={status} busy={busy} onSyncNow={onSyncNow} />}

          {status.newMaster && !status.review && <NewMasterCard device={status.newMaster} onAdopt={onAdoptKey} />}

          {problems.map((problem) => (
            <p key={problem} className="settle flex items-start gap-2 text-[12.5px] text-warn">
              <WarningCircle size={16} weight="fill" className="mt-px shrink-0" />
              {problem}
            </p>
          ))}

          {(lockOut.length > 0 || finished) && (
            <LockOutCard
              names={finished?.names ?? lockOut}
              masterDone={finished !== null}
              biometricOff={finished?.biometricOff ?? false}
              onMasterChanged={(biometricOff) => {
                setFinished({ names: lockOut, biometricOff });
                onMasterChanged();
              }}
            />
          )}

          {status.review && (
            <div className="flex items-center gap-3 rounded-[12px] bg-warn-soft px-3.5 py-3">
              <p className="flex-1 text-[12.5px] text-ink-2">Changes from {deviceNames(status.review.from)} wait for you before they sync.</p>
              <Button type="button" className="h-8 shrink-0 bg-raised" onClick={onReview}>
                Review
              </Button>
            </div>
          )}

          <section>
            <h3 className={heading}>Devices</h3>
            <ul aria-label="Devices" className={rows}>
              <DeviceRow name={status.thisDevice} platform={isMac ? "darwin" : "win32"} note={`This ${DEVICE}`} />
              {status.devices.map((d) => (
                <DeviceRow key={d.ref} name={d.name} platform={d.platform} note={d.lastSeen ? `Last seen ${relativeTime(d.lastSeen)}` : "Not seen yet"} onRemove={() => onRevoke(d.ref)} />
              ))}
            </ul>
            <p className="mt-2 text-[12.5px] text-ink-3">
              {status.devices.length === 0 ? (
                "No other device uses this bucket yet."
              ) : (
                <>
                  Check code <span className="font-mono text-ink-2">{status.fingerprint}</span> - the same on each device once all have synced.
                </>
              )}
            </p>
          </section>

          {status.needsLook.length > 0 && (
            <section>
              <h3 className={heading}>Needs a look</h3>
              <p className="-mt-1 mb-2 text-[12.5px] text-ink-3">Two devices changed these at the same time. Keep what you need, then delete the copy.</p>
              <ul aria-label="Needs a look" className={rows}>
                {status.needsLook.map((copy) => (
                  <li key={copy.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onShow(copy.id);
                        close();
                      }}
                      className="row flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-hover focus-ring focus-ring-inset"
                    >
                      <CopySimple size={18} className="shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{copy.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex justify-end">
            <Button type="button" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Sheet>,
    document.body,
  );
}
