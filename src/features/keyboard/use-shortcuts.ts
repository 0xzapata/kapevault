import { useEffect, useRef } from "react";
import { modPressed } from "@/lib/platform";

export interface ShortcutHandlers {
  focusSearch: () => void;
  clearSearch: () => boolean; // true when there was a query to clear
  back: () => boolean; // true when it went back (compact detail)
  step: (delta: number) => void;
  primary: () => void;
  copyUsername: () => void;
  copySecret: () => void;
  copyCode: () => void;
  open: () => void;
  create: () => void;
  edit: () => void;
  favorite: () => void;
  lock: () => void;
  settings: () => void;
  help: () => void;
  toggleSidebar: () => void;
}

const isTyping = (el: Element | null) => !!el && (el.matches("input, textarea, select, [contenteditable=true]") || el.closest("[contenteditable=true]") !== null);
const inSearch = (el: Element | null) => !!el && el.matches("[data-search]");
const inList = (el: Element | null) => !!el && el.matches("[data-entry-list]");
const overlayOpen = () => document.querySelector("[role=dialog], [role=menu]") !== null;

// The vault window's keyboard map (see ShortcutsSheet for the user-facing list). Shortcuts stay out
// of the way while a sheet or menu is open, and never steal keys from a text field except in search.
export function useShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || overlayOpen()) return;
      const h = ref.current;
      const active = document.activeElement;
      const typing = isTyping(active);
      const search = inSearch(active);
      const mod = modPressed(e);
      // Letters by physical key: on a Mac, Option turns C into a different character in e.key.
      const key = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };

      if (mod && !e.altKey && key === "k") return run(h.focusSearch);
      if (!typing && !mod && e.key === "/") return run(h.focusSearch);

      if (e.key === "Escape") {
        if (search && h.clearSearch()) return run(() => {});
        if (!typing && h.back()) return run(() => {});
        if (search) return run(() => (active as HTMLElement).blur());
        return;
      }

      // Arrow keys and Enter work from the search box and the list, the two places you start from.
      const navigable = search || inList(active) || !typing;
      if (navigable && !mod && !e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        if (!search && !inList(active) && active && active !== document.body) return; // a focused button keeps its own keys
        return run(() => h.step(e.key === "ArrowDown" ? 1 : -1));
      }
      if (e.key === "Enter" && !mod && !e.altKey && !e.shiftKey && (search || inList(active) || active === document.body)) return run(h.primary);

      if (!mod) return;
      if (key === "c" && e.altKey) return run(h.copyCode);
      if (key === "c" && e.shiftKey) return run(h.copySecret);
      if (key === "c" && !typing && !window.getSelection()?.toString()) return run(h.copyUsername);
      if (e.altKey || e.shiftKey) return;
      if (key === "o") return run(h.open);
      if (key === "n") return run(h.create);
      if (key === "e" && !typing) return run(h.edit);
      if (key === "d" && !typing) return run(h.favorite);
      if (key === "l") return run(h.lock);
      if (e.key === ",") return run(h.settings);
      if (e.key === "/") return run(h.help);
      if (e.code === "Backslash" && !e.repeat) return run(h.toggleSidebar);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
