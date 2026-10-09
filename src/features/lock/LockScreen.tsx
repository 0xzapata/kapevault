import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Fingerprint, LockSimple } from "@phosphor-icons/react";
import { vaultApi, type LockReason } from "@/lib/vault-api";
import { DEVICE } from "@/lib/platform";
import { AppIcon } from "@/components/AppIcon";
import { StrengthMeter } from "@/features/generator/components/StrengthMeter";
import { RestoreSheet } from "@/features/cloud/components/RestoreSheet";
import { restoredNote } from "@/features/cloud/lib/restore-note";
import { hoursText } from "@/features/settings/lib/session-limit";
import { formatClock } from "@/lib/format";
import { useToast } from "@/components/Toast";
import { TrustSheet } from "@/features/trust/TrustSheet";
import { useUnlock } from "./hooks/use-unlock";
import type { VaultView } from "@/features/vault/types";

interface LockScreenProps {
  isNew: boolean;
  reason?: LockReason; // why main locked it, when it says
  onOpen: (vault: VaultView) => void;
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  const time = formatClock(now);
  const date = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return { time, date };
}

// Lock after, read only when that limit is what locked the vault (0 until read).
function useSessionLimitHours(wanted: boolean) {
  const [hours, setHours] = useState(0);
  useEffect(() => {
    if (wanted) vaultApi.getSettings().then((s) => setHours(s.sessionLimitHours));
  }, [wanted]);
  return wanted ? hours : 0;
}

// Pill field in the macOS login style; the submit arrow lives inside the last pill.
function Pill({ label, value, onChange, autoFocus, withSubmit, busy }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  withSubmit?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="flex h-11 w-[300px] items-center rounded-full bg-glass pl-5 pr-1.5 shadow-[inset_0_1px_0_var(--color-glass-edge),var(--shadow-float)] backdrop-blur-xl focus-within:outline-2 focus-within:outline-accent focus-within:ring-4 focus-within:ring-accent-soft">
      <input
        type="password"
        // biome-ignore lint/a11y/noAutofocus: the lock screen's password field is ready to type in as it appears
        autoFocus={autoFocus}
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-ink-2"
      />
      {withSubmit && (
        <button
          type="submit"
          aria-label={busy ? "Working" : "Continue"}
          disabled={busy || value.length === 0}
          className="press grid size-8 place-items-center rounded-full bg-accent text-on-accent transition-opacity disabled:opacity-35"
        >
          <ArrowRight size={16} weight="bold" />
        </button>
      )}
    </div>
  );
}

export function LockScreen({ isNew, reason, onOpen }: LockScreenProps) {
  const [master, setMaster] = useState("");
  const [confirm, setConfirm] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [trustOpen, setTrustOpen] = useState(false);
  const { time, date } = useClock();
  const toast = useToast();
  const limitHours = useSessionLimitHours(reason === "session-limit");
  const unlock = useUnlock(onOpen, !isNew);
  const { error, failures, busy, bioBusy, bio, bioName } = unlock;
  const canUseBio = !isNew && unlock.canUseBio;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (isNew && master !== confirm) return unlock.fail("The two passwords do not match.");
    const failed = await unlock.withMaster(() => (isNew ? vaultApi.create(master) : vaultApi.unlock(master)));
    if (failed) {
      setMaster("");
      setConfirm("");
    }
  }

  const unlockBiometric = () => unlock.withBiometric(`${bioName} did not answer. Use your master password.`);

  let hint = "Enter your master password";
  if (!isNew && bio.status?.enabled && bio.status.needsMaster) hint = "Enter your master password - KAPEVault asks for it every 14 days.";
  if (isNew) hint = "Choose a master password: at least 12 characters, rated Strong. Three or four unrelated words work well. It cannot be recovered.";
  if (bioBusy) hint = `Waiting for ${bioName}...`;
  if (busy) hint = isNew ? "Creating your vault..." : "Unlocking...";
  const working = busy || bioBusy;

  return (
    <div className="lock-wash relative flex h-full flex-col">
      <div className="drag h-[52px] shrink-0" />

      {/* Short windows drop the clock so the password field never falls off the bottom. */}
      <div className="stagger mt-14 flex flex-col items-center text-ink [@media(max-height:700px)]:hidden">
        <p className="text-[17px] font-medium tracking-[-0.01em] text-ink-2 sm:text-[21px]">{date}</p>
        <p className="text-[72px] font-semibold leading-none tracking-[-0.045em] tabular-nums sm:text-[112px]">{time}</p>
      </div>

      <form onSubmit={submit} className="stagger mt-auto mb-24 flex flex-col items-center px-4 text-center [@media(max-height:700px)]:mb-auto">
        <AppIcon size={92} />
        <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.015em]">KAPEVault</h1>
        {limitHours > 0 && <p className="mt-1 text-[13px] text-ink-2">Locked after {hoursText(limitHours)}</p>}

        <div key={failures} className={`mt-5 flex flex-col items-center gap-2.5 ${failures ? "shake" : ""}`}>
          <div className="relative">
            <Pill label="Master password" value={master} onChange={setMaster} autoFocus withSubmit={!isNew} busy={working} />
            {canUseBio && (
              <button
                type="button"
                aria-label={`Unlock with ${bioName}`}
                title={`Unlock with ${bioName}`}
                disabled={working}
                onClick={unlockBiometric}
                className="press absolute top-0 left-[calc(100%+10px)] grid size-11 place-items-center rounded-full bg-glass text-accent shadow-[inset_0_1px_0_var(--color-glass-edge),var(--shadow-tile)] backdrop-blur-xl transition-opacity disabled:opacity-50 max-sm:hidden"
              >
                <Fingerprint size={24} weight="duotone" />
              </button>
            )}
          </div>
          {isNew && <Pill label="Confirm master password" value={confirm} onChange={setConfirm} withSubmit busy={busy} />}
          {isNew && <StrengthMeter password={master} className="w-[280px] px-2" />}
        </div>

        {/* An error is an alert, new with each try (so the same one twice is read twice); the hint and
            "Unlocking..." are only polite. */}
        {error ? (
          <p key={`error-${failures}`} role="alert" className="mt-4 max-w-[340px] text-[13px] text-danger">
            {error}
          </p>
        ) : (
          <p aria-live="polite" className="mt-4 max-w-[340px] text-[13px] text-ink-2">
            {hint}
          </p>
        )}
        {canUseBio && (
          <button
            type="button"
            disabled={working}
            onClick={unlockBiometric}
            className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline disabled:opacity-50"
          >
            <Fingerprint size={14} weight="bold" />
            Use {bioName}
          </button>
        )}
        <p className="mt-6 flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
          <LockSimple size={12} weight="bold" />
          No account. No server.
        </p>
        <p className="mt-0.5 text-[12px] text-ink-3">Your vault stays AES-256 encrypted on this {DEVICE}.</p>
        <div className="mt-2 flex items-center gap-4">
          <button type="button" onClick={() => setRestoring(true)} className="text-[12px] font-medium text-accent hover:underline">
            Restore from backup
          </button>
          <button type="button" onClick={() => setTrustOpen(true)} className="text-[12px] font-medium text-accent hover:underline">
            How KAPEVault protects you
          </button>
        </div>
      </form>

      {trustOpen && <TrustSheet onClose={() => setTrustOpen(false)} />}
      {restoring && (
        <RestoreSheet
          onClose={() => setRestoring(false)}
          onOpened={(vault, kept) => {
            toast(restoredNote(kept, DEVICE)); // the toast outlives this screen
            setRestoring(false);
            onOpen(vault);
          }}
        />
      )}
    </div>
  );
}
