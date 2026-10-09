// A small "PRO" pill: marks what is part of KAPEVault Pro. Shown only to people who do not own it.
export function ProTag({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-block shrink-0 rounded-full bg-sys-orange/15 px-1.5 text-[10px] font-semibold leading-4 tracking-[0.06em] text-[color-mix(in_srgb,var(--color-sys-orange)_55%,var(--color-ink))] ${className}`}>
      PRO
    </span>
  );
}
