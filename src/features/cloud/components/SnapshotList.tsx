import { useState, type FormEvent } from "react";
import { Button, ErrorText, TextInput } from "@/components/form";
import type { RestoreKept, RestoreRefused, Snapshot } from "@/lib/vault-api";
import { DEVICE } from "@/lib/platform";
import { useAction } from "@/hooks/use-action";
import { formatBackupSize, formatWhen } from "@/lib/format";
import { restoredNote } from "../lib/restore-note";
import { CurrentMasterField } from "./CurrentMasterField";

interface SnapshotListProps {
  snapshots: Snapshot[];
  // master = the password that backup was made with. Success says what was kept of the vault it replaced.
  // needsConfirm: the vault here cannot be kept; confirmed = the second click replaces it with no copy.
  // needsMaster: it is locked, so that click also takes its own master password (current).
  onRestore: (key: string, master: string, confirmed: boolean, current: string) => Promise<({ ok: true } & RestoreKept) | RestoreRefused>;
}

// Backups newest first. Restoring one asks for the master password it was made with - nothing here
// changes until that password opens it.
export function SnapshotList({ snapshots, onRestore }: SnapshotListProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [master, setMaster] = useState("");
  const { busy, run } = useAction();
  const [error, setError] = useState("");
  const [restored, setRestored] = useState("");
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [needsMaster, setNeedsMaster] = useState(false);
  const [current, setCurrent] = useState("");
  const [tries, setTries] = useState(0);

  function askAgain() {
    setNeedsConfirm(false);
    setNeedsMaster(false);
    setCurrent("");
  }

  function ask(key: string | null) {
    setConfirming(key);
    setMaster("");
    setError("");
    askAgain();
  }

  function restore(e: FormEvent, key: string) {
    e.preventDefault();
    setError("");
    run(() => onRestore(key, master, needsConfirm, current), settle, setError);
  }

  // What the restore answered: a confirm step, a refusal, or done.
  function settle(result: Awaited<ReturnType<typeof onRestore>>) {
    if (!result.ok && result.needsConfirm) {
      setNeedsConfirm(true);
      setError(result.error); // keep the password: the next click replaces without asking again
      if (result.needsMaster) {
        setNeedsMaster(true);
        setCurrent("");
        setTries((n) => n + 1); // a fresh, focused field for this try
      }
      return;
    }
    askAgain();
    setMaster("");
    if (!result.ok) setError(result.error);
    else {
      setRestored(restoredNote(result, DEVICE));
      setConfirming(null);
    }
  }

  if (snapshots.length === 0) return <p className="text-[13px] text-ink-3">No backups in this bucket yet.</p>;

  return (
    <div>
      <ul aria-label="Backups" className="max-h-[248px] divide-y divide-line overflow-y-auto rounded-[12px] bg-field">
        {snapshots.map((s) => (
          <li key={s.key} className="px-3.5 py-2.5">
            <div className="flex items-center gap-3">
              <span className="text-[13.5px] font-medium tabular-nums text-ink">{formatWhen(s.at)}</span>
              <span className="text-[12.5px] text-ink-3">{formatBackupSize(s.size)}</span>
              {s.key.includes("before-restore") && <span className="rounded-full bg-raised px-2 py-0.5 text-[11.5px] font-medium text-ink-2">Before a restore</span>}
              {s.otherDevice && <span className="rounded-full bg-raised px-2 py-0.5 text-[11.5px] font-medium text-ink-2">Another {DEVICE}</span>}
              {confirming !== s.key && (
                <Button type="button" className="ml-auto h-8 bg-raised" onClick={() => ask(s.key)}>
                  Restore
                </Button>
              )}
            </div>
            {confirming === s.key && (
              <form onSubmit={(e) => restore(e, s.key)} className="settle mt-2.5 space-y-2">
                <p className="text-[12.5px] text-ink-2">
                  Enter the master password this backup was made with. Your current vault is kept first, then this one opens in its place.
                </p>
                {needsMaster && <CurrentMasterField key={tries} value={current} onChange={setCurrent} />}
                <div className="flex items-center gap-2">
                  <TextInput
                    type="password"
                    autoFocus
                    aria-label="Master password for this backup"
                    value={master}
                    onChange={(e) => {
                      setMaster(e.target.value);
                      askAgain();
                    }}
                    className="h-8 min-w-0 flex-1"
                  />
                  <Button type="button" className="h-8 shrink-0 bg-raised" onClick={() => ask(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant={needsConfirm ? "danger" : "primary"} className="h-8 shrink-0" disabled={busy || !master || (needsMaster && !current)}>
                    {busy ? "Restoring..." : needsConfirm ? "Replace without a copy" : "Confirm restore"}
                  </Button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2">
        <ErrorText message={error} />
        {restored && !error && <p className="text-[13px] text-ok">{restored}</p>}
      </div>
    </div>
  );
}
