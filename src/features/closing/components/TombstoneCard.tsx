import { useState } from "react";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/form";
import { vaultApi } from "@/lib/vault-api";
import { Card, Field } from "@/components/Card";
import { CopyButton } from "@/components/IconButton";
import { formatDay } from "@/lib/local-date";
import { useAction } from "@/hooks/use-action";
import type { LoginEntry } from "@/features/vault/types";

// What is left of a closed account: read only, no secrets. Deleting it is the only action.
export function TombstoneCard({ entry }: { entry: LoginEntry }) {
  const toast = useToast();
  const { run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const lifecycle = entry.lifecycle;

  function remove() {
    if (!confirming) return setConfirming(true);
    run(() => vaultApi.deleteEntry(entry.id), () => toast("Deleted for good"));
  }

  return (
    <>
      <Card>
        <Field label="Username" actions={entry.username && <CopyButton copy={() => vaultApi.copyText(entry.username, entry.id)} toastText="Username copied" />}>
          {entry.username || <span className="text-ink-3">None</span>}
        </Field>
        <Field label="Website">{entry.url || <span className="text-ink-3">None</span>}</Field>
        {lifecycle?.requestedAt && <Field label="Asked to delete">{formatDay(lifecycle.requestedAt)}</Field>}
        <Field label="Closed">{lifecycle?.goneAt ? formatDay(lifecycle.goneAt) : ""}</Field>
      </Card>
      <p className="mt-3 px-1 text-[12.5px] text-ink-3">Its passwords and codes were wiped when it closed.</p>
      <div className="mt-5 flex items-center gap-2">
        <Button type="button" variant="danger" onClick={remove}>
          {confirming ? "Confirm delete for good" : "Delete for good"}
        </Button>
        {confirming && (
          <Button type="button" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        )}
      </div>
    </>
  );
}
