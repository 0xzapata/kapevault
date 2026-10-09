import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Check } from "@phosphor-icons/react";
import { SORT_LABELS, type SortOrder } from "../../lib/filter";
import { useSheetExit } from "../../components/Sheet";

// The PC's sort menu: a small raised card that grows out of the sort button, top right, and shrinks
// back into it on close (data-closing, the sheets' exit).
export function SortMenu({ value, onChange, onClose }: { value: SortOrder; onChange: (s: SortOrder) => void; onClose: () => void }) {
  const { closing, close } = useSheetExit(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return createPortal(
    <div data-closing={closing || undefined}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the scrim closes the menu on a tap outside it; the back gesture closes it too */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the scrim closes the menu on a tap outside it; the back gesture closes it too */}
      <div className="fixed inset-0 z-40" onClick={close} />
      <div role="menu" aria-label="Sort by" className="drop fixed right-3 top-[calc(var(--sat)+50px)] z-50 w-56 rounded-[14px] border border-line bg-raised p-1 shadow-sheet">
        <p className="px-3 pb-1 pt-2 text-[11.5px] font-semibold text-ink-3">Sort by</p>
        {(Object.keys(SORT_LABELS) as SortOrder[]).map((s) => (
          <button
            key={s}
            type="button"
            role="menuitemradio"
            aria-checked={s === value}
            onClick={() => {
              onChange(s);
              close();
            }}
            className="press flex h-11 w-full items-center gap-2 rounded-[10px] px-3 text-left text-[14px] active:bg-hover focus-ring"
          >
            <span className="w-4">{s === value && <Check size={14} weight="bold" className="text-accent" />}</span>
            {SORT_LABELS[s]}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
