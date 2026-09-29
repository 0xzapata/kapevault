import { useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { biometricName } from "@/lib/platform";
import { useBiometricStatus } from "@/features/biometric/hooks/use-biometric-status";
import type { VaultView } from "@/features/vault/types";

type Opened = { ok: true; vault: VaultView };
type Refused = { ok: false; error: string; code?: string };

export const UNLOCK_FAILED = "Something went wrong opening the vault. Try again.";

// Unlocking, shared by the lock screen and quick search: the master password (or a new vault's
// first one) and Windows Hello / Touch ID. Main does the checking and the throttle; its answer
// (including "wait N seconds") is shown as it comes. failures bumps on every error so the shake
// replays. Each attempt answers failed: true when it did not open the vault (the opposite of
// useAction's run, which answers true when it went through), so the caller can empty its fields.
export function useUnlock(onOpen: (vault: VaultView) => void, bioActive: boolean) {
  const [error, setError] = useState("");
  const [failures, setFailures] = useState(0);
  const [busy, setBusy] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const bio = useBiometricStatus(bioActive);
  const bioName = biometricName(bio.status);
  const canUseBio = Boolean(bio.status?.enabled && !bio.status.needsMaster);

  function fail(message: string) {
    setError(message);
    setFailures((n) => n + 1);
  }

  // attempt: vaultApi.unlock(master), or create(master) for a new vault. Answers failed.
  async function withMaster(attempt: () => Promise<Opened | Refused>): Promise<boolean> {
    setBusy(true);
    setError("");
    let result: Opened | Refused;
    try {
      result = await attempt();
    } catch {
      result = { ok: false, error: UNLOCK_FAILED };
    } finally {
      setBusy(false);
    }
    if (result.ok) {
      onOpen(result.vault);
      return false;
    }
    fail(result.error);
    return true;
  }

  // Only on a click: a prompt that pops up by itself would steal focus from whatever is in front.
  // threw: the error when the call itself fails. A cancelled prompt says nothing. Answers failed.
  async function withBiometric(threw: string): Promise<boolean> {
    setBioBusy(true);
    setError("");
    let result: Opened | Refused;
    try {
      result = await vaultApi.unlockBiometric();
    } catch {
      result = { ok: false, code: "failed", error: threw };
    } finally {
      setBioBusy(false);
    }
    if (result.ok) {
      onOpen(result.vault);
      return false;
    }
    if (result.code === "canceled") return false;
    fail(result.error);
    bio.refresh(); // Hello may have been turned off or now wants the master password
    return true;
  }

  return { error, failures, busy, bioBusy, bio, bioName, canUseBio, fail, withMaster, withBiometric };
}
