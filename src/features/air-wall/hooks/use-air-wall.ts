import { useEffect, useState } from "react";
import { vaultApi, type AirWallStatus, type AirWallTest } from "@/lib/vault-api";

type Busy = null | "switch" | "test";

// Settings-side Air Wall: the firewall rule's state, the switch, and the one-click network test.
export function useAirWall() {
  const [status, setStatus] = useState<AirWallStatus | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const [tested, setTested] = useState<AirWallTest | null>(null);

  useEffect(() => {
    vaultApi.airWallStatus().then((r) => (r.ok ? setStatus(r.status) : setError(r.error)));
  }, []);

  async function toggle(on: boolean) {
    setBusy("switch");
    setError("");
    const result = await vaultApi.airWallSet(on).finally(() => setBusy(null));
    if (!result.ok) return setError(result.error);
    setStatus(result.status);
    setTested(null); // an old answer no longer describes the rule
  }

  async function test() {
    setBusy("test");
    setError("");
    setTested(null);
    const result = await vaultApi.airWallTest().finally(() => setBusy(null));
    if (result.ok) setTested(result.result);
    else setError(result.error);
  }

  return { status, busy, error, tested, toggle, test };
}
