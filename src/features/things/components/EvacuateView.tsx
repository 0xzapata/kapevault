import { useId, useState } from "react";
import { Check, Printer, X } from "@phosphor-icons/react";
import { TitleBar } from "@/components/TitleBar";
import { useModal, useSheetExit } from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { barPill } from "@/components/buttons";
import { vaultApi } from "@/lib/vault-api";
import { useAction } from "@/hooks/use-action";
import type { ThingEntry } from "@/features/vault/types";
import { GRAB_OPTIONS, evacuationOrder } from "../lib/things";

interface EvacuateViewProps {
  things: ThingEntry[];
  onClose: () => void;
}

// Evacuate: every thing in the order you grab it, its spot in big type, and a tick to mark it
// packed. Ticks live only while this is open - nothing is saved. Print makes the grab list PDF
// to tape inside a cabinet door. Escape closes.
export function EvacuateView({ things, onClose }: EvacuateViewProps) {
  const { closing, close } = useSheetExit(onClose);
  const modal = useModal(); // the list stays mounted underneath: Tab goes round in here, focus goes back to it after
  const toast = useToast();
  const ids = useId();
  const [packed, setPacked] = useState<Set<string>>(() => new Set());
  const { busy: printing, run } = useAction();
  const [error, setError] = useState("");
  const ordered = evacuationOrder(things);
  const toGrab = ordered.filter((t) => t.grab !== 3);
  const done = toGrab.filter((t) => packed.has(t.id)).length;

  function toggle(id: string) {
    setPacked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function print() {
    setError("");
    run(
      () => vaultApi.evacuationPdf(),
      (result) => {
        if (!result.ok) setError(result.error);
        else if (!result.canceled) toast(`Saved ${result.name}`);
      },
      () => setError("Could not make the PDF. Try again."),
    );
  }

  return (
    <div data-closing={closing || undefined} className="fixed inset-0 z-50">
      <div {...modal} role="dialog" aria-modal="true" aria-label="Evacuate" tabIndex={-1} className="sheet flex h-full flex-col bg-surface outline-none">
        <TitleBar edgeLeft edgeRight className="px-4">
          <button autoFocus onClick={close} className={barPill}>
            <X size={13} weight="bold" />
            Done
          </button>
        </TitleBar>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[760px] px-5 pb-16 pt-2 sm:px-8">
            <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
              <div>
                <h1 className="text-[34px] font-bold leading-tight tracking-[-0.03em]">Evacuate</h1>
                <p aria-live="polite" className={`mt-1 text-[15px] tabular-nums ${toGrab.length && done === toGrab.length ? "font-semibold text-ok" : "text-ink-2"}`}>
                  {toGrab.length === 0 ? "Nothing marked to grab." : done === toGrab.length ? "Everything is packed." : `${done} of ${toGrab.length} packed`}
                </p>
              </div>
              <button onClick={print} disabled={printing} className="press flex h-10 items-center gap-2 rounded-full bg-raised px-4 text-[14px] font-semibold text-accent shadow-tile hover:bg-hover disabled:opacity-50 focus-ring">
                <Printer size={16} weight="bold" />
                {printing ? "Making the PDF..." : "Print grab list"}
              </button>
            </header>
            {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}

            {GRAB_OPTIONS.map(({ value, label }) => {
              const group = ordered.filter((t) => t.grab === value);
              if (!group.length) return null;
              const leave = value === 3;
              return (
                <section key={value} aria-label={label} className="mt-8">
                  <h2 className="mb-2 px-1 text-[13px] font-semibold text-ink-3">{label}</h2>
                  <ul className="overflow-hidden rounded-2xl border border-line bg-raised shadow-card">
                    {group.map((t) => (
                      <li key={t.id} className="border-b border-line last:border-b-0">
                        {leave ? (
                          <div className="flex gap-4 px-4 py-4 sm:px-5">
                            <span className="size-8 shrink-0" />
                            <Spot thing={t} look="leave" />
                          </div>
                        ) : (
                          <button
                            role="checkbox"
                            aria-checked={packed.has(t.id)}
                            aria-label={t.title}
                            aria-describedby={t.room ? `${ids}${t.id}-room ${ids}${t.id}-spot` : `${ids}${t.id}-spot`}
                            onClick={() => toggle(t.id)}
                            className="row flex w-full items-start gap-4 px-4 py-4 text-left hover:bg-hover sm:px-5 focus-ring focus-ring-inset"
                          >
                            <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border-2 ${packed.has(t.id) ? "border-accent bg-accent text-on-accent" : "border-ink-3"}`}>
                              {packed.has(t.id) && <Check size={17} weight="bold" className="swap-in" />}
                            </span>
                            <Spot thing={t} look={packed.has(t.id) ? "packed" : "grab"} idBase={`${ids}${t.id}`} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// What it is and where it is: the room small, the thing and its spot big enough to read at a run.
function Spot({ thing, look, idBase }: { thing: ThingEntry; look: "grab" | "packed" | "leave"; idBase?: string }) {
  const title = { grab: "text-ink", packed: "text-ink-3 line-through", leave: "text-ink-2" }[look];
  return (
    <span className="min-w-0 flex-1">
      {thing.room && (
        <span id={idBase && `${idBase}-room`} className="block text-[13px] font-medium text-ink-3">
          {thing.room}
        </span>
      )}
      <span className={`block text-[19px] font-semibold leading-snug tracking-[-0.01em] ${title}`}>{thing.title}</span>
      <span id={idBase && `${idBase}-spot`} className={`selectable mt-0.5 block whitespace-pre-wrap break-words text-[17px] leading-snug ${look === "grab" ? "text-ink-2" : "text-ink-3"}`}>{thing.spot}</span>
    </span>
  );
}
