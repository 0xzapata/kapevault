import { useEffect, useRef } from "react";
import type { LockGrace } from "../host/types";

// The vault locks when the app has been off the screen for the grace period (At once / 30 s
// / 1 minute). The shell fires kapevault:background on pause; timers may not run in a paused WebView,
// so coming back past the grace locks too (visibilitychange, or kapevault:resume once the shell has it).
export function useLockOnLeave(active: boolean, grace: LockGrace, lock: () => void) {
  const leftAt = useRef<number | null>(null);
  const latest = useRef(lock);
  latest.current = lock;

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function left() {
      if (leftAt.current !== null) return;
      leftAt.current = Date.now();
      if (grace === 0) latest.current();
      else timer = setTimeout(() => latest.current(), grace * 1000);
    }
    function back() {
      clearTimeout(timer);
      const at = leftAt.current;
      leftAt.current = null;
      if (at !== null && Date.now() - at >= grace * 1000) latest.current();
    }
    const onVisibility = () => (document.visibilityState === "hidden" ? left() : back());

    window.addEventListener("kapevault:background", left);
    window.addEventListener("kapevault:resume", back);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      leftAt.current = null;
      window.removeEventListener("kapevault:background", left);
      window.removeEventListener("kapevault:resume", back);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, grace]);
}
