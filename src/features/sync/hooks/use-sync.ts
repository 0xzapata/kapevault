import { useEffect, useState } from "react";
import { vaultApi, type SyncStatus } from "@/lib/vault-api";

// Sync's status as main pushes it, plus what the page can ask for. busy: a Sync now (or the sync after
// the restore question) is on its way, the upload after it included.
export function useSync() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    vaultApi.syncStatus().then((s) => live && setStatus(s));
    const off = vaultApi.onSyncStatus(setStatus);
    return () => {
      live = false;
      off();
    };
  }, []);

  async function running(ask: () => Promise<SyncStatus>) {
    setBusy(true);
    try {
      setStatus(await ask());
    } finally {
      setBusy(false);
    }
  }

  return {
    status,
    busy,
    syncNow: () => running(() => vaultApi.syncNow()),
    answerRestore: (everywhere: boolean) => running(() => vaultApi.syncAnswerRestore(everywhere)),
    refresh: async () => setStatus(await vaultApi.syncStatus()),
    apply: async () => setStatus(await vaultApi.syncApply()),
    revoke: async (ref: string) => setStatus(await vaultApi.syncRevoke(ref)),
    // Join again after a removal: the vault's master password. The status after it comes back with the result.
    async rejoin(master: string) {
      const result = await vaultApi.syncRejoin(master);
      if (result.status) setStatus(result.status);
      return result;
    },
    // The master password another device set. Its merge then waits in status.review.
    async adoptKey(master: string) {
      const result = await vaultApi.syncAdoptKey(master);
      setStatus(result.status);
      return result;
    },
  };
}

// Re-renders every half minute, so "2 min ago" stays true while the window sits open.
export function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
}
