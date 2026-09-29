import { Check, WarningCircle } from "@phosphor-icons/react";
import { keys } from "@/lib/platform";
import type { QuickAction, QuickActionId } from "../lib/quick-actions";

const KEYS: Record<QuickActionId, string> = {
  primary: keys("Enter"),
  secondary: keys("shift", "Enter"),
  totp: keys("mod", "Enter"),
  open: keys("mod", "O"),
  show: keys("alt", "Enter"),
};

export interface Feedback {
  id: number;
  tone: "ok" | "error";
  text: string;
}

interface QuickFooterProps {
  hints: QuickAction[]; // priority order
  feedback: Feedback | null;
}

// 36px bar: what the keys do for the selected item, or the confirmation after an action.
// Hints wrap onto a second line that the fixed height clips, so the lowest-priority ones drop
// out first when space runs short - never half a hint.
export function QuickFooter({ hints, feedback }: QuickFooterProps) {
  return (
    <footer className="h-9 shrink-0 border-t border-line px-4 text-[12px]">
      <span aria-live="polite" className="sr-only">{feedback?.text ?? ""}</span>
      {feedback ? (
        <p
          key={feedback.id}
          className={`swap-in flex h-full items-center gap-1.5 font-medium ${feedback.tone === "ok" ? "text-ok" : "text-danger"}`}
        >
          {feedback.tone === "ok" ? <Check size={13} weight="bold" /> : <WarningCircle size={13} weight="bold" />}
          <span className="truncate">{feedback.text}</span>
        </p>
      ) : (
        <ul aria-label="Keyboard shortcuts" className="flex h-full flex-wrap content-start items-center gap-x-4 overflow-hidden">
          {hints.map((h) => (
            <li key={h.id} className="flex h-full shrink-0 items-center gap-1.5 whitespace-nowrap">
              <span className="font-semibold text-ink-2">{KEYS[h.id]}</span>
              <span className="text-ink-3">{h.label}</span>
            </li>
          ))}
        </ul>
      )}
    </footer>
  );
}
