import { useEffect } from "react";

// How much of the layout viewport the keyboard covers, as --kb on <html>. Android resizes the window
// for the keyboard (0 then); where it overlays instead, visualViewport shrinks and a sheet rides above.
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement.style;
    const update = () => root.setProperty("--kb", `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
}
