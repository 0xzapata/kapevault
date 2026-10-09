import type { CSSProperties } from "react";
import { flushSync } from "react-dom";
import { useRovingTiles } from "@/hooks/use-roving-tiles";
import { KindTile } from "./EntryIcon";
import type { EntryKind } from "../types";

interface KindPickerProps {
  kinds: { value: EntryKind; label: string }[];
  value: EntryKind;
  onChange: (kind: EntryKind) => void;
}

// Columns for n tiles, at most max a row, spread so the rows come out as even as they can (6 = 3 + 3,
// 8 = 4 + 4, 7 = 4 + 3). Four keep "Secure note" whole on the sheet; three on the narrowest window.
const columnsFor = (n: number, max: number) => Math.ceil(n / Math.ceil(n / max));

// The New item kind picker: a grid of tiles, each the kind's own glyph and name, read in one glance.
// One Tab stop; arrow keys move and choose, like a segmented control.
export function KindPicker({ kinds, value, onChange }: KindPickerProps) {
  const n = kinds.length;
  const columns = { "--cols": columnsFor(n, 3), "--cols-wide": columnsFor(n, 4) } as CSSProperties;
  // The kind already chosen (clicked again, Home on the first tile) is no change at all.
  function choose(kind: EntryKind) {
    if (kind !== value) onChange(kind);
  }
  // Let the new kind's fields mount first: their autoFocus (Title, Who) would otherwise take focus.
  const tile = useRovingTiles(n, kinds.findIndex((k) => k.value === value), (i) => flushSync(() => choose(kinds[i].value)));

  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group of tiles in a grid sized by its parent; a fieldset adds its own box and min-width rules
    <div role="group" aria-label="Kind of item" style={columns} className="grid grid-cols-[repeat(var(--cols),minmax(0,1fr))] gap-1.5 sm:grid-cols-[repeat(var(--cols-wide),minmax(0,1fr))]">
      {kinds.map((k, i) => {
        const on = k.value === value;
        return (
          <button
            key={k.value}
            {...tile(i)}
            type="button"
            aria-pressed={on}
            onClick={() => choose(k.value)}
            className={`press row flex h-[62px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-[12px] border px-1 focus-ring ${
              on ? "border-accent bg-accent-soft text-accent" : "border-line bg-raised text-ink-2 hover:bg-hover"
            }`}
          >
            <KindTile kind={k.value} className="size-7 rounded-[8px]" />
            <span className="w-full truncate text-center text-[12px] font-medium leading-none">{k.label}</span>
          </button>
        );
      })}
    </div>
  );
}
