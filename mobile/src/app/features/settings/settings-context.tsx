import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useHost } from "../../host/host-context";
import type { PhoneSettings } from "../../host/types";

interface SettingsValue {
  settings: PhoneSettings | null; // null until read
  update: (patch: Partial<PhoneSettings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsValue>({ settings: null, update: async () => {} });

// This phone's settings, read once and kept in step with every change.
export function SettingsProvider({ children }: { children: ReactNode }) {
  const host = useHost();
  const [settings, setSettings] = useState<PhoneSettings | null>(null);
  useEffect(() => {
    host.settings().then(setSettings);
  }, [host]);
  const update = useCallback(async (patch: Partial<PhoneSettings>) => setSettings(await host.setSettings(patch)), [host]);
  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
