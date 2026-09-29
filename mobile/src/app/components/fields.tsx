import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Check, Copy, Eye, EyeSlash } from "@phosphor-icons/react";
import { useCopyAction } from "./Toast";
import { rowIcon } from "./buttons";
import { groupCode } from "../lib/format";
import type { TotpCode } from "../host/types";

// The detail's grouped white card and its label-over-value rows (the PC's src/components/Card.tsx at compact width).

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-2xl border border-line bg-raised shadow-card ${className}`}>{children}</div>;
}

export function Field({ label, children, actions }: { label: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-1 border-b border-line py-2 pl-4 pr-1 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="track-small text-[12px] text-ink-3">{label}</span>
        <div className="selectable min-w-0 truncate text-[14px]">{children}</div>
      </div>
      {actions}
    </div>
  );
}

export function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={rowIcon}>
      {children}
    </button>
  );
}

export function CopyButton({ label = "Copy", copy, toastText }: { label?: string; copy: () => Promise<unknown>; toastText: string }) {
  const { copied, run } = useCopyAction();
  return (
    <IconButton label={copied ? "Copied" : label} onClick={() => run(copy, toastText)}>
      {copied ? <Check size={16} weight="bold" className="swap-in text-ok" /> : <Copy size={16} />}
    </IconButton>
  );
}

// A stored secret: masked until revealed, fetched from the host only when asked for, forgotten on hide.
export function useReveal(load: () => Promise<string>) {
  const [value, setValue] = useState<string | null>(null);
  async function toggle() {
    if (value !== null) return setValue(null);
    try {
      setValue(await load());
    } catch {
      setValue(null);
    }
  }
  return { value, toggle };
}

interface SecretFieldProps {
  label: string;
  what: string; // "password", "old password": said in the button labels
  reveal: () => Promise<string>;
  copy: () => Promise<unknown>;
  copiedToast: string;
  dots?: number;
}

export function SecretField({ label, what, reveal, copy, copiedToast, dots = 14 }: SecretFieldProps) {
  const { value, toggle } = useReveal(reveal);
  return (
    <Field
      label={label}
      actions={
        <>
          <IconButton label={value === null ? `Reveal ${what}` : `Hide ${what}`} onClick={toggle}>
            {value === null ? <Eye size={16} /> : <EyeSlash size={16} />}
          </IconButton>
          <CopyButton label={`Copy ${what} (clears in 30s)`} copy={copy} toastText={copiedToast} />
        </>
      }
    >
      <span className="whitespace-pre-wrap font-mono tracking-[0.06em]">{value ?? "•".repeat(dots)}</span>
    </Field>
  );
}

const RADIUS = 7;
const RING_LEN = 2 * Math.PI * RADIUS;

// The live code, its draining ring and the seconds left (the PC's TotpField body).
export function TotpValue({ code, left }: { code: TotpCode | null; left: number }) {
  if (!code) return <span className="shimmer block h-4 w-24 rounded-md bg-field" />;
  return (
    <span className="flex items-center gap-2.5 tabular-nums">
      {/* A new code settles in: the one value on screen that changes without a touch. */}
      <span key={code.code} className="settle font-mono text-[15px] font-medium tracking-[0.08em]">
        {groupCode(code.code)}
      </span>
      <Ring key={code.expiresAt} code={code} warn={left <= 5} />
      <span className={`text-[12.5px] transition-colors duration-150 ease-out ${left <= 5 ? "text-warn" : "text-ink-3"}`}>{left}s</span>
    </span>
  );
}

function Ring({ code, warn }: { code: TotpCode; warn: boolean }) {
  const [style] = useState(() => {
    const remaining = Math.max(0, code.expiresAt - Date.now());
    return { "--ring-len": RING_LEN, "--ring-from": RING_LEN * (1 - remaining / (code.period * 1000)), animationDuration: `${remaining}ms` } as CSSProperties;
  });
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="-rotate-90 shrink-0">
      <circle cx="9" cy="9" r={RADIUS} fill="none" strokeWidth="2" className="stroke-line-strong" />
      <circle cx="9" cy="9" r={RADIUS} fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={RING_LEN} style={style} className={`ring-drain transition-colors ${warn ? "stroke-warn" : "stroke-accent"}`} />
    </svg>
  );
}

// Keeps a relative time ("2 min ago") fresh while it is on screen.
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
