import { useEffect, useRef } from "react";

// Android's back gesture closes the top layer (a sheet, the drawer, an item) instead of leaving the
// app. While any layer is open the page holds ONE extra history entry; Capacitor goes back in the
// WebView's history while it can, and only then closes the app. The entry is added or removed a tick
// after the layers change, so a layer that closes and another that opens in the same moment (and
// React's StrictMode remount) never walk the history out of the page.
const stack: (() => void)[] = [];
let pushed = false;
let ignore = 0; // pops we caused ourselves
let queued = false;

function sync() {
  queued = false;
  if (stack.length > 0 && !pushed) {
    history.pushState({ kapevaultLayer: true }, "");
    pushed = true;
  } else if (stack.length === 0 && pushed) {
    pushed = false;
    ignore += 1;
    history.back();
  }
}
function schedule() {
  if (queued) return;
  queued = true;
  setTimeout(sync, 0);
}

window.addEventListener("popstate", () => {
  if (ignore > 0) {
    ignore -= 1;
    return;
  }
  if (!pushed) return;
  pushed = false; // the back gesture used our entry
  stack.pop()?.();
  schedule(); // more layers still open: take a new entry for the next back
});

export function useBackLayer(open: boolean, onBack: () => void) {
  const latest = useRef(onBack);
  latest.current = onBack;

  useEffect(() => {
    if (!open) return;
    const layer = () => latest.current();
    stack.push(layer);
    schedule();
    return () => {
      const i = stack.lastIndexOf(layer);
      if (i >= 0) stack.splice(i, 1);
      schedule();
    };
  }, [open]);
}
