import { useState } from "react";
import { Button } from "@/components/form";
import { vaultApi } from "@/lib/vault-api";
import { plural } from "@/lib/local-date";
import type { VaultView } from "@/features/vault/types";
import { Group } from "./SettingRow";

export function ImportSection({ onImported }: { onImported: (vault: VaultView) => void }) {
  const [note, setNote] = useState({ text: "", error: false });
  const [importing, setImporting] = useState(false);

  async function importFile() {
    setImporting(true);
    const result = await vaultApi.importFile().finally(() => setImporting(false));
    if (!result.ok) {
      if (!result.canceled) setNote({ text: result.error ?? "Could not import that file.", error: true });
      return;
    }
    onImported(result.vault);
    const skipped = result.skipped ? `, skipped ${result.skipped} already in the vault` : "";
    const added = `Added ${plural(result.added, "item")}${skipped}.`;
    if (result.deleted) setNote({ text: `${added} The import file was deleted.`, error: false });
    else setNote({ text: `${added} Could not delete ${result.name} - delete it yourself, it holds passwords.`, error: true });
  }

  return (
    <Group title="Import">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="min-w-[220px] flex-1 text-[13px] text-ink-3">
          Add logins and file links from a KAPEVault import file (.json). Items already in the vault are skipped. The file is deleted afterwards, since it holds passwords in plain text.
        </p>
        <Button type="button" className="shrink-0" disabled={importing} onClick={importFile}>
          Import file...
        </Button>
      </div>
      {note.text && <p className={`text-[13px] ${note.error ? "text-danger" : "text-ok"}`}>{note.text}</p>}
    </Group>
  );
}
