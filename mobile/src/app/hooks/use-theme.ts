import { useEffect, useRef } from "react";
import { reducedMotion } from "../lib/spring";
import { setSystemBarIcons } from "../lib/system-bars";
import type { ThemeChoice } from "../host/types";

// Settings > Theme on <html>, and the system bar icons to match. System follows the phone's dark mode live.
// A change after the first cross-fades (a view transition, app.css) instead of recolouring in one frame.
export function useTheme(choice: ThemeChoice) {
  const first = useRef(true);
  useEffect(() => {
    const dark = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = choice === "system" ? (dark.matches ? "dark" : "classic") : choice;
      document.documentElement.dataset.theme = theme;
      setSystemBarIcons(theme === "dark");
    };
    // An older WebView has no view transitions: it recolours at once.
    const fade = () => ("startViewTransition" in document && !reducedMotion() ? void document.startViewTransition(apply) : apply());
    if (first.current) apply();
    else fade();
    first.current = false;
    dark.addEventListener("change", fade);
    return () => dark.removeEventListener("change", fade);
  }, [choice]);
}
