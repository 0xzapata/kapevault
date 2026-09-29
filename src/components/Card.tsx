import type { ReactNode } from "react";

// A grouped card of label/value rows, as in the detail pane.
export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-line bg-raised shadow-card">{children}</div>;
}

// Label beside the value on a roomy pane, stacked above it on a narrow one.
export function Field({ label, children, actions }: { label: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2 last:border-b-0 @md:gap-6 @md:px-5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 @md:flex-row @md:items-center @md:gap-6">
        <span className="shrink-0 text-[12px] text-ink-3 @md:w-28 @md:text-[13px]">{label}</span>
        <div className="selectable min-w-0 flex-1 truncate text-[14px]">{children}</div>
      </div>
      {actions && <div className="flex shrink-0 gap-0.5">{actions}</div>}
    </div>
  );
}
