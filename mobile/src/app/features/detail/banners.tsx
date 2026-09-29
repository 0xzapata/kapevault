import { useRef, useState, type ReactNode } from "react";
import { Phone, SealCheck, WarningCircle } from "@phosphor-icons/react";
import { cardPrimary, cardQuiet } from "../../components/buttons";
import { useToast } from "../../components/Toast";
import { useHost } from "../../host/host-context";
import { clockTime, formatDay } from "../../lib/format";
import { isSerious, linkOf } from "../../lib/entries";
import { issueAdvice, issueLabel, worstIssue } from "../../lib/issues";
import type { ConflictCopy, Entry, PayeeEntry } from "../../host/types";

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
  const host = useHost();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  async function remove() {
    if (!confirming) return setConfirming(true);
    await host.deleteEntry(conflict.id);
    toast("Conflict copy deleted");
    onDeleted();
  }
  return (
    <Banner
      tone="warn"
      title="Changed on both devices"
      actions={
        <>
          {conflict.originalId && (
            <button type="button" onClick={() => onOpen(conflict.originalId!)} className={`${cardPrimary} mr-1`}>
              Open the other one
            </button>
          )}
          <button type="button" onClick={remove} className={confirming ? `${cardQuiet} bg-danger-soft text-danger` : conflict.originalId ? cardQuiet : cardPrimary}>
            {confirming ? "Confirm delete" : "Delete this copy"}
          </button>
        </>
      }
    >
      This copy is the {conflict.device} version from {clockTime(conflict.at)}. Compare it with the other one, keep what you need, then delete this copy.
    </Banner>
  );
}

// Whether a payee's number was confirmed by a real phone call.
export function PayeeConfirmation({ entry }: { entry: PayeeEntry }) {
  const host = useHost();
  const toast = useToast();
  const confirmedOnOpen = useRef(entry.confirmedAt);
  if (entry.confirmedAt) {
    // Confirmed just now, on this page: a small success, so it settles in and the seal blooms.
    const fresh = !confirmedOnOpen.current;
    return (
      <div className={fresh ? "settle" : undefined}>
        <Banner tone="ok" icon={<SealCheck size={20} weight="fill" className={fresh ? "swap-in" : undefined} />} title={`Confirmed by call on ${formatDay(entry.confirmedAt)}`}>
          If {entry.who} sends a new number, call before you send money.
        </Banner>
      </div>
    );
  }
  return (
    <Banner
      tone="warn"
      icon={<Phone size={20} weight="fill" />}
      title="Not confirmed yet"
      actions={
        <button type="button" onClick={() => host.confirmPayee(entry.id, entry.number).then(() => toast("Marked confirmed today"), () => toast("Could not mark it", "error"))} className="press hit h-8 rounded-full bg-raised px-3.5 text-[12.5px] font-semibold text-accent shadow-tile focus-ring">
          Mark confirmed today
        </button>
      }
    >
      Call {entry.who} on a number you already know and read this one back.
    </Banner>
  );
}
