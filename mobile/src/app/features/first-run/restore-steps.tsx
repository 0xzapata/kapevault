import type { ReactNode } from "react";
import { Camera, FileArrowUp, WarningCircle } from "@phosphor-icons/react";
import type { R2Keys } from "../../host/types";
import { GlassGlyph, Pill, linkButton } from "../unlock/lock-parts";
import { BucketFacts } from "../settings/BucketFacts";
import { BackupPicker, Viewfinder, cta } from "./first-run-parts";
import type { RestoreFlow } from "./use-restore-flow";

// One step of Restore from backup as RestoreFromBackup lays it out: the picture or fields, the line
// under them, and the buttons.
export type StepView = { body: ReactNode; hint: string; actions?: ReactNode };

const danger = "press hit flex h-9 items-center justify-center rounded-full bg-danger-soft px-4 text-[13.5px] font-medium text-danger disabled:opacity-50 focus-ring";
const small = `${linkButton} text-[12.5px]`;

// From a file, step 1: Android's own picker (Drive, Files, USB).
export function fileSteps(flow: RestoreFlow): StepView {
  return {
    body: (
      <div className="mt-5">
        <GlassGlyph>
          <FileArrowUp size={38} weight="duotone" />
        </GlassGlyph>
      </div>
    ),
    hint: "Pick your .kapevault backup file, from Google Drive, Files or a USB drive.",
    actions: (
      <>
        <button type="button" onClick={() => flow.fileInput.current?.click()} className={cta}>
          Choose file
        </button>
        <button type="button" onClick={() => flow.switchMode(false)} className={small}>
          Scan a code instead
        </button>
      </>
    ),
  };
}

// From R2, steps 1 and 2: the PC's code scanned (then whose bucket it names), or the keys typed; then
// the backup.
export function r2Steps(flow: RestoreFlow): StepView {
  const { step, typed, scanned, busy, keys } = flow;
  if (step === 2) {
    return {
      body: <BackupPicker backups={flow.backups} picked={flow.picked} onPick={flow.setPicked} />,
      hint: "Pick a backup. The newest one is picked for you.",
      actions: (
        <button type="button" onClick={() => flow.go(3)} className={cta}>
          Use this backup
        </button>
      ),
    };
  }
  if (!typed && scanned) {
    return {
      body: (
        <div className="mt-5 w-[300px] max-w-full">
          <BucketFacts account={scanned.account} bucket={scanned.bucket} />
        </div>
      ),
      hint: "Connect to this bucket? Use it only if it is yours.",
      actions: (
        <>
          <button type="button" onClick={() => flow.connect(scanned.keys)} disabled={busy} className={cta}>
            {busy ? "Connecting..." : "Connect"}
          </button>
          <button type="button" onClick={() => flow.setScanned(null)} disabled={busy} className={small}>
            Scan again
          </button>
        </>
      ),
    };
  }
  if (!typed) {
    return {
      body: <Viewfinder busy={busy} />,
      hint: "Connect to your R2 backup: the code in your PC's Settings > Backup > Add a phone, or on your Emergency Kit.",
      actions: (
        <>
          <button type="button" onClick={flow.scan} disabled={busy} className={cta}>
            <Camera size={16} />
            Scan the code
          </button>
          <div className="flex gap-4">
            <button type="button" onClick={() => flow.switchMode(true)} className={small}>
              Type the keys instead
            </button>
            <button type="button" onClick={() => flow.switchMode(false, "file")} className={small}>
              Use a file instead
            </button>
          </div>
        </>
      ),
    };
  }
  const field = (label: string, key: keyof R2Keys, mono = false) => <Pill label={label} value={keys[key]} onChange={(v) => flow.setKeys({ ...keys, [key]: v })} mono={mono} withSubmit={false} type={key === "secretAccessKey" ? "password" : "text"} />;
  return {
    body: (
      <div className="mt-[18px] flex flex-col items-center gap-2.5">
        {field("S3 API URL", "url")}
        {field("Access key ID", "accessKeyId", true)}
        {field("Secret access key", "secretAccessKey", true)}
      </div>
    ),
    hint: "Connect to your R2 backup: the same three values as Settings > Backup on your PC.",
    actions: (
      <>
        <button type="button" onClick={() => flow.connect(keys)} disabled={busy || !keys.url || !keys.accessKeyId || !keys.secretAccessKey} className={cta}>
          {busy ? "Connecting..." : "Connect"}
        </button>
        <button type="button" onClick={() => flow.switchMode(false)} className={small}>
          Scan a code instead
        </button>
      </>
    ),
  };
}

// Step 3 for both: the backup's master password, and what a restore can ask before it replaces
// anything - a backup from before a newer master password, or no room to keep the vault it replaces.
export function passwordSteps(flow: RestoreFlow): StepView {
  const { older, confirm, busy, tries } = flow;
  if (older) {
    return {
      body: (
        <span className="mt-5 grid size-[72px] place-items-center rounded-full bg-warn-soft text-warn">
          <WarningCircle size={40} weight="duotone" />
        </span>
      ),
      hint: busy ? "Unlocking..." : older,
      actions: (
        <>
          <button type="button" disabled={busy} onClick={flow.restoreAnyway} className={cta}>
            Restore anyway
          </button>
          <button type="button" onClick={flow.cancelReplace} className={small}>
            Pick another backup
          </button>
        </>
      ),
    };
  }
  if (confirm) {
    return {
      body: confirm.needsMaster && (
        <div key={tries} className={`mt-5 ${tries ? "shake" : ""}`}>
          <Pill label="This phone's master password" value={flow.current} onChange={flow.setCurrent} busy={busy} withSubmit={false} autoFocus />
        </div>
      ),
      hint: busy ? "Replacing..." : confirm.needsMaster ? `${confirm.question} Enter this phone's master password to go ahead.` : confirm.question,
      actions: (
        <>
          <button type="submit" disabled={busy || (confirm.needsMaster && !flow.current)} className={danger}>
            Replace without a copy
          </button>
          <button type="button" onClick={flow.cancelReplace} className={small}>
            Cancel
          </button>
        </>
      ),
    };
  }
  return {
    body: (
      <div key={tries} className={`mt-5 ${tries ? "shake" : ""}`}>
        <Pill label="Master password" value={flow.master} onChange={flow.setMaster} busy={busy} autoFocus />
      </div>
    ),
    hint: busy ? "Unlocking..." : flow.backupFile && flow.source === "file" ? `Master password for ${flow.backupFile.name}` : "Master password for this backup",
  };
}
