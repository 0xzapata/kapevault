import { useState } from "react";
import { Button } from "@/components/form";
import { vaultApi } from "@/lib/vault-api";
import { importLines } from "./lib/import-note";
import type { VaultView } from "@/features/vault/types";
import { Group } from "./SettingRow";

type Note = { lines: string[]; error: boolean };

export function ImportSection({ onImported }: { onImported: (vault: VaultView) => void }) {
  const [note, setNote] = useState<Note>({ lines: [], error: false });
  const [importing, setImporting] = useState(false);

  async function importFile() {
    setImporting(true);
    const result = await vaultApi.importFile().finally(() => setImporting(false));
    if (!result.ok) {
      if (!result.canceled) setNote({ lines: [result.error ?? "Could not import that file."], error: true });
      return;
    }
    onImported(result.vault);
    setNote({ lines: importLines(result), error: !result.deleted });
  }

  return (
    <Group title="Import">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="min-w-[220px] flex-1 text-[13px] text-ink-3">
          Add logins and secure notes from an export (.csv or .json) of Bitwarden (not encrypted), 1Password, KeePass or KeePassXC, Chrome, Edge, Brave, Firefox, Apple Passwords or LastPass, or from a KAPEVault import file. Folders become tags, and cards come in as secure notes. Items already in the vault are skipped. The file is deleted afterwards, since it holds every password in plain text, unless something in it could not be imported.
        </p>
        <Button type="button" className="shrink-0" disabled={importing} onClick={importFile}>
          Import file...
        </Button>
      </div>
      {note.lines.length > 0 && (
        <div className={`flex flex-col gap-1 text-[13px] ${note.error ? "text-danger" : "text-ok"}`}>
          {note.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </Group>
  );
}
