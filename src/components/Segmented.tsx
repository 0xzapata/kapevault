import { useRovingTiles } from "@/hooks/use-roving-tiles";

interface SegmentedProps<T extends string | number> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string; // the columns: grid-cols-3, grid-cols-5
}

// One choice out of a few, as a segmented control: a radio group with one Tab stop, and the arrows,
// Home and End choose as they move (useRovingTiles). "In a hurry" on a thing, a device's type.
export function Segmented<T extends string | number>({ label, options, value, onChange, className = "" }: SegmentedProps<T>) {
  const tile = useRovingTiles(options.length, options.findIndex((o) => o.value === value), (i) => onChange(options[i].value));

  return (
    <div role="radiogroup" aria-label={label} className={`grid gap-1 rounded-[10px] bg-field p-1 ${className}`}>
      {options.map((o, i) => (
        // biome-ignore lint/a11y/useSemanticElements: a segmented radio drawn as buttons on one sliding track; a native radio input cannot be styled as this control
        <button
          key={o.value}
          {...tile(i)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`press min-h-8 rounded-lg px-1 py-1 text-[13px] font-medium leading-tight focus-ring ${value === o.value ? "bg-raised text-ink shadow-card" : "text-ink-2"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
