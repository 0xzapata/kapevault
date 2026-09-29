import { useState } from "react";
import { Check } from "@phosphor-icons/react";
import { Button, ErrorText, Label, Switch, TextInput } from "../../components/form";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { useHost } from "../../host/host-context";
import { hoursText } from "../../lib/format";
import { StrengthMeter } from "../edit/inputs";
import type { CloudStatus, LockAfterHours, ThemeChoice } from "../../host/types";

export const THEME_LABELS: Record<ThemeChoice, string> = { system: "System", classic: "Classic", dark: "Dark", colorblind: "Colorblind", contrast: "High contrast" };
const LOCK_AFTER: LockAfterHours[] = [0, 1, 2, 4, 8, 12, 24];

const doneFooter = (close: () => void) => (
  <>
    <span className="flex-1" />
    <Button onClick={close}>Done</Button>
  </>
);

export function ChangeMasterSheet({ onClose, onBiometricOff }: { onClose: () => void; onBiometricOff: () => void }) {
  const host = useHost();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function change(close: () => void) {
    if (next !== confirm) return setError("The new passwords do not match.");
    setBusy(true);
    const result = await host.changeMaster(current, next);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    toast(result.biometricOff ? "Master password changed. Turn fingerprint unlock on again." : "Master password changed");
    if (result.biometricOff) onBiometricOff();
    close();
  }

  return (
    <Sheet
      title="Change master password"
      tall
      onClose={onClose}
      footer={(close) => (
        <>
          <span className="flex-1" />
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={busy || !current || !next} onClick={() => change(close)}>
            {busy ? "Changing..." : "Change password"}
          </Button>
        </>
      )}
    >
      {() => (
        <div className="mt-5 flex flex-col gap-4">
          <Label text="Current password">
            <TextInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Label>
          <div>
            <Label text="New password">
              <TextInput type="password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Label>
            {next ? <StrengthMeter password={next} /> : <p className="mt-2 text-[12.5px] text-ink-3">At least 12 characters, rated Strong.</p>}
          </div>
          <Label text="Confirm new password">
            <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Label>
          <p className="text-[12.5px] leading-relaxed text-ink-3">Your PC picks up the new password at its next sync. Fingerprint unlock turns off until you turn it on again.</p>
          <ErrorText message={error} />
        </div>
      )}
    </Sheet>
  );
}

// One choice out of a list, as radio rows (Lock after).
export function LockAfterSheet({ value, onPick, onClose }: { value: LockAfterHours; onPick: (v: LockAfterHours) => void; onClose: () => void }) {
  return (
    <Sheet title="Lock after" onClose={onClose} footer={doneFooter}>
      {(close) => (
        <>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">Locks this long after you unlock, even while you use it.</p>
          <div role="radiogroup" aria-label="Lock after" className="mt-4 overflow-hidden rounded-2xl border border-line">
            {LOCK_AFTER.map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={h === value}
                onClick={() => {
                  onPick(h);
                  close();
                }}
                className="press flex min-h-12 w-full items-center gap-3 border-b border-line px-4 text-left text-[14px] last:border-b-0 focus-ring"
              >
                <span className="flex-1">{hoursText(h)}</span>
                {h === value && <Check size={15} weight="bold" className="text-accent" />}
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

// A tiny KAPEVault list drawn in the theme's own tokens (the PC's ThemePicker thumbnails).
function Thumb({ theme }: { theme: string }) {
  return (
    <span data-theme={theme} className="absolute inset-0 flex flex-col gap-1 bg-surface p-1.5">
      <span className="h-1.5 w-1/2 rounded-full bg-ink" />
      <span className="flex flex-1 flex-col gap-1 rounded-[4px] bg-raised p-1 shadow-card">
        <span className="h-2 rounded-[2px] bg-accent" />
        <span className="h-1 w-3/4 rounded-full bg-line-strong" />
        <span className="h-1 w-2/3 rounded-full bg-line-strong" />
      </span>
    </span>
  );
}

export function ThemeSheet({ value, onPick, onClose }: { value: ThemeChoice; onPick: (v: ThemeChoice) => void; onClose: () => void }) {
  return (
    <Sheet title="Theme" onClose={onClose} footer={doneFooter}>
      {() => (
        <div role="radiogroup" aria-label="Theme" className="mt-5 grid grid-cols-3 gap-3">
          {(Object.keys(THEME_LABELS) as ThemeChoice[]).map((t) => {
            const on = t === value;
            return (
              <button key={t} type="button" role="radio" aria-checked={on} onClick={() => onPick(t)} className="flex min-h-11 flex-col items-center gap-1.5 rounded-[10px] focus-ring">
                <span className={`press relative block aspect-[3/4] w-full overflow-hidden rounded-[8px] border border-line ${on ? "ring-2 ring-accent ring-offset-2 ring-offset-raised" : ""}`}>
                  {t === "system" ? (
                    <>
                      <span className="absolute inset-0 [clip-path:inset(0_50%_0_0)]">
                        <Thumb theme="classic" />
                      </span>
                      <span className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
                        <Thumb theme="dark" />
                      </span>
                    </>
                  ) : (
                    <Thumb theme={t} />
                  )}
                </span>
                <span className={`text-[12px] ${on ? "font-semibold text-ink" : "text-ink-2"}`}>{THEME_LABELS[t]}</span>
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

export function CloudSheet({ status, onStatus, onClose }: { status: CloudStatus; onStatus: (s: CloudStatus) => void; onClose: () => void }) {
  const host = useHost();
  return (
    <Sheet title="Cloud backup" onClose={onClose} footer={doneFooter}>
      {() => (
        <div className="mt-3 flex flex-col gap-4">
          <p className="text-[12.5px] leading-relaxed text-ink-3">
            {status.apart
              ? "Backing up to your Cloudflare R2 bucket, without sync: the bucket holds another vault. Only the encrypted file is uploaded."
              : "Connected to your Cloudflare R2 bucket. Only the encrypted file is uploaded."}
          </p>
          {status.connected && (
            <>
              <div className="flex flex-col gap-0.5">
                <span className="text-[12px] text-ink-3">S3 API URL</span>
                <span className="selectable break-all text-[13.5px]">{status.url}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[12px] text-ink-3">Access key ID</span>
                <span className="selectable font-mono text-[13px]">{status.accessKeyId}</span>
              </div>
              <label className="flex min-h-11 items-center gap-3">
                <span className="flex-1 text-[13.5px]">
                  Back up automatically
                  <small className="mt-0.5 block text-[12.5px] text-ink-3">A few seconds after each change.</small>
                </span>
                <Switch label="Back up automatically" checked={status.auto} onChange={(auto) => host.setCloudAuto(auto).then(onStatus)} />
              </label>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
