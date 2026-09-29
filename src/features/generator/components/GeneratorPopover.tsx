import { useState, type RefObject } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { Popover } from "@/components/Popover";
import { Button, Switch } from "@/components/form";
import { DEFAULT_GENERATOR, MAX_LENGTH, MIN_LENGTH, generatePassword, type GeneratorOptions } from "../lib/generate-password";
import { StrengthMeter } from "./StrengthMeter";

const STORAGE_KEY = "kapevault.generator";

type Toggle = Exclude<keyof GeneratorOptions, "length">;
const CLASSES: { key: Toggle; label: string }[] = [
  { key: "upper", label: "A-Z" },
  { key: "lower", label: "a-z" },
  { key: "digits", label: "0-9" },
  { key: "symbols", label: "Symbols" },
];

// Last used options, kept per PC. Storage can be missing or blocked, so every access is guarded.
function loadOptions(): GeneratorOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return DEFAULT_GENERATOR;
    const options = { ...DEFAULT_GENERATOR };
    for (const key of Object.keys(options) as (keyof GeneratorOptions)[]) {
      if (typeof saved[key] === typeof options[key]) Object.assign(options, { [key]: saved[key] });
    }
    options.length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(options.length) || DEFAULT_GENERATOR.length));
    return options;
  } catch {
    return DEFAULT_GENERATOR;
  }
}

function saveOptions(options: GeneratorOptions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // not remembered this time; the generator still works
  }
}

function charClass(c: string) {
  if (/[0-9]/.test(c)) return "text-accent";
  if (/[A-Za-z]/.test(c)) return "text-ink";
  return "text-sys-purple";
}

interface GeneratorPopoverProps {
  anchor: RefObject<HTMLElement | null>;
  trigger: RefObject<HTMLElement | null>;
  onUse: (password: string) => void;
  onClose: () => void;
}

export function GeneratorPopover({ anchor, trigger, onUse, onClose }: GeneratorPopoverProps) {
  const [options, setOptions] = useState(loadOptions);
  const [password, setPassword] = useState(() => generatePassword(options));
  const classesOn = CLASSES.filter((c) => options[c.key]).length;

  function change(patch: Partial<GeneratorOptions>) {
    const next = { ...options, ...patch };
    setOptions(next);
    saveOptions(next);
    setPassword(generatePassword(next));
  }

  return (
    <Popover anchor={anchor} trigger={trigger} label="Password generator" onClose={onClose} className="w-[340px] rounded-[14px] border border-line bg-raised p-3 shadow-sheet">
      <div className="flex items-start gap-2 rounded-[10px] bg-surface py-2 pl-3 pr-1.5">
        <p className="selectable min-h-[44px] min-w-0 flex-1 break-all py-0.5 font-mono text-[15px] leading-[22px]">
          {[...password].map((c, i) => (
            <span key={i} className={charClass(c)}>
              {c}
            </span>
          ))}
        </p>
        <button
          type="button"
          aria-label="New password"
          title="New password"
          onClick={() => setPassword(generatePassword(options))}
          className="press grid size-8 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-accent-soft hover:text-accent focus-ring"
        >
          <ArrowsClockwise size={16} />
        </button>
      </div>

      <StrengthMeter password={password} className="mt-2.5 px-1" />

      <label className="mt-3 flex items-center gap-3 px-1">
        <span className="text-[13px] text-ink-2">Length</span>
        <input
          type="range"
          aria-label="Length"
          min={MIN_LENGTH}
          max={MAX_LENGTH}
          value={options.length}
          onChange={(e) => change({ length: Number(e.target.value) })}
          // Enter on the slider must not submit the form behind it
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          className="min-w-0 flex-1 accent-accent"
        />
        <span className="w-6 text-right text-[13px] font-medium tabular-nums text-ink">{options.length}</span>
      </label>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 px-1">
        {CLASSES.map((c) => (
          <label key={c.key} className="flex items-center justify-between gap-2 text-[13px] text-ink">
            <span className={c.key === "symbols" ? "" : "font-mono"}>{c.label}</span>
            {/* The last class left on cannot be turned off */}
            <Switch label={c.label} checked={options[c.key]} disabled={options[c.key] && classesOn === 1} onChange={(on) => change({ [c.key]: on })} />
          </label>
        ))}
        <label className="col-span-2 flex items-center justify-between gap-2 text-[13px] text-ink">
          <span>
            Avoid look-alikes <span className="font-mono text-ink-3">0 O 1 l I</span>
          </span>
          <Switch label="Avoid look-alikes" checked={options.avoidAmbiguous} onChange={(on) => change({ avoidAmbiguous: on })} />
        </label>
      </div>

      <Button type="button" variant="primary" onClick={() => onUse(password)} className="mt-3.5 w-full">
        Use password
      </Button>
    </Popover>
  );
}
