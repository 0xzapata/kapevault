import { useCallback, useEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { hasInnerStops, returnFocus, tabStops } from "@/lib/focus";

const EXIT_MS = 180; // matches [data-closing] in index.css

interface SheetProps {
  title: string;
  onClose: () => void;
  // Children get close() so their own Cancel/Save buttons leave through the same exit animation.
  children: ReactNode | ((close: () => void) => ReactNode);
  width?: string;
  bare?: boolean; // no padding/title - the content draws its own header (file preview)
}

// How every modal leaves: close() plays the exit (data-closing), then calls onClose. Escape closes.
export function useSheetExit(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const close = useCallback(() => {
    if (timer.current) return;
    setClosing(true);
    timer.current = setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return { closing, close };
}

// Tab and Shift+Tab go round inside the dialog (a dialog with no controls, the shortcut list, keeps
// the focus itself). A control that already handled Tab (the password generator's popover) wins. A
// video or a frame at either end is left to native Tab, which walks its own controls first.
function keepTab(e: ReactKeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab" || e.defaultPrevented) return;
  const dialog = e.currentTarget;
  const stops = tabStops(dialog);
  const first = stops[0] ?? dialog;
  const last = stops[stops.length - 1] ?? dialog;
  const active = document.activeElement;
  if (e.shiftKey ? active !== first && active !== dialog : active !== last) return;
  if (hasInnerStops(active)) return;
  e.preventDefault();
  (e.shiftKey ? last : first).focus();
}

// Modal elements made inert, with how many open modals want each one inert: a sheet opened while the
// last one is still leaving (Settings -> Shortcuts) must not wake the app when the older one unmounts.
const inertBy = new Map<HTMLElement, number>();

// Everything beside the dialog, up to <body>, stops taking clicks, focus and screen readers - including
// what mounts there while it is open (the inline sidebar when the window widens past 900px). Live
// regions stay, so a toast from inside the dialog is still read out, and so does a layer that opens on
// top (a sheet over this one, a menu): it takes over. Returns the undo.
function inertAround(dialog: HTMLElement) {
  const made: HTMLElement[] = [];
  const path = new Set<Element>();
  const parents: HTMLElement[] = [];
  for (let el: HTMLElement = dialog; el.parentElement && el !== document.body; el = el.parentElement) {
    path.add(el);
    parents.push(el.parentElement);
  }
  function quiet(sibling: Node, later: boolean) {
    if (path.has(sibling as Element) || !(sibling instanceof HTMLElement) || sibling.matches("[aria-live], script")) return;
    if (sibling.inert && !inertBy.has(sibling)) return; // inert on its own (the sidebar sliding out)
    if (later && sibling.matches(':is([aria-modal="true"], [role="menu"]), :has([aria-modal="true"], [role="menu"])')) return;
    sibling.inert = true;
    inertBy.set(sibling, (inertBy.get(sibling) ?? 0) + 1);
    made.push(sibling);
  }
  for (const parent of parents) for (const sibling of parent.children) quiet(sibling, false);
  const watcher = new MutationObserver((changes) => changes.forEach((c) => c.addedNodes.forEach((node) => quiet(node, true))));
  for (const parent of parents) watcher.observe(parent, { childList: true });
  return () => {
    watcher.disconnect();
    for (const el of made) {
      const left = (inertBy.get(el) ?? 1) - 1;
      if (left > 0) inertBy.set(el, left);
      else {
        inertBy.delete(el);
        el.inert = false;
      }
    }
  };
}

// A dialog's focus, for Sheet and the full-window views (Evacuate, Hotline mode): it moves in on open
// (an autoFocus control keeps it, else the first control, else the dialog), stays inside while Tab
// goes round, and goes back on close (returnFocus: the opener, or what stands in for it once the opener
// is gone) - unless another dialog has it by then. The app
// behind is inert meanwhile. Spread the result on the role="dialog" element, with tabIndex={-1}.
export function useModal() {
  const ref = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => document.activeElement as HTMLElement | null); // read before autoFocus moves it

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.contains(document.activeElement)) (tabStops(dialog)[0] ?? dialog).focus();
    const wake = inertAround(dialog);
    return () => {
      wake();
      // Closed, the dialog is gone and focus fell to <body>; a dialog that took over keeps it.
      if (document.activeElement === document.body || document.activeElement === null) returnFocus(opener);
    };
  }, [opener]);

  // Native Tab off the end of a video's controls or out of a frame leaves the page (the focus lands on
  // <body>): it comes back round to the other end of the dialog, the way Tab was going.
  const backwards = useRef(false);
  function onKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key === "Tab") backwards.current = e.shiftKey;
    keepTab(e);
  }
  function onBlur(e: ReactFocusEvent<HTMLElement>) {
    if (e.relatedTarget || !hasInnerStops(e.target)) return;
    const dialog = e.currentTarget;
    setTimeout(() => {
      if (!dialog.isConnected || (document.activeElement !== document.body && document.activeElement !== null)) return;
      const stops = tabStops(dialog);
      (backwards.current ? stops[stops.length - 1] : stops[0])?.focus();
    });
  }

  return { ref, onKeyDown, onBlur };
}

// Modal task: dim the app behind; Escape or a scrim click closes it. Never wider or taller than
// the window, so it still fits when the window is dragged small. It stays below the 52px title
// strip: the OS draws its window buttons (or traffic lights) there, on top of any page content.
export function Sheet({ title, onClose, children, width = "w-[540px]", bare = false }: SheetProps) {
  const { closing, close } = useSheetExit(onClose);
  const modal = useModal();
  const body = typeof children === "function" ? children(close) : children;

  return (
    <div
      data-closing={closing || undefined}
      className="scrim fixed inset-0 z-50 grid place-items-center bg-scrim px-3 pb-3 pt-[52px]"
      onMouseDown={close}
    >
      <div
        {...modal}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className={`sheet ${width} max-h-[min(840px,calc(100dvh-64px))] max-w-[calc(100vw-24px)] rounded-[20px] bg-raised shadow-sheet outline-none ${bare ? "overflow-hidden" : "overflow-y-auto p-7"}`}
      >
        {bare ? (
          body
        ) : (
          <>
            <h2 className="text-[20px] font-semibold tracking-[-0.02em]">{title}</h2>
            <div className="mt-5">{body}</div>
          </>
        )}
      </div>
    </div>
  );
}
