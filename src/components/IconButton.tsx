import type { ReactNode } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import { useCopyAction } from "@/hooks/use-copy-action";

export function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="press grid size-8 place-items-center rounded-full text-ink-3 transition-colors hover:bg-accent-soft hover:text-accent disabled:pointer-events-none disabled:opacity-40 focus-ring"
    >
      {children}
    </button>
  );
}

export function CopyButton({ label = "Copy", copy, toastText }: { label?: string; copy: () => Promise<unknown>; toastText: string }) {
  const { copied, run } = useCopyAction();
  return (
    <IconButton label={copied ? "Copied" : label} onClick={() => run(copy, toastText)}>
      {copied ? <Check size={16} weight="bold" className="swap-in text-ok" /> : <Copy size={16} />}
    </IconButton>
  );
}
