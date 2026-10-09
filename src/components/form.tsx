import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { fieldIconButton } from "./buttons";

// hint: a small tag after the text (a scanned value's "from label").
export function Label({ text, hint, children }: { text: string; hint?: ReactNode; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Label wraps the field passed in as children (a TextInput, TextArea or Select), which is the control
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">
        {text}
        {hint}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "h-10 w-full rounded-[10px] border border-line bg-raised px-3 text-[14px] text-ink outline-none transition-[box-shadow,border-color] placeholder:text-ink-3 focus:border-accent focus:ring-4 focus:ring-accent-soft";

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

// Hover only while enabled, so a disabled button of any variant looks and stays inert.
const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent enabled:hover:brightness-110",
  plain: "bg-field text-ink enabled:hover:bg-line",
  danger: "bg-danger-soft text-danger enabled:hover:bg-danger enabled:hover:text-on-accent",
};

// A plain button, not a submit: inside a form the browser's own default is submit, so a form's real
// submit button says type="submit" and every other one cannot send the form by accident.
export function Button({ variant = "plain", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`press h-9 rounded-full px-4 text-[13.5px] font-medium transition-colors focus-ring disabled:opacity-50 ${variants[variant]} ${className}`}
    />
  );
}

// macOS-style switch. Only the knob moves (transform), so it stays smooth.
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 focus-ring disabled:opacity-50 ${checked ? "bg-accent" : "bg-line-strong"}`}
    >
      <span
        className={`absolute left-[2px] top-[2px] size-[18px] rounded-full bg-raised shadow-knob transition-transform duration-200 ease-out ${checked ? "translate-x-4" : ""}`}
      />
    </button>
  );
}

// The eye inside a secret field: shows or hides what is in it. what names the field ("password").
export function EyeButton({ shown, what, onClick, className = "" }: { shown: boolean; what: string; onClick: () => void; className?: string }) {
  const label = `${shown ? "Hide" : "Show"} ${what}`;
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={`${fieldIconButton} ${className}`}>
      {shown ? <EyeSlash size={16} /> : <Eye size={16} />}
    </button>
  );
}

export function ErrorText({ message }: { message: string }) {
  if (!message) return null;
  return <p role="alert" className="text-[13px] text-danger">{message}</p>; // read out the moment it appears
}
