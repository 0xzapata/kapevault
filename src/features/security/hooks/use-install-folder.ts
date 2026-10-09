import { useEffect, useState } from "react";
import { vaultApi } from "@/lib/vault-api";

// Who else can write the folder KAPEVault runs from (main reads it once at startup). Nobody until it
// answers, and nobody when it cannot: Security only lists what was found.
export function useInstallFolderWriters() {
  const [writers, setWriters] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    vaultApi
      .installFolderWriters()
      .then((names) => live && Array.isArray(names) && setWriters(names))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return writers;
}
