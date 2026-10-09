import { useState } from "react";
import { Button } from "@/components/form";
import { vaultApi } from "@/lib/vault-api";
import { useAction } from "@/hooks/use-action";
import { openerCheckNote } from "../lib/opener-check-note";

// Reads the Opener in the linked backup folder and compares it to KAPEVault's own copy. A changed one is put back.
export function CheckMyOpener() {
  const action = useAction();
  const [note, setNote] = useState({ text: "", ok: true });

  function click() {
    setNote({ text: "", ok: true });
    action.run(
      () => vaultApi.checkOpener(),
      (result) => setNote(result.ok ? openerCheckNote(result.result, result.version) : { text: result.error, ok: false }),
      () => setNote({ text: "Could not check the Opener. Try again.", ok: false }),
    );
  }

  return (
    <div className="space-y-2">
      <Button type="button" disabled={action.busy} onClick={click}>
        {action.busy ? "Checking..." : "Check my Opener"}
      </Button>
      {note.text && (
        <p role="status" className={`text-[13px] ${note.ok ? "text-ok" : "text-warn"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
