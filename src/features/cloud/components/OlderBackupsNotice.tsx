import { useEffect, useState } from "react";
import { Button } from "@/components/form";
import { vaultApi } from "@/lib/vault-api";
import { useAction } from "@/hooks/use-action";

// Shown after a master password change (and under Cloud backup until done): cloud backups made
// before it still open with the old password, which matters if the old one leaked. Deleting them is
// offered, never automatic.
export function OlderBackupsNotice() {
  const [connected, setConnected] = useState(false);
  const { busy, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    vaultApi.cloudStatus().then((s) => setConnected(s.settings !== null));
  }, []);

  const forget = () =>
    run(() => vaultApi.cloudForgetOlder(), (result) =>
      setMessage(!result.ok ? result.error : result.refused > 0
        ? `Deleted ${result.deleted}. ${result.refused} older ${result.refused === 1 ? "backup is" : "backups are"} still locked by your bucket's lock rule and will go when it allows; try again then.`
        : `Deleted ${result.deleted} older ${result.deleted === 1 ? "backup" : "backups"}. A fresh one is saved under the new password.`),
    );

  if (!connected) return null;
  if (message) return <p className="text-[13px] text-ink-2">{message}</p>;
  return (
    <div className="flex items-center gap-3 rounded-[12px] bg-field px-3.5 py-3">
      <p className="flex-1 text-[12.5px] text-ink-2">
        Cloud backups made before your last master password change still open with the old password. Copies you saved yourself do too.
      </p>
      {confirming ? (
        <>
          <Button type="button" className="h-8 shrink-0 bg-raised" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button type="button" variant="danger" className="h-8 shrink-0" disabled={busy} onClick={forget}>
            {busy ? "Deleting..." : "Confirm delete"}
          </Button>
        </>
      ) : (
        <Button type="button" variant="danger" className="h-8 shrink-0" onClick={() => setConfirming(true)}>
          Delete older backups
        </Button>
      )}
    </div>
  );
}
