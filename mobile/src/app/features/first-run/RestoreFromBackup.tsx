import type { FormEvent } from "react";
import { CaretLeft } from "@phosphor-icons/react";
import { backPill } from "../../components/buttons";
import { AppIcon } from "../../components/icons";
import { Hint, LockWash } from "../unlock/lock-parts";
import { Steps, useFingerprintOffer } from "./first-run-parts";
import { fileSteps, passwordSteps, r2Steps, type StepView } from "./restore-steps";
import { useRestoreFlow, type Step } from "./use-restore-flow";

// Restore from backup, a link on the first-run and lock screens, one step at a time as the PC's lock
// screen: connect to R2 (the PC's QR, or the three values typed), pick a backup, its master password,
// then fingerprint. Or from a file (also Settings > Restore from a file): pick it with Android's own
// picker (Drive, Files, USB), its master password, then fingerprint. Cancel goes back to where it came from.
// The steps' state is use-restore-flow.ts; what each step shows, restore-steps.tsx.
export function RestoreFromBackup({ fromFile = false, onCancel, onDone }: { fromFile?: boolean; onCancel: () => void; onDone: () => void }) {
  const flow = useRestoreFlow(fromFile, onDone);
  const { step, source, typed, scanned, older, confirm, error, tries } = flow;
  const offer = useFingerprintOffer(onDone, flow.fail);

  function unlock(e: FormEvent) {
    e.preventDefault();
    void flow.restore();
  }

  const { body, hint, actions }: StepView = step === 4 ? offer : step === 3 ? passwordSteps(flow) : source === "file" ? fileSteps(flow) : r2Steps(flow);
  const small = step === 1 && !typed && source === "r2";
  const view = `${step}-${source}-${typed}-${Boolean(scanned)}-${Boolean(older)}-${Boolean(confirm)}`;
  const back = step === 2 || step === 3 ? () => flow.go(source === "file" ? 1 : ((step - 1) as Step)) : step === 1 ? onCancel : undefined;
  return (
    <LockWash>
      <div className="flex h-[52px] shrink-0 items-center px-3">
        {back && (
          <button type="button" onClick={back} className={backPill}>
            <CaretLeft size={17} weight="bold" />
            {step === 1 ? "Cancel" : "Back"}
          </button>
        )}
      </div>
      <form onSubmit={unlock} className="mt-auto flex min-h-0 flex-col items-center px-4 pb-10 text-center">
        <AppIcon size={small ? 56 : 92} />
        <h1 className={`font-semibold tracking-[-0.015em] ${small ? "mt-2.5 text-[18px]" : "mt-4 text-[22px]"}`}>KAPEVault</h1>
        {/* A new step (or its scan/typed, older, replace variant) settles in; the hint never waits. min-h-0: the backup list scrolls. */}
        <div key={`body-${view}`} className="settle flex min-h-0 w-full flex-col items-center">
          {body}
        </div>
        <Hint error={error} hint={hint} tries={tries} />
        {actions && (
          <div key={`actions-${view}`} className="settle mt-3 flex flex-col items-center">
            {actions}
          </div>
        )}
        {/* A file skips the bucket's two steps: pick, password, fingerprint. */}
        <Steps step={source === "file" ? Math.max(1, step - 1) : step} of={source === "file" ? 3 : 4} />
      </form>
      {/* No accept: .kapevault has no MIME type, and Capacitor's picker (BridgeWebChromeClient) throws on an extension it cannot map. */}
      <input ref={flow.fileInput} type="file" hidden onChange={flow.pickFile} />
    </LockWash>
  );
}
