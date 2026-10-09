import { useEffect, useState } from "react";
import { useHost } from "../host/host-context";
import type { ProStatus, SyncStatus, VaultView } from "../host/types";

// The unlocked vault's public view, kept current by the host's change events. Null while loading.
export function useVault() {
  const host = useHost();
  const [view, setView] = useState<VaultView | null>(null);
  useEffect(() => {
    let live = true;
    const off = host.onChanged((v) => live && setView(v));
    host.view().then((v) => live && setView(v), () => {});
    return () => {
      live = false;
      off();
    };
  }, [host]);
  return view;
}

export function useSync() {
  const host = useHost();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  useEffect(() => {
    let live = true;
    const off = host.onSync((s) => live && setStatus(s));
    host.syncStatus().then((s) => live && setStatus(s));
    return () => {
      live = false;
      off();
    };
  }, [host]);
  return status;
}

// KAPEVault Pro as this phone last heard it (no call to Google Play). Null while loading.
export function usePro() {
  const host = useHost();
  const [status, setStatus] = useState<ProStatus | null>(null);
  useEffect(() => {
    let live = true;
    const off = host.onPro((s) => live && setStatus(s));
    host.proStatus().then((s) => live && setStatus(s), () => {}); // unknown stays null: Pro shows as not loaded
    return () => {
      live = false;
      off();
    };
  }, [host]);
  return status;
}
