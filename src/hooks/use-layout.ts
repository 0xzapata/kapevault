import { useEffect, useState } from "react";

// The window is resizable, so the three panes rearrange by width:
//   wide     >= 1180  sidebar | list | detail
//   medium   900-1179 narrower sidebar | list | detail
//   narrow   640-899  list | detail, sidebar slides over from the left
//   compact  < 640    one column: the list, and the item pushed over it with a Back button
export type LayoutMode = "wide" | "medium" | "narrow" | "compact";

const QUERIES: [LayoutMode, string][] = [
  ["wide", "(min-width: 1180px)"],
  ["medium", "(min-width: 900px)"],
  ["narrow", "(min-width: 640px)"],
];

function current(): LayoutMode {
  return QUERIES.find(([, q]) => window.matchMedia(q).matches)?.[0] ?? "compact";
}

// matchMedia fires only when a threshold is crossed, so dragging the window edge re-renders the
// tree four times at most instead of on every pixel.
export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState(current);
  useEffect(() => {
    const lists = QUERIES.map(([, q]) => window.matchMedia(q));
    const update = () => setMode(current());
    lists.forEach((l) => l.addEventListener("change", update));
    return () => lists.forEach((l) => l.removeEventListener("change", update));
  }, []);
  return mode;
}

export const sidebarInline = (mode: LayoutMode) => mode === "wide" || mode === "medium";
