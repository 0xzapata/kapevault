import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { tabStops } from "@/lib/focus";

const GAP = 6;
const EDGE = 8;

export type PopoverCloseReason = "escape" | "outside";

interface PopoverProps {
  anchor: RefObject<HTMLElement | null>; // opens under this element, or above it when there is no room
  trigger?: RefObject<HTMLElement | null>; // the button that toggles it: not an outside click, gets focus back on Escape
  label: string;
  onClose: (reason: PopoverCloseReason) => void;
  className?: string;
  children: ReactNode;
}

// A small panel attached to a field. It is fixed-positioned in place (not portaled) so it stays
// inside the Sheet's dialog for focus and tests; a fixed box escapes the Sheet's scroll clipping.
// Escape or a click outside closes it, Tab cycles inside, and it stays inside the window at any size.
export function Popover({ anchor, trigger, label, onClose, className = "", children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    function place() {
      const target = anchor.current;
      if (!el || !target) return;
      const r = target.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const { offsetWidth: width, offsetHeight: height } = el;
      let top = r.bottom + GAP;
      let origin = "top";
      if (top + height > vh - EDGE) {
        if (r.top - GAP - height >= EDGE) {
          top = r.top - GAP - height;
          origin = "bottom";
        } else {
          top = vh - EDGE - height; // no room either side: overlap the field, stay in the window
        }
      }
      setPos({ left: Math.max(EDGE, Math.min(r.left, vw - width - EDGE)), top: Math.max(EDGE, top), origin });
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true); // the Sheet scrolling moves the field
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    // Capture phase on window, so Escape closes only this and never the Sheet behind it.
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      trigger?.current?.focus();
      onClose("escape");
    }
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) || trigger?.current?.contains(target)) return;
      onClose("outside");
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose, trigger]);

  function cycleTab(e: ReactKeyboardEvent) {
    if (e.key !== "Tab" || !ref.current) return;
    const items = tabStops(ref.current);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next = at + (e.shiftKey ? -1 : 1);
    if (next < 0) next = items.length - 1;
    if (next >= items.length) next = 0;
    e.preventDefault();
    items[next].focus();
  }

  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={cycleTab}
      style={pos ? { left: pos.left, top: pos.top, transformOrigin: `${pos.origin} center` } : { left: -9999, top: 0 }}
      className={`drop fixed z-[60] max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] overflow-y-auto outline-none ${className}`}
    >
      {children}
    </div>
  );
}
