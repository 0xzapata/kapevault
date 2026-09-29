import { createContext, useContext, type ReactNode } from "react";
import type { VaultHost } from "./types";

const HostContext = createContext<VaultHost | null>(null);

// The one vault host the app talks to (the mock today, the real one next), handed in at the root.
export function HostProvider({ host, children }: { host: VaultHost; children: ReactNode }) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

export function useHost(): VaultHost {
  const host = useContext(HostContext);
  if (!host) throw new Error("useHost outside HostProvider");
  return host;
}
