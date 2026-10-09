import { WarningCircle } from "@phosphor-icons/react";
import { cardPrimary, cardQuiet } from "@/components/buttons";
import { issueAdvice, issueLabel, worstIssue } from "../lib/issues";
import type { Entry, Issue } from "../types";

interface IssueBannerProps {
  entry: Entry;
  onOpen: (location: string) => void;
  onEdit: () => void;
  onReplaceCodes: () => void; // opens the Backup codes card ready for a new set
}

// Serious (the password is exposed, or the key already stopped working) reads red; the rest amber.
const SERIOUS: Issue["type"][] = ["reused", "weak", "expired"];

// The item's worst health issue with what to do about it, above the main card.
export function IssueBanner({ entry, onOpen, onEdit, onReplaceCodes }: IssueBannerProps) {
  if (entry.issues.length === 0) return null;

  const worst = worstIssue(entry.issues);
  const others = entry.issues.filter((i) => i !== worst);
  const serious = SERIOUS.includes(worst.type) || (worst.type === "codes" && worst.left === 0);
  const codes = worst.type === "codes";
  const url = entry.kind === "login" || entry.kind === "key" ? entry.url : "";
  const isKey = entry.kind === "key";
  const fixLabel = isKey ? "Update key" : entry.kind === "thing" ? "Update date" : "Update password";
  const fix = url ? cardQuiet : cardPrimary; // one filled next step: the website first, when there is one

  return (
    <section aria-label="Security issue" className={`mb-5 flex gap-3 rounded-2xl px-4 py-4 @md:px-5 ${serious ? "bg-danger-soft" : "bg-warn-soft"}`}>
      <WarningCircle size={20} weight="fill" className={`mt-px shrink-0 ${serious ? "text-danger" : "text-warn"}`} />
      <div className="min-w-0 flex-1">
        <h2 className={`text-[14px] font-semibold ${serious ? "text-danger" : "text-warn"}`}>{issueLabel(worst)}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{issueAdvice(worst, entry.kind)}</p>
        {others.length > 0 && <p className="mt-1 text-[12.5px] text-ink-3">Also: {others.map(issueLabel).join(" · ")}</p>}
        <div className="-ml-1 mt-3 flex flex-wrap items-center gap-1">
          {url && (
            <button type="button" onClick={() => onOpen(url)} className={`${cardPrimary} mr-1`}>
              {codes ? "Make new codes on website" : isKey ? "Renew on website" : "Change on website"}
            </button>
          )}
          {codes ? (
            <button type="button" onClick={onReplaceCodes} className={fix}>
              Replace codes
            </button>
          ) : (
            <button type="button" onClick={onEdit} className={fix}>
              {fixLabel}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
