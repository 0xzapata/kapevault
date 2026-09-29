import { useRef, useState, type ChangeEvent } from "react";
import { useHost } from "../../host/host-context";
import { MAX_VAULT_BYTES } from "../../host/vault-file";
import type { Backup, R2Keys } from "../../host/types";
import { useSetupScan } from "../cloud/use-setup-scan";

export type Step = 1 | 2 | 3 | 4;
export type RestoreFlow = ReturnType<typeof useRestoreFlow>;

// Restore from backup's state and steps (RestoreFromBackup draws them): connect to R2 (a scanned code or
// the three values typed), pick a backup, its master password, then fingerprint - or a picked file, its
// master password, then fingerprint.
export function useRestoreFlow(fromFile: boolean, onDone: () => void) {
  const host = useHost();
  const [step, setStep] = useState<Step>(1);
  const [source, setSource] = useState<"r2" | "file">(fromFile ? "file" : "r2");
  const [backupFile, setBackupFile] = useState<{ name: string; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState(false); // "Type the keys instead"
  const [keys, setKeys] = useState<R2Keys>({ url: "", accessKeyId: "", secretAccessKey: "" });
  const [backups, setBackups] = useState<Backup[]>([]);
  const [picked, setPicked] = useState("");
  const [master, setMaster] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);
  // The restore could not keep the vault it replaces: "Replace without a copy" (the PC's confirm step).
  // Locked, it also takes this phone's current master password.
  const [confirm, setConfirm] = useState<{ question: string; needsMaster: boolean } | null>(null);
  const [current, setCurrent] = useState("");
  // The backup is from before a master password change made on another device since: said plainly, then
  // "Restore anyway" goes ahead (olderOk) or the user picks another backup.
  const [older, setOlder] = useState<string | null>(null);
  const [olderOk, setOlderOk] = useState(false);

  const fail = (message: string) => {
    setError(message);
    setTries((n) => n + 1);
  };
  const { scanned, setScanned, scan } = useSetupScan(fail);

  function go(next: Step) {
    setError("");
    setScanned(null);
    setConfirm(null);
    setCurrent("");
    setOlder(null);
    setOlderOk(false);
    setStep(next);
  }

  function switchMode(typing: boolean, to: "r2" | "file" = "r2") {
    setError("");
    setScanned(null);
    setTyped(typing);
    setSource(to);
  }

  // The WebView's file input opens Android's document picker. The file is checked as soon as it is read,
  // before any master password is asked for.
  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file picked again still fires
    if (!file) return;
    if (file.size > MAX_VAULT_BYTES) return fail("That file is too big to be a KAPEVault backup."); // before reading it all
    let text: string;
    try {
      text = await file.text(); // Drive offline, access revoked
    } catch {
      return fail("Could not read that file. Try again, or copy it to the phone first.");
    }
    const check = host.checkBackupFile(text);
    if (!check.ok) return fail(check.error);
    setBackupFile({ name: file.name, text });
    go(3);
  }

  async function connect(r2: R2Keys) {
    setBusy(true);
    setError("");
    const result = await host.listBackups(r2);
    setBusy(false);
    if (!result.ok) return fail(result.error);
    if (result.backups.length === 0) return fail("That bucket has no KAPEVault backups yet. Back up from your PC first.");
    setKeys(r2);
    setBackups(result.backups);
    setPicked(result.backups[0].key);
    go(2);
  }

  async function restore(acceptOlder = olderOk) {
    if (!master || busy || (confirm?.needsMaster && !current)) return;
    setBusy(true);
    setError("");
    const replace = confirm ? { current } : undefined;
    const result = source === "file" && backupFile ? await host.restoreFile(backupFile.text, master, replace) : await host.restore(keys, picked, master, replace, acceptOlder);
    setBusy(false);
    setCurrent("");
    if (!result.ok && "olderKey" in result) return setOlder(result.error); // nothing replaced; the password stays typed
    if (!result.ok && "needsConfirm" in result) {
      // The backup's password stays typed for the second try; nothing was replaced yet.
      if (confirm) return fail(result.error);
      return setConfirm({ question: result.error, needsMaster: Boolean(result.needsMaster) });
    }
    setMaster("");
    setConfirm(null);
    if (!result.ok) return fail(result.error);
    const bio = await host.biometricStatus();
    if (bio.available && !bio.enabled) go(4);
    else onDone();
  }

  function restoreAnyway() {
    setOlder(null);
    setOlderOk(true);
    void restore(true);
  }

  function cancelReplace() {
    setMaster("");
    go(older ? 2 : 3);
  }

  return {
    step,
    source,
    typed,
    keys,
    setKeys,
    scanned,
    setScanned,
    backups,
    picked,
    setPicked,
    backupFile,
    fileInput,
    master,
    setMaster,
    current,
    setCurrent,
    confirm,
    older,
    busy,
    error,
    tries,
    fail,
    go,
    switchMode,
    pickFile,
    connect,
    scan: () => {
      setError("");
      void scan(connect);
    },
    restore,
    restoreAnyway,
    cancelReplace,
  };
}
