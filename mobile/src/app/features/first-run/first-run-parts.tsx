import { useState, type ReactNode } from "react";
import { Desktop, DeviceMobile, QrCode } from "@phosphor-icons/react";
import { useHost } from "../../host/host-context";
import { dayAndTime } from "../../lib/format";
import { BigFingerprint, linkButton } from "../unlock/lock-parts";
import type { Backup } from "../../host/types";

export const cta = "press hit flex h-9 items-center justify-center gap-1.5 rounded-full bg-accent px-4 text-[13.5px] font-medium text-on-accent disabled:opacity-50 focus-ring";

// The last step of first run and of Restore from backup: the fingerprint offer, as the PC's.
export function useFingerprintOffer(onDone: () => void, fail: (message: string) => void): { body: ReactNode; hint: string; actions: ReactNode } {
  const host = useHost();
  const [busy, setBusy] = useState(false);
  async function turnOn() {
    setBusy(true);
    const result = await host.enableBiometric();
    setBusy(false);
    if (result.ok) return onDone();
    if (result.code !== "canceled") fail(result.error);
  }
  return {
    body: (
      <div className="mt-5">
        <BigFingerprint />
      </div>
    ),
    hint: "Unlock with your fingerprint? KAPEVault still asks for your master password every 14 days.",
    actions: (
      <>
        <button type="button" onClick={turnOn} disabled={busy} className={cta}>
          Turn on
        </button>
        <button type="button" onClick={onDone} className={`${linkButton} text-[12.5px]`}>
          Not now
        </button>
      </>
    ),
  };
}

// The step counter under both flows.
export function Steps({ step, of }: { step: number; of: number }) {
  return (
    <div className="track-small mt-5 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-ink-3" aria-label={`Step ${step} of ${of}`}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={`h-1 w-5 rounded-[3px] transition-colors duration-300 ease-out ${i < step ? "bg-accent" : "bg-line-strong"}`} />
      ))}
      <span className="ml-1.5">
        {step} of {of}
      </span>
    </div>
  );
}

// The scan step's picture. "Scan the code" opens the live camera full screen (QrScannerPlugin), with
// the same corner marks.
export function Viewfinder({ busy }: { busy: boolean }) {
  const corner = "absolute size-[30px] border-on-accent";
  return (
    <div aria-hidden="true" className={`relative mt-5 grid size-[200px] place-items-center rounded-3xl bg-stage ${busy ? "shimmer" : ""}`}>
      <QrCode size={96} className="text-on-accent-2 opacity-40" />
      <b className={`${corner} left-3 top-3 rounded-tl-xl border-l-4 border-t-4`} />
      <b className={`${corner} right-3 top-3 rounded-tr-xl border-r-4 border-t-4`} />
      <b className={`${corner} bottom-3 left-3 rounded-bl-xl border-b-4 border-l-4`} />
      <b className={`${corner} bottom-3 right-3 rounded-br-xl border-b-4 border-r-4`} />
    </div>
  );
}

// The backups in the bucket, newest first and picked; one radio row each.
export function BackupPicker({ backups, picked, onPick }: { backups: Backup[]; picked: string; onPick: (key: string) => void }) {
  return (
    // min-h-0 + its own scroll: a bucket of many backups shrinks the list, never pushes the button off screen.
    <div role="radiogroup" aria-label="Backups" className="mt-[18px] min-h-0 w-[300px] max-w-full overflow-y-auto overscroll-contain rounded-2xl border border-line bg-raised shadow-card">
      {backups.map((b, i) => {
        const on = b.key === picked;
        return (
          <button key={b.key} type="button" role="radio" aria-checked={on} onClick={() => onPick(b.key)} className="press flex min-h-14 w-full items-center gap-3 border-b border-line px-3.5 py-2 text-left last:border-b-0 focus-ring">
            <span className={`grid size-5 shrink-0 place-items-center rounded-full border-2 ${on ? "border-accent" : "border-line-strong"}`}>{on && <span className="swap-in size-2.5 rounded-full bg-accent" />}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[14px] font-semibold">{b.device}</span>
              <span className="track-small text-[12px] text-ink-3">
                {dayAndTime(b.at)}
                {i === 0 ? " · newest" : ""}
              </span>
            </span>
            {b.platform === "android" || b.platform === "ios" ? <DeviceMobile size={18} className="text-ink-2" /> : <Desktop size={18} className="text-ink-2" />}
          </button>
        );
      })}
    </div>
  );
}
