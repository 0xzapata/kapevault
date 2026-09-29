import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "@phosphor-icons/react";
import { handFocusTo } from "@/lib/focus";

export type MenuItem =
  | "separator"
  | {
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      checked?: boolean;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    };

// Where the menu opens: under a trigger (dropdown) or at the pointer (right-click).
export type MenuAnchor = { rect: DOMRect; align?: "start" | "end" } | { x: number; y: number };

const GAP = 6;
const EDGE = 8;

// A native-feeling menu: arrow keys move, Enter picks, Escape or a click elsewhere closes, and it
// flips/shifts to stay inside the window at any size.
export function Menu({ anchor, items, onClose, label }: { anchor: MenuAnchor; items: MenuItem[]; onClose: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);
  const [active, setActive] = useState(-1);
  const choices = items.map((item, i) => ({ item, i })).filter((c): c is { item: Exclude<MenuItem, "separator">; i: number } => c.item !== "separator" && !c.item.disabled);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    let below = true;
    if ("rect" in anchor) {
      left = anchor.align === "end" ? anchor.rect.right - width : anchor.rect.left;
      top = anchor.rect.bottom + GAP;
      if (top + height > vh - EDGE && anchor.rect.top - GAP - height > EDGE) {
        top = anchor.rect.top - GAP - height;
        below = false;
      }
    } else {
      left = anchor.x;
      top = anchor.y;
      if (top + height > vh - EDGE) {
        top = Math.max(EDGE, anchor.y - height);
        below = false;
      }
    }
    left = Math.min(Math.max(EDGE, left), vw - width - EDGE);
    top = Math.min(Math.max(EDGE, top), vh - height - EDGE);
    setPos({ left, top, origin: below ? "top" : "bottom" });
  }, [anchor]);

  // Focus moves into the menu and goes back to whatever had it when the menu closes - unless an item
  // was picked: that item may open a sheet whose autoFocus field must keep the focus. That sheet, when
  // it closes, hands the focus to the same element (the menu is long gone by then).
  const restoreFocus = useRef(true);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (ref.current) handFocusTo(ref.current, previous);
    ref.current?.focus();
    return () => {
      if (restoreFocus.current) previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    const onBlur = () => onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
    };
  }, [onClose]);

  function pick(item: Exclude<MenuItem, "separator">) {
    restoreFocus.current = false;
    onClose();
    item.onSelect();
  }

  function onKey(e: ReactKeyboardEvent) {
    e.stopPropagation();
    const at = choices.findIndex((c) => c.i === active);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(choices[(at + 1) % choices.length]?.i ?? -1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(choices[(at - 1 + choices.length) % choices.length]?.i ?? -1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const chosen = choices[at];
      if (chosen) pick(chosen.item);
    }
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
      style={pos ? { left: pos.left, top: pos.top, transformOrigin: `${pos.origin} center` } : { left: -9999, top: 0 }}
      className="menu fixed z-[60] min-w-[200px] max-w-[min(320px,calc(100vw-16px))] rounded-[12px] border border-line bg-raised p-1 shadow-sheet outline-none"
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={`sep-${i}`} role="separator" className="mx-2 my-1 h-px bg-line" />
        ) : (
          <button
            key={item.label}
            role="menuitem"
            type="button"
            disabled={item.disabled}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(-1)}
            onClick={() => pick(item)}
            className={`flex h-8 w-full items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] disabled:opacity-40 ${
              active === i ? (item.danger ? "bg-danger text-on-accent" : "bg-accent text-on-accent") : item.danger ? "text-danger" : "text-ink"
            }`}
          >
            <span className="grid size-4 shrink-0 place-items-center">{item.checked ? <Check size={13} weight="bold" /> : item.icon}</span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && <span className={`shrink-0 text-[11.5px] ${active === i ? "text-on-accent-2" : "text-ink-3"}`}>{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

// Open/close state for one menu. anchorFrom turns a click event into the right anchor.
export function useMenu() {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const close = useCallback(() => setAnchor(null), []); // stable, so an open menu does not re-run its effects
  return {
    anchor,
    openAt: (e: ReactMouseEvent) => {
      e.preventDefault();
      setAnchor({ x: e.clientX, y: e.clientY });
    },
    openUnder: (el: HTMLElement, align: "start" | "end" = "start") => setAnchor({ rect: el.getBoundingClientRect(), align }),
    close,
  };
}
