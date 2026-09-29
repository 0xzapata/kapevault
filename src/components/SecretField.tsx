import type { ReactNode } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { useReveal } from "@/hooks/use-reveal";
import { Field } from "./Card";
import { CopyButton, IconButton } from "./IconButton";

interface SecretFieldProps {
  label: ReactNode;
  reveal: () => Promise<string>;
  copy: () => Promise<unknown>;
  copyLabel: string;
  copiedToast: string;
  revealLabel?: string;
  hideLabel?: string;
}

// A stored secret: masked until revealed, fetched from main only when asked for.
export function SecretField({ label, reveal, copy, copyLabel, copiedToast, revealLabel = "Reveal", hideLabel = "Hide" }: SecretFieldProps) {
  const { value, toggle } = useReveal(reveal);

  return (
    <Field
      label={label}
      actions={
        <>
          <IconButton label={value === null ? revealLabel : hideLabel} onClick={toggle}>
            {value === null ? <Eye size={16} /> : <EyeSlash size={16} />}
          </IconButton>
          <CopyButton label={copyLabel} copy={copy} toastText={copiedToast} />
        </>
      }
    >
      <span className="font-mono tracking-wide">{value ?? "•".repeat(14)}</span>
    </Field>
  );
}
