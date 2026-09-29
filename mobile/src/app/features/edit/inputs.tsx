import { useState, type ReactNode } from "react";
import { ArrowsClockwise, CaretDown } from "@phosphor-icons/react";
import { ratePassword } from "@core";
import { EyeButton, Label, TextInput, fieldIcon } from "../../components/form";

// A secret's field: masked, with show (and for passwords, generate) inside it on the right.
export function SecretInput({ label, value, onChange, generate }: { label: string; value: string | null; onChange: (v: string) => void; generate?: () => string }) {
  const [shown, setShown] = useState(false);
  return (
    <Label text={label}>
      <span className="relative flex items-center">
        <TextInput
          type={shown ? "text" : "password"}
          value={value ?? ""}
          placeholder={value === null ? "Loading..." : undefined}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          className={`font-mono ${generate ? "pr-[92px]" : "pr-12"}`}
        />
        <span className="absolute right-0 flex">
          <EyeButton shown={shown} what={label.toLowerCase()} onClick={() => setShown(!shown)} />
          {generate && (
            <button
              type="button"
              aria-label="Generate password"
              onClick={() => {
                onChange(generate());
                setShown(true);
              }}
              className={fieldIcon}
            >
              <ArrowsClockwise size={15} weight="bold" />
            </button>
          )}
        </span>
      </span>
    </Label>
  );
}

const METER = ["bg-meter-0", "bg-meter-1", "bg-meter-2", "bg-meter-3", "bg-meter-4"];

// The PC's strength meter: four segments and the word, from core's rating.
export function StrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const { score, label } = ratePassword(password);
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i < Math.max(1, score) ? METER[score] : "bg-line-strong"}`} />
        ))}
      </div>
      <span className="text-[12px] text-ink-3">{label}</span>
    </div>
  );
}

// Optional fields folded under one quiet button (the PC's MoreOptions).
export function More({ open, onOpen, label = "More options", children }: { open: boolean; onOpen: () => void; label?: string; children: ReactNode }) {
  if (open) return <div className="settle flex flex-col gap-4">{children}</div>;
  return (
    <button type="button" aria-expanded="false" onClick={onOpen} className="press flex min-h-11 items-center gap-1 self-start text-[12.5px] font-semibold text-accent focus-ring">
      {label}
      <CaretDown size={12} weight="bold" />
    </button>
  );
}
