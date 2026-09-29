import { useCallback, useEffect, useState } from "react";
import { vaultApi, type BiometricStatus } from "@/lib/vault-api";

// Windows Hello / Touch ID state from the main process. A failed check reads as "not available".
export function useBiometricStatus(active = true) {
  const [status, setStatus] = useState<BiometricStatus | null>(null);

  const refresh = useCallback(
    () =>
      vaultApi
        .biometricStatus()
        .then(setStatus)
        .catch(() => setStatus(null)),
    [],
  );

  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);

  return { status, setStatus, refresh };
}
