import { useRef, useState } from "react";
import { flushSync } from "react-dom";

const COLLAPSED_KEY = "kapevault.sidebarCollapsed";
const SLIDE_MS = 280;

// A per-viewer convenience, so storage failing (private profile) just means an open sidebar.
function savedCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

const ease = () => getComputedStyle(document.documentElement).getPropertyValue("--ease-out").trim() || "ease-out";

const cancelSlides = (el: Element) => el.getAnimations().forEach((a) => a.cancel());

// A slide that ends off its resting place (the sidebar leaving) holds its last frame: without that
// it snapped back to x=0, a full sidebar flashing until React removed it.
function slide(el: Element, fromX: number, toX = 0) {
  cancelSlides(el);
  const fill = toX === 0 ? "none" : "forwards";
  return el.animate([{ transform: `translateX(${fromX}px)` }, { transform: `translateX(${toX}px)` }], { duration: SLIDE_MS, easing: ease(), fill });
}

// Collapsing the inline sidebar. The panes take their new layout in one frame, then slide from
// where they were on screen (FLIP), so only transform moves - never width. Measuring the live
// rects means a second toggle mid-slide reverses from wherever things are.
export function useSidebarCollapse() {
  const [collapsed, setCollapsed] = useState(savedCollapsed);
  const [leaving, setLeaving] = useState(false); // the sidebar, drawn over the panes while it slides out
  const generation = useRef(0); // a finished slide from an earlier toggle must not end a newer one

  function toggle() {
    const next = !collapsed;
    const gen = ++generation.current;
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // not remembered this time
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCollapsed(next);
      return;
    }

    const aside = document.querySelector("[data-sidebar-slide]");
    const asideLeft = aside?.getBoundingClientRect().left ?? 0;
    const panes = Array.from(document.querySelectorAll("[data-flip]"));
    const before = panes.map((el) => el.getBoundingClientRect().left);

    flushSync(() => {
      setCollapsed(next);
      setLeaving(next);
    });

    // Measure the new layout without the old slide's transform still applied.
    panes.forEach(cancelSlides);
    panes.forEach((el, i) => {
      const dx = before[i] - el.getBoundingClientRect().left;
      if (dx) slide(el, dx);
    });

    const now = document.querySelector("[data-sidebar-slide]");
    if (!now) return;
    const width = now.getBoundingClientRect().width;
    if (next) {
      slide(now, asideLeft, -width).onfinish = () => {
        if (generation.current === gen) setLeaving(false);
      };
    } else slide(now, aside ? asideLeft : -width);
  }

  return { collapsed, leaving, toggle };
}
