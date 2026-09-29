import { useRef, type PointerEvent, type RefObject } from "react";
import { FLICK, project, reducedMotion, rubberband } from "../lib/spring";

interface Drag {
  id: number;
  x0: number;
  y0: number;
  last: number;
  t: number;
  v: number; // px/ms along x
  armed: boolean;
}

// Drag a horizontal panel 1:1 toward its dismiss side (-1 = left). After 10 px of hysteresis a
// mostly-vertical move is left to the scroller. On release a clear flick decides by its sign; a slow
// release by where Apple's projection says it would land. Past the open edge it rubber-bands.
export function useDragDismiss(panel: RefObject<HTMLElement | null>, scrim: RefObject<HTMLElement | null>, side: -1 | 1, onDismiss: () => void) {
  const drag = useRef<Drag | null>(null);

  const place = (x: number) => {
    const el = panel.current;
    if (!el) return;
    el.style.transform = `translateX(${x}px)`;
    if (scrim.current) scrim.current.style.opacity = String(Math.max(0, 1 - Math.abs(x) / el.offsetWidth));
  };
  const release = () => {
    panel.current?.classList.remove("dragging");
    scrim.current?.classList.remove("dragging");
    if (panel.current) panel.current.style.transform = "";
    if (scrim.current) scrim.current.style.opacity = "";
  };

  function onPointerDown(e: PointerEvent) {
    if (e.button > 0 || reducedMotion() || (e.target as HTMLElement).closest("input, textarea")) return;
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, last: e.clientX, t: e.timeStamp, v: 0, armed: false };
  }

  function onPointerMove(e: PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    if (!d.armed) {
      if (Math.abs(dx) < 10 && Math.abs(e.clientY - d.y0) < 10) return;
      if (Math.abs(e.clientY - d.y0) > Math.abs(dx)) {
        drag.current = null; // a scroll: not ours
        return;
      }
      d.armed = true;
      panel.current?.classList.add("dragging");
      scrim.current?.classList.add("dragging");
      panel.current?.setPointerCapture(e.pointerId);
    }
    d.v = (e.clientX - d.last) / Math.max(1, e.timeStamp - d.t);
    d.last = e.clientX;
    d.t = e.timeStamp;
    const toward = dx * side >= 0; // moving toward the dismiss side
    place(toward ? dx : -rubberband(-dx * side, 300) * side);
  }

  function onPointerUp(e: PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.armed || e.pointerId !== d.id) return;
    const el = panel.current;
    const pos = e.clientX - d.x0;
    const dismiss = Math.abs(d.v) > 0.3 ? Math.sign(d.v) === side : (pos + project(d.v)) * side > (el?.offsetWidth ?? 0) / 2;
    if (dismiss && el) {
      // The flick carried momentum: a touch of bounce, only here.
      el.style.transition = `transform ${FLICK.ms}ms ${FLICK.ease}, visibility 0s linear ${FLICK.ms}ms`;
      setTimeout(() => (el.style.transition = ""), FLICK.ms);
      onDismiss();
    }
    release(); // the CSS transition runs from the dragged spot to open or closed
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}
