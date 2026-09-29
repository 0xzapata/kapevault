import { useEffect, useRef, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { textLink } from "@/components/buttons";

interface MoreOptionsProps {
  open: boolean; // the caller opens it for a value already there, so nothing saved is ever hidden
  onOpen: () => void;
  label?: string;
  className?: string;
  children: ReactNode;
}

// Optional fields folded under one quiet button. Opening them by hand moves focus to the first field
// (or, with no field, the first button): the button is gone by then, and focus would otherwise drop to the page.
export function MoreOptions({ open, onOpen, label = "More options", className = "", children }: MoreOptionsProps) {
  const box = useRef<HTMLDivElement>(null);
  const clicked = useRef(false);

  useEffect(() => {
    if (!open || !clicked.current || !box.current) return;
    (box.current.querySelector<HTMLElement>("input, select, textarea") ?? box.current.querySelector<HTMLElement>("button"))?.focus();
  }, [open]);

  if (open) {
    return (
      <div ref={box} className={`settle ${className}`}>
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-expanded="false"
      onClick={() => {
        clicked.current = true;
        onOpen();
      }}
      className={`${textLink} text-accent`}
    >
      {label}
      <CaretDown size={12} weight="bold" />
    </button>
  );
}
