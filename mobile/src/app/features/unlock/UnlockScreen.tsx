import { useEffect, useState, type FormEvent } from "react";
import { AppIcon } from "../../components/icons";
import { useHost } from "../../host/host-context";
import { hoursText } from "../../lib/format";
import { useSettings } from "../settings/settings-context";
import { TrustSheet } from "../settings/TrustSheet";
import { FingerprintButton, Hint, LockWash, Pill, Safe, linkButton, useClock } from "./lock-parts";
import type { BiometricErrorCode, BiometricStatus, LockReason } from "../../host/types";

// What to say when the fingerprint did not open the vault; canceled says nothing.
const BIO_ERRORS: Partial<Record<BiometricErrorCode, string>> = {
  "locked-out": "Too many tries. Use your master password.",
  changed: "The fingerprints on this phone changed. Use your master password, then turn fingerprint unlock on again in Settings.",
  "not-enabled": "Fingerprint unlock is off. Use your master password.",
  unsupported: "This phone cannot use fingerprint unlock. Use your master password.",
};

// The PC lock screen, fingerprint first. Android's fingerprint prompt opens only when
// "Use fingerprint" (or the fingerprint button) is tapped. "Use master password" swaps in the PC pill.
// With fingerprint off it is the PC lock screen as is.
export function UnlockScreen({ reason, onRestore }: { reason?: LockReason; onRestore: () => void }) {
  const host = useHost();
  const { settings } = useSettings();
  const { time, date } = useClock();
  const [bio, setBio] = useState<BiometricStatus | null>(null);
  const [master, setMaster] = useState("");
  const [typing, setTyping] = useState(false); // "Use master password" was tapped
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);
  const [about, setAbout] = useState(false);

  useEffect(() => {
    host.biometricStatus().then(setBio);
  }, [host]);

  const canUseBio = Boolean(bio?.available && bio.enabled && !bio.needsMaster);
  const fingerprintFirst = canUseBio && !typing;

  function fail(message: string) {
    setError(message);
    setTries((n) => n + 1);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!master || busy) return;
    setBusy(true);
    setError("");
    const result = await host.unlock(master);
    setBusy(false);
    if (result.ok) return;
    setMaster("");
    fail(result.error);
  }

  async function unlockWithFingerprint() {
    setBusy(true);
    setError("");
    const result = await host.unlockBiometric();
    setBusy(false);
    if (result.ok || result.code === "canceled") return;
    if (result.code !== "failed") {
      setTyping(true);
      setBio(await host.biometricStatus());
    }
    fail(BIO_ERRORS[result.code] ?? result.error);
  }

  let hint = fingerprintFirst ? "Touch the fingerprint sensor" : "Enter your master password";
  if (bio?.enabled && bio.needsMaster) hint = "Enter your master password - KAPEVault asks for it every 14 days.";
  if (busy) hint = fingerprintFirst ? "Waiting for your fingerprint..." : "Unlocking...";

  return (
    <LockWash>
      <div className="stagger mt-14 flex flex-col items-center [@media(max-height:560px)]:hidden">
        <p className="text-[17px] font-medium tracking-[-0.01em] text-ink-2">{date}</p>
        <p className="text-[72px] font-semibold leading-none tracking-[-0.045em] tabular-nums">{time}</p>
      </div>

      <form onSubmit={submit} className="stagger mt-auto flex flex-col items-center px-4 pb-14 text-center">
        <AppIcon size={92} />
        <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.015em]">KAPEVault</h1>
        {reason === "session-limit" && settings && <p className="mt-1 text-[13px] text-ink-2">Locked after {hoursText(settings.lockAfterHours)}</p>}

        {!fingerprintFirst && (
          <div key={tries} className={`mt-5 flex items-center gap-2.5 ${tries ? "shake" : ""}`}>
            <Pill label="Master password" value={master} onChange={setMaster} busy={busy} autoFocus={typing} />
            {canUseBio && <FingerprintButton onClick={unlockWithFingerprint} disabled={busy} />}
          </div>
        )}

        <Hint error={error} hint={hint} tries={tries} />

        {fingerprintFirst && (
          <div className="mt-1 flex justify-center gap-4">
            <button type="button" onClick={unlockWithFingerprint} disabled={busy} className={`${linkButton} text-[12.5px]`}>
              Use fingerprint
            </button>
            <button type="button" onClick={() => setTyping(true)} className={`${linkButton} text-[12.5px]`}>
              Use master password
            </button>
          </div>
        )}

        <Safe />
        <div className="mt-2 flex justify-center gap-4">
          <button type="button" onClick={onRestore} className={`${linkButton} text-[12px]`}>
            Restore from backup
          </button>
          <button type="button" onClick={() => setAbout(true)} className={`${linkButton} text-[12px]`}>
            How KAPEVault protects you
          </button>
        </div>
      </form>
      {about && <TrustSheet onClose={() => setAbout(false)} />}
    </LockWash>
  );
}
