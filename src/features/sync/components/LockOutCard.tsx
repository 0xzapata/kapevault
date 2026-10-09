import { useState } from "react";
import { LockKey } from "@phosphor-icons/react";
import { Button } from "@/components/form";
import { ChangeMasterForm } from "@/features/settings/ChangeMasterForm";
import { OlderBackupsNotice } from "@/features/cloud/components/OlderBackupsNotice";
import { deviceNames } from "../lib/sync-line";

interface LockOutCardProps {
  names: string[]; // the removed devices not yet locked out
  masterDone: boolean; // the master password was changed from this card
  biometricOff: boolean; // and that turned Hello / Touch ID off
  onMasterChanged: (biometricOff: boolean) => void;
}

// After Remove from sync: removing only stops the device's changes from merging. A lost device that
// still has the vault key and the R2 token can keep writing, so two steps lock it out for good: a new
// master password (a new key) and a new R2 token. It stays in the Sync sheet until the master changed.
export function LockOutCard({ names, masterDone, biometricOff, onMasterChanged }: LockOutCardProps) {
  const [changing, setChanging] = useState(false);

  return (
    <section className="settle space-y-3 rounded-[12px] bg-warn-soft px-3.5 py-3" aria-label="Finish locking out">
      <div className="flex items-start gap-2.5">
        <LockKey size={18} weight="fill" className="mt-px shrink-0 text-warn" />
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-medium text-ink">Finish locking out {deviceNames(names)}</h3>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            Removing a device only stops its changes from syncing. If it still has your vault key and R2 token, it can come back. Two steps close that.
          </p>
        </div>
      </div>

      <div>
        <p className="text-[13px] font-medium text-ink">{masterDone ? "1. Master password changed" : "1. Change your master password"}</p>
        {!masterDone && <p className="text-[12.5px] text-ink-2">This makes a new vault key, so the old one on that device stops working.</p>}
        {!masterDone && !changing && (
          <Button type="button" className="mt-2 h-8 bg-raised" onClick={() => setChanging(true)}>
            Change master password...
          </Button>
        )}
        {masterDone && biometricOff && <p className="text-[12.5px] text-ink-2">Quick unlock was turned off with the old key. Turn it on again in Settings &gt; Security.</p>}
        {masterDone && <OlderBackupsNotice />}
        {!masterDone && changing && <ChangeMasterForm className="mt-3" onChanged={(result) => onMasterChanged(Boolean(result.biometricOff))} />}
      </div>

      <div>
        <p className="text-[13px] font-medium text-ink">2. Replace your R2 API token</p>
        <p className="text-[12.5px] text-ink-2">
          The old token can still write to your bucket. In Cloudflare, make a new token and delete the old one. Then in Settings &gt; Backup &gt; Cloud backup, choose Disconnect and Connect again with the new keys.
        </p>
      </div>
    </section>
  );
}
