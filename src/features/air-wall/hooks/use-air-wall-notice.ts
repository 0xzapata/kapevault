import { useEffect } from "react";
import { vaultApi } from "@/lib/vault-api";
import { airWallNotice } from "../lib/air-wall-notice";

// Once per unlock (the vault screen mounts on it): if the firewall rule belongs to another copy of the
// app, say so outside Settings and offer the way to the switch. A failed read says nothing - Settings shows it.
export function useAirWallNotice(notify: (text: string, openSecurity: () => void) => void, openSecurity: () => void) {
  useEffect(() => {
    let live = true;
    vaultApi
      .airWallStatus()
      .then((r) => {
        const text = r.ok ? airWallNotice(r.status) : null;
        if (live && text) notify(text, openSecurity);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
}
