import { useEffect, useState } from "react";
import { vaultApi } from "@/lib/vault-api";

// Literal class names so Tailwind generates them; index = score 0-4.
const FILL = ["bg-meter-0", "bg-meter-1", "bg-meter-2", "bg-meter-3", "bg-meter-4"];

// Five segments and a label. The rating comes from main, so this meter and the Security view
// always agree. Segments grow with scaleX only.
export function StrengthMeter({ password, className = "" }: { password: string; className?: string }) {
  const [rating, setRating] = useState<{ score: number; label: string } | null>(null);

  useEffect(() => {
    if (!password) return;
    let live = true;
    const timer = setTimeout(() => {
      vaultApi
        .ratePassword(password)
        .then((r) => live && setRating(r))
        .catch(() => {});
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [password]);

  if (!password) return null;
  const score = rating?.score ?? -1;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div aria-hidden="true" className="grid flex-1 grid-cols-5 gap-1">
        {FILL.map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: five fixed segments, never reordered
          <span key={i} className="h-1 overflow-hidden rounded-full bg-field">
            <span
              className={`block h-full origin-left rounded-full transition-transform duration-200 ease-out ${FILL[Math.max(score, 0)]} ${i <= score ? "scale-x-100" : "scale-x-0"}`}
            />
          </span>
        ))}
      </div>
      <span aria-live="polite" className="w-[84px] shrink-0 text-right text-[12px] font-medium text-ink-2">
        <span className="sr-only">Strength: </span>
        {rating?.label ?? ""}
      </span>
    </div>
  );
}
