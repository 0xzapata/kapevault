import { useEffect, useState } from "react";
import { useHost } from "../host/host-context";
import type { TotpCode } from "../host/types";

// A login's live 2FA code: asked for again the moment it expires; seconds left tick once a second.
export function useTotp(id: string | null) {
  const host = useHost();
  const [code, setCode] = useState<TotpCode | null>(null);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    setCode(null);
    if (!id) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      host.totp(id).then(
        (next) => {
          if (!live) return;
          setCode(next);
          timer = setTimeout(load, Math.max(0, next.expiresAt - Date.now()) + 50);
        },
        () => {}, // locked, or the key was removed: nothing to show
      );
    load();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      live = false;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [host, id]);

  const left = code ? Math.min(code.period, Math.max(0, Math.ceil((code.expiresAt - now) / 1000))) : 0;
  return { code, left };
}
