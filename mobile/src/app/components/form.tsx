import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";

// The PC's form parts (src/components/form.tsx); text fields are 44 px tall instead of 40 (touch).

export function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Label wraps the field passed in as children (a TextInput, TextArea or Select), which is the control
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">{text}</span>
      {children}
    </label>
  );
}

const inputClass =
  "h-11 w-full rounded-[10px] border border-line bg-raised px-3 text-[14px] text-ink outline-none transition-[box-shadow,border-color] placeholder:text-ink-3 focus:border-accent focus:ring-4 focus:ring-accent-soft";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} h-24 resize-none py-2.5 ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

type Variant = "primary" | "plain" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent",
  plain: "bg-field text-ink",
  danger: "bg-danger-soft text-danger",
};

// 36 px like the PC, with a 44 px touch area around it.
export function Button({ variant = "plain", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" {...props} className={`press hit flex h-9 items-center justify-center gap-1.5 rounded-full px-4 text-[13.5px] font-medium focus-ring disabled:opacity-50 ${variants[variant]} ${className}`} />;
}

// macOS-style switch; only the knob moves. The row around it is the touch target.
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`hit relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 focus-ring disabled:opacity-50 ${checked ? "bg-accent" : "bg-line-strong"}`}
    >
      <span className={`absolute left-[2px] top-[2px] size-[18px] rounded-full bg-raised shadow-tile transition-transform duration-200 ease-out ${checked ? "translate-x-4" : ""}`} />
    </button>
  );
}

// A round icon button inside a field: show, generate. 44 px, as the canvas draws it.
export const fieldIcon = "press grid size-11 place-items-center rounded-full text-ink-3 active:bg-accent-soft active:text-accent focus-ring";

export function EyeButton({ shown, what, onClick }: { shown: boolean; what: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={`${shown ? "Hide" : "Show"} ${what}`} onClick={onClick} className={fieldIcon}>
      {shown ? <EyeSlash size={16} /> : <Eye size={16} />}
    </button>
  );
}

export function ErrorText({ message }: { message: string }) {
  if (!message) return null;
  return (
    // A long form's error may sit below the fold: bring it into view the moment it appears.
    <p key={message} ref={(el) => el?.scrollIntoView({ block: "nearest" })} role="alert" className="settle text-[13px] text-danger">
      {message}
    </p>
  );
}

// One choice out of a few: the canvas's pill segmented control (the PC's Segmented at phone size).
// The selected look is one thumb that slides between options (p-1 = 4 px each side, gap-0.5 = 2 px).
export function Segmented<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const at = options.findIndex((o) => o.value === value);
  return (
    <div role="radiogroup" aria-label={label} className="relative flex gap-0.5 rounded-[20px] bg-field p-1">
      {at >= 0 && (
        <span
          aria-hidden
          className="seg-thumb absolute bottom-1 left-1 top-1 rounded-2xl bg-raised shadow-tile"
          style={{ width: `calc((100% - 8px - ${options.length - 1} * 2px) / ${options.length})`, transform: `translateX(calc(${at} * (100% + 2px)))` }}
        />
      )}
      {options.map((o) => (
        // biome-ignore lint/a11y/useSemanticElements: a segmented radio drawn as buttons on one sliding track; a native radio input cannot be styled as this control
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`press hit relative z-10 min-h-8 min-w-0 flex-1 rounded-2xl px-1 py-1 text-[13px] font-medium leading-tight focus-ring ${value === o.value ? "text-ink" : "text-ink-2"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
