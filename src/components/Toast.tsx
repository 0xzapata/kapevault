import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, WarningCircle } from "@phosphor-icons/react";

interface ToastState {
  id: number;
  text: string;
  tone: "ok" | "error";
  action?: ToastAction;
}

// A button on the toast (Undo). It runs once, then the toast goes.
export interface ToastAction {
  label: string;
  run: () => void;
}

const ToastContext = createContext<(text: string, tone?: ToastState["tone"], action?: ToastAction) => void>(() => {});

// One toast at a time, bottom centre: a newer message replaces the older one instead of stacking.
// A longer message wraps to a second line and stays up long enough to read.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nextId = useRef(0);

  const show = useCallback((text: string, tone: ToastState["tone"] = "ok", action?: ToastAction) => {
    timers.current.forEach(clearTimeout);
    setLeaving(false);
    setToast({ id: ++nextId.current, text, tone, action });
    // A toast with a button stays up long enough to reach it.
    const hold = Math.max(action ? 6000 : tone === "error" ? 3600 : 2200, text.length * 50);
    timers.current = [setTimeout(() => setLeaving(true), hold), setTimeout(() => setToast(null), hold + 200)];
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // The live region sits on body, beside #root: a modal portaled to body (the photo viewer) makes all
  // of #root inert, and an inert live region is never read out.
  const region = (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4">
      {toast && (
        <div
          key={toast.id}
          role="status"
          data-leaving={leaving || undefined}
          className="toast flex max-w-full items-center gap-2 rounded-[19px] bg-toast px-4 py-2.5 text-[13px] font-medium text-on-accent shadow-sheet"
        >
          {toast.tone === "ok" ? <Check size={15} weight="bold" className="shrink-0 text-ok-on-dark" /> : <WarningCircle size={15} weight="bold" className="shrink-0 text-danger-on-dark" />}
          <span className="line-clamp-2">{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                timers.current.forEach(clearTimeout);
                setToast(null);
                toast.action?.run();
              }}
              className="press pointer-events-auto -mr-1.5 shrink-0 rounded-full px-2.5 py-0.5 font-semibold underline underline-offset-2 focus-ring"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      {createPortal(region, document.body)}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
