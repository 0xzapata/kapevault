import { useState, type FormEvent, type ReactNode } from "react";
import { AppIcon } from "../../components/icons";
import { useHost } from "../../host/host-context";
import { StrengthMeter } from "../edit/inputs";
import { TrustSheet } from "../settings/TrustSheet";
import { Hint, LockWash, Pill, Safe, linkButton, useClock } from "../unlock/lock-parts";
import { Steps, useFingerprintOffer } from "./first-run-parts";

// First run is the PC's: the lock screen with a new master password and its confirm, the
// vault made on this phone, then the fingerprint offer. R2 is optional: "Restore from backup" brings a
// vault from it instead, and Settings connects it later.
export function CreateVault({ onRestore, onDone }: { onRestore: () => void; onDone: () => void }) {
  const host = useHost();
  const { time, date } = useClock();
  const [step, setStep] = useState<1 | 2>(1);
  const [master, setMaster] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);
  const [about, setAbout] = useState(false);

  const fail = (message: string) => {
    setError(message);
    setTries((n) => n + 1);
  };
  const offer = useFingerprintOffer(onDone, fail);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!master || busy) return;
    if (master !== confirm) return fail("The two passwords do not match.");
    setBusy(true);
    setError("");
    const result = await host.createVault(master);
    setBusy(false);
    setMaster("");
    setConfirm("");
    if (!result.ok) return fail(result.error);
    const bio = await host.biometricStatus();
    if (bio.available && !bio.enabled) {
      setError("");
      setStep(2);
    } else onDone();
  }

  let body: ReactNode;
  let hint: string;
  let actions: ReactNode = null;
  if (step === 1) {
    body = (
      <div key={tries} className={`mt-5 flex flex-col items-center gap-2.5 ${tries ? "shake" : ""}`}>
        <Pill label="Master password" value={master} onChange={setMaster} busy={busy} withSubmit={false} autoFocus />
        <Pill label="Confirm master password" value={confirm} onChange={setConfirm} busy={busy} />
        <div className="w-[280px] px-2">
          <StrengthMeter password={master} />
        </div>
      </div>
    );
    hint = busy ? "Creating your vault..." : "Choose a master password: at least 12 characters, rated Strong. Three or four unrelated words work well. It cannot be recovered.";
  } else ({ body, hint, actions } = offer);

  return (
    <LockWash>
      <div className="stagger mt-14 flex flex-col items-center [@media(max-height:640px)]:hidden">
        <p className="text-[17px] font-medium tracking-[-0.01em] text-ink-2">{date}</p>
        <p className="text-[72px] font-semibold leading-none tracking-[-0.045em] tabular-nums">{time}</p>
      </div>
      <form onSubmit={create} className="stagger mt-auto flex flex-col items-center px-4 pb-10 text-center">
        <AppIcon size={92} />
        <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.015em]">KAPEVault</h1>
        {/* Keyed on the step: a new step's body and buttons rise in again (the form's stagger); the hint never waits. */}
        <div key={`body-${step}`} className="flex w-full flex-col items-center">
          {body}
        </div>
        <Hint error={error} hint={hint} tries={tries} />
        {actions && (
          <div key={`actions-${step}`} className="mt-3 flex flex-col items-center">
            {actions}
          </div>
        )}
        {step === 1 && (
          <>
            <Safe />
            <div className="mt-2 flex justify-center gap-4">
              <button type="button" onClick={onRestore} className={`${linkButton} text-[12px]`}>
                Restore from backup
              </button>
              <button type="button" onClick={() => setAbout(true)} className={`${linkButton} text-[12px]`}>
                How KAPEVault protects you
              </button>
            </div>
          </>
        )}
        <Steps step={step} of={2} />
      </form>
      {about && <TrustSheet onClose={() => setAbout(false)} />}
    </LockWash>
  );
}
