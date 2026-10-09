import { EnvelopeSimple, Moon } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";
import { cardPrimary, cardQuiet } from "@/components/buttons";
import { vaultApi } from "@/lib/vault-api";
import { formatDay, localToday } from "@/lib/local-date";
import { useAction } from "@/hooks/use-action";
import type { Lifecycle, LoginEntry } from "@/features/vault/types";
import { followUpDue } from "../lib/lifecycle";

interface ClosingStatusProps {
  entry: LoginEntry;
  onSheet: (sheet: "email" | "gone") => void; // the detail pane owns the sheets, so they outlive this card
}

const day = (ymd?: string) => (ymd ? formatDay(ymd) : "an unknown day");

// The card's heading and line for each stage of closing.
function describe(lifecycle: Lifecycle, due: boolean): { heading: string; text: string } {
  if (lifecycle.state === "dormant") return { heading: "Not in use", text: "Ask them to delete it when you're ready." };
  if (due) return { heading: "Follow up due", text: `You asked on ${day(lifecycle.requestedAt)}. Still there? Send it again.` };
  return { heading: `Asked to delete on ${day(lifecycle.requestedAt)}`, text: `Check on ${day(lifecycle.followUpAt)} that it's gone.` };
}

// Where a closing account stands (dormant, or deletion requested and when to follow up), with the
// next step. Sits above the item's card, like the Security banner.
export function ClosingStatus({ entry, onSheet }: ClosingStatusProps) {
  const toast = useToast();
  const action = useAction();
  const lifecycle = entry.lifecycle;
  if (!lifecycle || lifecycle.state === "gone") return null;

  const requested = lifecycle.state === "deletion-requested";
  const due = followUpDue(entry, localToday());
  const { heading, text } = describe(lifecycle, due);

  const run = (call: () => Promise<unknown>, done: string) => action.run(call, () => toast(done));

  const Icon = requested ? EnvelopeSimple : Moon;
  return (
    <section aria-label="Closing" className={`mb-5 flex gap-3 rounded-2xl px-4 py-4 @md:px-5 ${due ? "bg-warn-soft" : "bg-field"}`}>
      <Icon size={20} weight="fill" className={`mt-px shrink-0 ${due ? "text-warn" : "text-ink-3"}`} />
      <div className="min-w-0 flex-1">
        <h2 className={`text-[14px] font-semibold ${due ? "text-warn" : "text-ink"}`}>{heading}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{text}</p>
        <div className="-ml-1 mt-3 flex flex-wrap items-center gap-1">
          {requested ? (
            <button type="button" onClick={() => onSheet("gone")} className={`${cardPrimary} mr-1`}>
              Confirm it's gone
            </button>
          ) : (
            <button type="button" onClick={() => onSheet("email")} className={`${cardPrimary} mr-1`}>
              Ask to delete
            </button>
          )}
          {due && (
            <button type="button" onClick={() => run(() => vaultApi.setLifecycle(entry.id, "deletion-requested"), "Sent again - follow up in 30 days")} className={cardQuiet}>
              I sent it again
            </button>
          )}
          {requested ? (
            <button type="button" onClick={() => onSheet("email")} className={cardQuiet}>
              Show email
            </button>
          ) : (
            <button type="button" onClick={() => onSheet("gone")} className={cardQuiet}>
              Confirm it's gone
            </button>
          )}
          <button type="button" onClick={() => run(() => vaultApi.setLifecycle(entry.id, null), "Back in use")} className={cardQuiet}>
            Back in use
          </button>
        </div>
      </div>
    </section>
  );
}
