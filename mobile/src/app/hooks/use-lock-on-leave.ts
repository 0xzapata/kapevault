import { useEffect, useRef, useState } from "react";
import type { LockGrace } from "../host/types";

// The clock behind the hook, apart from React so a test can drive it. left(): the app went off the
// screen. back(): it is in front again. setCovered(true) goes out first thing on leaving, so the vault
// is hidden before Android freezes the page; setCovered(false) once back inside the grace period.
export function createLockOnLeave(grace: number, lock: () => void, setCovered: (covered: boolean) => void) {
  let leftAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    left() {
      if (leftAt !== null) return;
      leftAt = Date.now();
      setCovered(true);
      if (grace === 0) lock();
      else timer = setTimeout(lock, grace * 1000);
    },
    // Timers may not run in a paused or cached WebView, so the time away is checked on the way back.
    back() {
      clearTimeout(timer);
      const at = leftAt;
      leftAt = null;
      if (at === null) return;
      setCovered(false);
      if (Date.now() - at >= grace * 1000) lock();
    },
    stop() {
      clearTimeout(timer);
      leftAt = null;
    },
  };
}

// The vault locks when the app has been off the screen for the grace period (At once / 30 s
// / 1 minute). The shell fires kapevault:background on pause; coming back past the grace locks too
// (visibilitychange, or kapevault:resume once the shell has it). Returns true while the app is away:
// the caller covers the vault with it (not a lock, just no last frame of the list or a revealed
// password on the way back in).
export function useLockOnLeave(active: boolean, grace: LockGrace, lock: () => void) {
  const [covered, setCovered] = useState(false);
  const latest = useRef(lock);
  latest.current = lock;

  useEffect(() => {
    if (!active) return;
    const leave = createLockOnLeave(grace, () => latest.current(), setCovered);
    const onVisibility = () => (document.visibilityState === "hidden" ? leave.left() : leave.back());

    window.addEventListener("kapevault:background", leave.left);
    window.addEventListener("kapevault:resume", leave.back);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      leave.stop();
      setCovered(false);
      window.removeEventListener("kapevault:background", leave.left);
      window.removeEventListener("kapevault:resume", leave.back);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, grace]);

  return covered;
}
