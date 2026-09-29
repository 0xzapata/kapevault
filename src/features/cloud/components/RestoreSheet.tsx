import { useId, useRef, useState, type KeyboardEvent } from "react";
import { File } from "@phosphor-icons/react";
import { Sheet } from "@/components/Sheet";
import { Button, ErrorText, Label, TextInput } from "@/components/form";
import { vaultApi, type CloudInput, type RestoreKept, type Snapshot } from "@/lib/vault-api";
import { DEVICE } from "@/lib/platform";
import { useAction } from "@/hooks/use-action";
import type { VaultView } from "@/features/vault/types";
import { useFileRestore } from "../hooks/use-file-restore";
import { CredentialsForm } from "./CredentialsForm";
import { CurrentMasterField } from "./CurrentMasterField";
import { SnapshotList } from "./SnapshotList";

type Tab = "cloud" | "file";
const TABS: { id: Tab; label: string }[] = [
  { id: "cloud", label: "Cloud (R2)" },
  { id: "file", label: "File" },
];

type Opened = (vault: VaultView, kept: RestoreKept) => void; // the backup's password was checked and the restored vault is open

interface RestoreSheetProps {
  onClose: () => void;
  onOpened: Opened;
  initialTab?: Tab;
  replaced?: string; // the vault the last restore replaced, already picked: only its password is asked
}

// One tab's panel: labelled by its tab, hidden while the other is shown (both stay mounted, so
// switching tabs keeps what was typed).
interface PanelProps {
  ids: string;
  hidden: boolean;
  onOpened: Opened;
  onCancel: () => void;
}

const panel = (ids: string, tab: Tab, hidden: boolean) => ({ role: "tabpanel", id: `${ids}-${tab}-panel`, "aria-labelledby": `${ids}-${tab}-tab`, hidden });

// Restore for a new PC, a vault that will not open, or rolling back. R2 keys typed here are used for
// this restore only; nothing is replaced until the backup's own master password opens it.
export function RestoreSheet({ onClose, onOpened, initialTab = "cloud", replaced }: RestoreSheetProps) {
  const [tab, setTab] = useState<Tab>(replaced ? "file" : initialTab);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ cloud: null, file: null });
  const ids = useId();

  function onTabKey(e: KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    let nextIndex = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIndex = (i + 1) % TABS.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") nextIndex = (i - 1 + TABS.length) % TABS.length;
    if (e.key === "Home") nextIndex = 0;
    if (e.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex < 0) return;
    e.preventDefault();
    const next = TABS[nextIndex].id;
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <Sheet title={replaced ? "Restore the replaced vault" : "Restore from backup"} onClose={onClose}>
      {(close) => (
        <>
          <div hidden={Boolean(replaced)} role="tablist" aria-label="Restore from" onKeyDown={onTabKey} className="mb-5 flex rounded-full bg-field p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`${ids}-${t.id}-tab`}
                aria-selected={tab === t.id}
                aria-controls={`${ids}-${t.id}-panel`}
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                className={`h-8 flex-1 rounded-full text-[13px] font-medium transition-colors focus-ring ${
                  tab === t.id ? "bg-raised text-ink shadow-tile" : "text-ink-2 hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <CloudPanel ids={ids} hidden={tab !== "cloud"} onOpened={onOpened} onCancel={close} />
          <FilePanel ids={ids} hidden={tab !== "file"} onOpened={onOpened} onCancel={close} replaced={replaced} />
        </>
      )}
    </Sheet>
  );
}

// The bucket's keys, typed for this restore only, then the backups found there.
function CloudPanel({ ids, hidden, onOpened, onCancel }: PanelProps) {
  const [input, setInput] = useState<CloudInput | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const { busy: finding, run: runFind } = useAction();
  const [error, setError] = useState("");

  function find(next: CloudInput) {
    setError("");
    return runFind(
      () => vaultApi.cloudList(next),
      (result) => {
        if (!result.ok) return setError(result.error);
        setInput(next);
        setSnapshots(result.snapshots);
      },
      setError,
    );
  }

  async function restoreSnapshot(key: string, backupMaster: string, confirmed: boolean, currentMaster: string) {
    if (!input) return { ok: false as const, error: "Find the backups first." };
    const result = await vaultApi.cloudRestore(key, input, backupMaster, confirmed, currentMaster);
    if (result.ok) onOpened(result.vault, result);
    return result;
  }

  return (
    <div {...panel(ids, "cloud", hidden)}>
      {input ? (
        <div className="space-y-4">
          <SnapshotList snapshots={snapshots} onRestore={restoreSnapshot} />
          <div className="flex justify-end">
            <Button type="button" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-4 text-[13px] text-ink-3">Enter the bucket and keys you connected in Settings. They are used for this restore only.</p>
          <CredentialsForm submitLabel="Find backups" busyLabel="Looking..." busy={finding} error={error} onSubmit={find} />
        </>
      )}
    </div>
  );
}

// A saved copy (.kapevault) picked from disk, or the replaced vault, opened with its own password.
function FilePanel({ ids, hidden, onOpened, onCancel, replaced }: PanelProps & { replaced?: string }) {
  const file = useFileRestore(replaced, onOpened);

  return (
    <form {...panel(ids, "file", hidden)} onSubmit={file.restore} className="space-y-4">
      <p className="text-[13px] text-ink-3">
        {replaced
          ? "The vault the last restore replaced. Enter the master password it had then - the vault here now is kept in its place."
          : `Pick a saved copy (.kapevault). Nothing on this ${DEVICE} changes unless that backup's master password opens it - then it replaces the vault here, which is kept first.`}
      </p>
      <div hidden={Boolean(replaced)} className="flex items-center gap-3 rounded-[12px] bg-field px-3.5 py-3">
        <File size={20} weight="duotone" className="shrink-0 text-accent" />
        <span className={`min-w-0 flex-1 truncate text-[13.5px] ${file.fileName ? "font-medium text-ink" : "text-ink-3"}`} title={file.fileName || undefined}>
          {file.fileName || "No file chosen"}
        </span>
        <Button type="button" className="h-8 shrink-0 bg-raised" disabled={file.picking || file.restoring} onClick={file.pick}>
          Choose file...
        </Button>
      </div>
      {file.fileName && (
        <div className="settle">
          <Label text="Master password for this backup">
            <TextInput type="password" autoFocus value={file.master} onChange={(e) => file.setMaster(e.target.value)} />
          </Label>
        </div>
      )}
      {file.needsMaster && <CurrentMasterField key={file.tries} value={file.current} onChange={file.setCurrent} />}
      <ErrorText message={file.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant={file.needsConfirm ? "danger" : "primary"} disabled={!file.fileName || !file.master || file.restoring || (file.needsMaster && !file.current)}>
          {file.restoring ? "Restoring..." : file.needsConfirm ? "Replace without a copy" : "Restore"}
        </Button>
      </div>
    </form>
  );
}
