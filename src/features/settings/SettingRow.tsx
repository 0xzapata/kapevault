import type { ReactNode } from "react";
import { Switch } from "@/components/form";

// One titled block inside a settings section; blocks after the first get a hairline above.
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-6 first:border-t-0 first:pt-0">
      <h3 className="text-[13px] font-semibold text-ink-2">{title}</h3>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

interface SwitchRowProps {
  title: string; // also the switch's accessible name
  badge?: ReactNode; // shown after the title, e.g. the hotkey
  icon?: ReactNode;
  note?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

// Clicking the words flips the switch, like a macOS settings row.
export function SwitchRow({ title, badge, icon, note, checked, disabled, onChange }: SwitchRowProps) {
  return (
    <label className="flex items-start gap-3">
      {icon && <span className="mt-px shrink-0 text-accent">{icon}</span>}
      <span className="min-w-0 flex-1 text-[13.5px] text-ink">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {title}
          {badge}
        </span>
        {note && <span className="mt-0.5 block text-[12.5px] text-ink-3">{note}</span>}
      </span>
      <Switch label={title} checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[6px] border border-line bg-field px-1.5 py-px font-sans text-[11.5px] font-medium text-ink-2">{children}</kbd>;
}
