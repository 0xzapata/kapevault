import { useEffect, useRef, useState } from "react";

const DRAWER_EXIT_MS = 200; // matches .drawer[data-closing] in index.css

// The sidebar as a drawer on narrow windows: open, closing (the exit plays), or gone. inline: the
// window is wide enough for the sidebar in place, which shuts the drawer at once.
export function useDrawer(inline: boolean) {
  const [state, setState] = useState<"open" | "closing" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (inline) setState(null);
  }, [inline]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function close() {
    if (state !== "open") return;
    setState("closing");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(null), DRAWER_EXIT_MS);
  }

  function toggle() {
    if (state === "open") close();
    else {
      clearTimeout(timer.current); // a close still settling must not shut the reopened drawer
      setState("open");
    }
  }

  return { state, open: state === "open", close, toggle };
}
