import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";

type Tone = "ok" | "error";
// A button in the toast (Undo): it runs once, then the toast leaves.
export interface ToastAction {
  label: string;
  run: () => void;
}
interface ToastState {
  id: number;
  text: string;
  tone: Tone;
  lift: number;
  action?: ToastAction;
}

const ToastContext = createContext<(text: string, tone?: Tone, action?: ToastAction) => void>(() => {});
const ACTION_HOLD_MS = 5000; // long enough to read the message and reach for Undo

// Bottom chrome on screen (tab bar, action dock), so the toast rises above it.
function chromeHeight() {
  const seen = (el: HTMLElement) => (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : el.offsetParent !== null);
  return [...document.querySelectorAll<HTMLElement>("[data-bottom-chrome]")].filter(seen).reduce((h, el) => Math.max(h, el.offsetHeight), 0);
}

// The PC's ink pill, one at a time: a newer message replaces the older one.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((after: number) => {
    timers.current.forEach(clearTimeout);
    timers.current = [setTimeout(() => setLeaving(true), after), setTimeout(() => setToast(null), after + 200)];
  }, []);

  const show = useCallback(
    (text: string, tone: Tone = "ok", action?: ToastAction) => {
      setLeaving(false);
      setToast({ id: ++nextId.current, text, tone, lift: chromeHeight(), action });
      dismiss(Math.max(tone === "error" ? 3600 : 1900, text.length * 50, action ? ACTION_HOLD_MS : 0));
    },
    [dismiss],
  );

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const region = (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 z-[75] flex justify-center px-4" style={{ bottom: toast?.lift ? `${toast.lift + 12}px` : "calc(var(--sab) + 20px)" }}>
      {toast && (
        <div key={toast.id} role="status" data-leaving={leaving || undefined} className="toast flex max-w-[330px] items-center gap-2 rounded-full bg-toast px-4 py-2.5 text-[13.5px] font-medium text-on-accent shadow-sheet">
          {toast.tone === "ok" ? <CheckCircle size={17} weight="fill" className="shrink-0 text-ok-on-dark" /> : <WarningCircle size={17} weight="fill" className="shrink-0 text-danger-on-dark" />}
          <span className="line-clamp-2">{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              disabled={leaving}
              onClick={() => {
                toast.action?.run();
                dismiss(0);
              }}
              className="press hit pointer-events-auto -mr-2 ml-1 h-8 shrink-0 rounded-full px-3 text-[13.5px] font-semibold text-on-accent underline underline-offset-4 focus-ring"
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

// Runs a copy, shows the tick for a moment, confirms with a toast.
export function useCopyAction() {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  async function run(copy: () => Promise<unknown>, message: string) {
    try {
      await copy();
    } catch {
      toast("Could not copy", "error");
      return;
    }
    setCopied(true);
    toast(message);
  }
  return { copied, run };
}
