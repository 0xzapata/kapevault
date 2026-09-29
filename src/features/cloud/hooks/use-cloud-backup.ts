import { useCallback, useEffect, useState } from "react";
import { vaultApi, type CloudInput, type CloudStatus, type Snapshot } from "@/lib/vault-api";

type Busy = null | "connect" | "backup";

// Settings-side cloud backup: status, the backup list, and the actions on them.
export function useCloudBackup() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");

  const refreshList = useCallback(async () => {
    const result = await vaultApi.cloudList();
    if (result.ok) setSnapshots(result.snapshots);
    else setError(result.error);
  }, []);

  useEffect(() => {
    vaultApi.cloudStatus().then((s) => {
      setStatus(s);
      if (s.settings) refreshList();
    });
  }, [refreshList]);

  async function run(kind: Busy, action: () => ReturnType<typeof vaultApi.cloudBackupNow>) {
    setBusy(kind);
    setError("");
    const result = await action().finally(() => setBusy(null));
    if (!result.ok) {
      setError(result.error);
      setStatus(await vaultApi.cloudStatus()); // Connect may have saved the keys before the upload failed
      return false;
    }
    setStatus(result.status);
    await refreshList();
    setStatus(await vaultApi.cloudStatus()); // the Opener check runs after the upload and may have news
    return true;
  }

  return {
    status,
    snapshots,
    busy,
    error,
    connect: (input: CloudInput) => run("connect", () => vaultApi.cloudConnect(input)),
    backupNow: () => run("backup", () => vaultApi.cloudBackupNow()),
    setAuto: async (auto: boolean) => setStatus(await vaultApi.cloudSetAuto(auto)),
    async disconnect() {
      setStatus(await vaultApi.cloudDisconnect());
      setSnapshots([]);
      setError("");
    },
    // On success main opens the restored vault and every window shows it.
    restore: (key: string, master: string, confirmed: boolean, current: string) => vaultApi.cloudRestore(key, undefined, master, confirmed, current),
  };
}
