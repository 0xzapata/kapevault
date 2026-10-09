import type { ReactNode } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { cardPrimary, cardQuiet } from "../../components/buttons";
import { useHost } from "../../host/host-context";
import { clockTime } from "../../lib/format";
import { isSerious, linkOf } from "../../lib/entries";
import { issueAdvice, issueLabel, worstIssue } from "../../lib/issues";
import { useMoveToTrash } from "../trash/use-move-to-trash";
import type { ConflictCopy, Entry } from "../../host/types";

type Tone = "danger" | "warn" | "ok";
const TONE: Record<Tone, { box: string; ink: string }> = {
  danger: { box: "bg-danger-soft", ink: "text-danger" },
  warn: { box: "bg-warn-soft", ink: "text-warn" },
  ok: { box: "bg-ok-soft", ink: "text-ok" },
};

// A tinted card above the rows: what is wrong or worth knowing, and the next step.
function Banner({ tone, icon, title, children, actions }: { tone: Tone; icon?: ReactNode; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section aria-label={title} className={`mb-5 flex gap-3 rounded-2xl p-4 ${TONE[tone].box}`}>
      <span className={`mt-px shrink-0 ${TONE[tone].ink}`}>{icon ?? <WarningCircle size={20} weight="fill" />}</span>
      <div className="min-w-0 flex-1">
        <h2 className={`text-[14px] font-semibold ${TONE[tone].ink}`}>{title}</h2>
        <div className="mt-1 text-[13px] leading-relaxed text-ink-2">{children}</div>
        {actions && <div className="-ml-1 mt-3 flex flex-wrap items-center gap-1">{actions}</div>}
      </div>
    </section>
  );
}

// The item's worst health issue: red when exposed or already expired, amber otherwise.
export function IssueBanner({ entry, onEdit }: { entry: Entry; onEdit: () => void }) {
  const host = useHost();
  if (entry.issues.length === 0) return null;
  const worst = worstIssue(entry.issues);
  const others = entry.issues.filter((i) => i !== worst);
  const url = entry.kind === "login" || entry.kind === "key" ? linkOf(entry) : "";
  const isKey = entry.kind === "key";
  const codes = worst.type === "codes";
  return (
    <Banner
      tone={isSerious(worst) ? "danger" : "warn"}
      title={issueLabel(worst)}
      actions={
        <>
          {url && (
            <button type="button" onClick={() => void host.openEntry(entry.id)} className={`${cardPrimary} mr-1`}>
              {codes ? "Make new codes on website" : isKey ? "Renew on website" : "Change on website"}
            </button>
          )}
          {!codes && (
            <button type="button" onClick={onEdit} className={url ? cardQuiet : cardPrimary}>
              {isKey ? "Update key" : entry.kind === "thing" ? "Update date" : "Update password"}
            </button>
          )}
        </>
      }
    >
      <p>{issueAdvice(worst, entry.kind)}</p>
      {others.length > 0 && <p className="mt-1 text-[12.5px] text-ink-3">Also: {others.map(issueLabel).join(" · ")}</p>}
    </Banner>
  );
}

// A copy sync made because both devices changed the item.
export function ConflictBanner({ conflict, onOpen, onDeleted }: { conflict: ConflictCopy; onOpen: (id: string) => void; onDeleted: () => void }) {
  const moveToTrash = useMoveToTrash();
  const { originalId } = conflict;
  async function remove() {
    if (await moveToTrash(conflict.id)) onDeleted();
  }
  return (
    <Banner
      tone="warn"
      title="Changed on both devices"
      actions={
        <>
          {originalId && (
            <button type="button" onClick={() => onOpen(originalId)} className={`${cardPrimary} mr-1`}>
              Open the other one
            </button>
          )}
          <button type="button" onClick={remove} className={conflict.originalId ? cardQuiet : cardPrimary}>
            Move this copy to Trash
          </button>
        </>
      }
    >
      This copy is the {conflict.device} version from {clockTime(conflict.at)}. Compare it with the other one, keep what you need, then move this copy to the Trash.
    </Banner>
  );
}
