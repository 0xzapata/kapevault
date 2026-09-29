import { useEffect, useState, type CSSProperties } from "react";
import { vaultApi, type TotpCode } from "@/lib/vault-api";
import { CopyButton } from "@/components/IconButton";
import { Field } from "@/components/Card";

const RADIUS = 7;
const RING_LEN = 2 * Math.PI * RADIUS;
const WARN_SECONDS = 5;

// "123456" -> "123 456", "12345678" -> "1234 5678": easier to read off and type.
const grouped = (code: string) => `${code.slice(0, Math.ceil(code.length / 2))} ${code.slice(Math.ceil(code.length / 2))}`;

// The live 2FA code for a login. The secret stays in main; the page asks for the current code and
// asks again the moment it expires.
export function TotpField({ entryId }: { entryId: string }) {
  const [code, setCode] = useState<TotpCode | null>(null);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const next = await vaultApi.totp(entryId);
        if (!live) return;
        setCode(next);
        timer = setTimeout(load, Math.max(0, next.expiresAt - Date.now()) + 50);
      } catch {
        // Locked (the lock screen takes over) or the key was removed: nothing to show.
      }
    }
    load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [entryId]);

  // The seconds label ticks once a second; the ring runs on its own CSS animation.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0;

  return (
    <Field
      label="2FA code"
      actions={<CopyButton label="Copy 2FA code" copy={() => vaultApi.copyTotp(entryId)} toastText="2FA code copied" />}
    >
      {code ? (
        <span className="flex items-center gap-2.5">
          <span className="font-mono text-[15px] font-medium tracking-[0.08em] tabular-nums">{grouped(code.code)}</span>
          <Ring key={code.expiresAt} code={code} warn={left <= WARN_SECONDS} />
          <span className="text-[12.5px] text-ink-3 tabular-nums">
            {left}s
          </span>
        </span>
      ) : (
        <span className="block h-4 w-24 rounded-md bg-field" />
      )}
    </Field>
  );
}

// One linear sweep from where this code's period is now to empty. Keyed per code by the caller, so
// the start point and duration are fixed once per code - changing them mid-sweep would make it jump.
function Ring({ code, warn }: { code: TotpCode; warn: boolean }) {
  const [style] = useState(() => {
    const remainingMs = Math.max(0, code.expiresAt - Date.now());
    return {
      "--ring-len": RING_LEN,
      "--ring-from": RING_LEN * (1 - remainingMs / (code.period * 1000)),
      animationDuration: `${remainingMs}ms`,
    } as CSSProperties;
  });

  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="-rotate-90 shrink-0">
      <circle cx="9" cy="9" r={RADIUS} fill="none" strokeWidth="2" className="stroke-line-strong" />
      <circle
        cx="9"
        cy="9"
        r={RADIUS}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={RING_LEN}
        style={style}
        className={`ring-drain transition-colors ${warn ? "stroke-warn" : "stroke-accent"}`}
      />
    </svg>
  );
}
