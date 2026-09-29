import { useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

// Where a key moves among `count` tiles: arrows step and wrap round, Home and End jump. null = not a move.
export function nextTile(key: string, index: number, count: number): number | null {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (STEP[key]) return (index + STEP[key] + count) % count;
  return null;
}

// A picker's tiles as ONE Tab stop (the tile that has the focus, else the chosen one, else the first);
// arrows, Home and End move between them. Once the focus leaves the tiles the stop goes back to the
// chosen one, so a picker that reopens or a search that changes the tiles never starts on a stray
// tile. onMove runs before the tile takes the focus: a group that chooses as you move (kind, sign-in,
// theme, Segmented) commits there - the kind in flushSync, so fields that autoFocus cannot keep it.
// Spread tile(i) on the i-th tile.
export function useRovingTiles(count: number, chosen: number, onMove?: (index: number) => void) {
  const tiles = useRef<(HTMLElement | null)[]>([]);
  const [focused, setFocused] = useState(-1);
  const stop = focused >= 0 && focused < count ? focused : Math.max(chosen, 0);

  return (index: number) => ({
    ref: (el: HTMLElement | null) => {
      tiles.current[index] = el;
    },
    tabIndex: index === stop ? 0 : -1,
    onFocus: () => setFocused(index),
    onBlur: (e: FocusEvent) => {
      if (!tiles.current.includes(e.relatedTarget as HTMLElement | null)) setFocused(-1);
    },
    onKeyDown: (e: KeyboardEvent) => {
      const next = nextTile(e.key, index, count);
      if (next === null) return;
      e.preventDefault();
      onMove?.(next);
      tiles.current[next]?.focus();
    },
  });
}
