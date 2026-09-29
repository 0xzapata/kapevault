import { useEffect, useState } from "react";
import { vaultApi, type FolderCopyStatus } from "@/lib/vault-api";

// Keep a copy in a folder: its status as main pushes it (one after every copy), plus Choose and Turn off.
export function useFolderCopy() {
  const [status, setStatus] = useState<FolderCopyStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    vaultApi.folderStatus().then(
      (s) => live && setStatus(s),
      () => {}, // main's status() never throws; only a broken IPC lands here, and the next push fills it in
    );
    const off = vaultApi.onFolderStatus(setStatus);
    return () => {
      live = false;
      off();
    };
  }, []);

  async function choose() {
    setError("");
    const result = await vaultApi.chooseFolder();
    if (!result.ok) setError(result.error);
    else if (result.status) setStatus(result.status);
  }

  async function stop() {
    setError("");
    const result = await vaultApi.stopFolder();
    if (!result.ok) setError(result.error);
    else setStatus(result.status);
  }

  return { status, error, choose, stop };
}
