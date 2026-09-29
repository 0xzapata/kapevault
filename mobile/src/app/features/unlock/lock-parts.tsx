import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Fingerprint, LockSimple } from "@phosphor-icons/react";

// Pieces of the PC lock screen at phone size, shared by unlock and first run.

export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  return {
    time: now.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?[AP]M$/i, ""),
    date: now.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" }),
  };
}

// The wash over the painted acrylic, full screen, ending above the keyboard.
export function LockWash({ children }: { children: ReactNode }) {
  return <div className="lock-wash fixed inset-x-0 top-0 bottom-[var(--kb)] flex flex-col overflow-hidden pt-[var(--sat)] pb-[var(--sab)] text-ink">{children}</div>;
}

const glass = "bg-glass backdrop-blur-xl";
const pillShadow = "shadow-[inset_0_1px_0_var(--color-glass-edge),0_4px_18px_rgb(0_0_0_/_0.08)]";
const tileShadow = "shadow-[inset_0_1px_0_var(--color-glass-edge),var(--shadow-tile)]";

// The PC's glass pill; the submit arrow lives inside it.
export function Pill({ label, value, onChange, busy, mono, autoFocus, withSubmit = true, type = "password" }: { label: string; value: string; onChange: (v: string) => void; busy?: boolean; mono?: boolean; autoFocus?: boolean; withSubmit?: boolean; type?: string }) {
  return (
    <span className={`flex h-11 w-[300px] max-w-full items-center rounded-full pl-5 pr-1.5 focus-within:outline-2 focus-within:outline-accent ${glass} ${pillShadow}`}>
      <input
        type={type}
        autoFocus={autoFocus}
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="go"
        className={`h-full min-w-0 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-ink-2 ${mono ? "font-mono" : ""}`}
      />
      {withSubmit && (
        <button type="submit" aria-label={busy ? "Working" : "Continue"} disabled={busy || value.length === 0} className="press hit grid size-8 shrink-0 place-items-center rounded-full bg-accent text-on-accent transition-opacity disabled:opacity-35 focus-ring">
          <ArrowRight size={16} weight="bold" />
        </button>
      )}
    </span>
  );
}

export function FingerprintButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label="Unlock with fingerprint" onClick={onClick} disabled={disabled} className={`press grid size-11 shrink-0 place-items-center rounded-full text-accent disabled:opacity-50 focus-ring ${glass} ${tileShadow}`}>
      <Fingerprint size={24} weight="duotone" />
    </button>
  );
}

// A big glyph on a round glass tile: the fingerprint offer, the file pick.
export function GlassGlyph({ children }: { children: ReactNode }) {
  return <span className={`mx-auto grid size-[72px] place-items-center rounded-full text-accent ${glass} ${tileShadow}`}>{children}</span>;
}

export function BigFingerprint() {
  return (
    <GlassGlyph>
      <Fingerprint size={40} weight="duotone" />
    </GlassGlyph>
  );
}

export function Safe() {
  return (
    <p className="track-small mt-6 flex items-center justify-center gap-1.5 text-[12px] text-ink-3">
      <LockSimple size={12} weight="bold" />
      AES-256 encrypted on this phone
    </p>
  );
}

export const linkButton = "press flex min-h-11 min-w-11 items-center justify-center px-1 font-medium whitespace-nowrap text-accent focus-ring";

// Hint under the form: an error is an alert, new with each try; the hint is only polite.
export function Hint({ error, hint, tries }: { error: string; hint: string; tries: number }) {
  return error ? (
    <p key={`e-${tries}`} role="alert" className="mt-4 min-h-[18px] max-w-[340px] text-[13px] text-danger">
      {error}
    </p>
  ) : (
    <p aria-live="polite" className="mt-4 min-h-[18px] max-w-[340px] text-[13px] text-ink-2">
      {hint}
    </p>
  );
}
