import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackLayer } from "../hooks/use-back-layer";

const EXIT_MS = 180; // matches [data-closing] in app.css

// How every modal leaves: close() plays the exit, then calls onClose. Android's back closes it too.
export function useSheetExit(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const close = useCallback(() => {
    if (timer.current) return;
    setClosing(true);
    timer.current = setTimeout(onClose, EXIT_MS);
  }, [onClose]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useBackLayer(!closing, close);
  return { closing, close };
}

// The app behind a modal takes no taps, focus or screen reader while it is open.
let inertCount = 0;
function useInertApp() {
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    inertCount += 1;
    root.inert = true;
    return () => {
      inertCount -= 1;
      if (inertCount === 0) root.inert = false;
    };
  }, []);
}

interface SheetProps {
  title: string;
  onClose: () => void;
  tall?: boolean; // top to bottom (New item); otherwise centred on its content (Sync)
  hideTitle?: boolean; // the body draws its own heading row
  children: (close: () => void) => ReactNode;
  footer?: (close: () => void) => ReactNode;
}

// The PC Sheet at phone width: a white card over the dimmed app, 12 px in from the edges, entering with
// opacity + scale 0.96. A tall sheet ends above the keyboard (--kb), so its footer stays in reach.
export function Sheet({ title, onClose, tall = false, hideTitle = false, children, footer }: SheetProps) {
  const { closing, close } = useSheetExit(onClose);
  const dialog = useRef<HTMLDivElement>(null);
  useInertApp();
  useEffect(() => dialog.current?.focus(), []);

  const place = tall
    ? "top-[calc(var(--sat)+12px)] bottom-[calc(max(var(--kb),var(--sab))+12px)]"
    : "top-1/2 -translate-y-1/2 max-h-[calc(100dvh-var(--sat)-max(var(--kb),var(--sab))-24px)]";

  return createPortal(
    <div data-closing={closing || undefined}>
      <div className="pc-scrim fixed inset-0 z-40 bg-scrim" onClick={close} />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`pc-sheet fixed inset-x-3 z-50 ${place} flex flex-col overflow-hidden rounded-[20px] bg-raised shadow-sheet outline-none`}
      >
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-7 pb-5 pt-7">
          {!hideTitle && <h2 className="text-[20px] font-semibold tracking-[-0.02em]">{title}</h2>}
          {children(close)}
        </div>
        {footer && <div className="flex shrink-0 items-center gap-2 border-t border-line bg-raised px-7 py-4">{footer(close)}</div>}
      </div>
    </div>,
    document.body,
  );
}
