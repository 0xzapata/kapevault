import { useEffect, useRef, useState } from "react";
import { CheckCircle, Eye, EyeSlash, Printer, X } from "@phosphor-icons/react";
import { vaultApi } from "@/lib/vault-api";
import { formatDay, localToday } from "@/lib/local-date";
import { useReveal } from "@/hooks/use-reveal";
import { useToast } from "@/components/Toast";
import { Button, TextArea, TextInput } from "@/components/form";
import { cardPill, cardQuiet } from "@/components/buttons";
import { Card } from "@/components/Card";
import { CopyButton, IconButton } from "@/components/IconButton";
import { useAction } from "@/hooks/use-action";
import type { LoginEntry } from "@/features/vault/types";
import { parseCodes } from "../lib/parse-codes";

interface RecoveryCodesProps {
  entry: LoginEntry;
  replaceSignal: number; // bumped by the Security banner's "Replace codes"
}

type Mode = "view" | "paste" | "paper";

const shredButton = "press h-8 shrink-0 rounded-full bg-warn-soft px-3 text-[12.5px] font-semibold text-warn transition-colors hover:brightness-95 focus-ring";

// Backup codes on a login: counts from the page view, the codes themselves only on reveal (one
// fetch). Ticking one off, copying one, a new set and paper copies all go straight to main.
export function RecoveryCodes({ entry, replaceSignal }: RecoveryCodesProps) {
  const toast = useToast();
  const set = entry.recoveryCodes;
  const { value: codes, setValue: setCodes, toggle: toggleReveal } = useReveal(() => vaultApi.recoveryCodes(entry.id));
  const [mode, setMode] = useState<Mode>("view");
  const [pasted, setPasted] = useState("");
  const [where, setWhere] = useState("");
  const [printedAt, setPrintedAt] = useState(() => localToday());
  const action = useAction();
  const busy = action.busy;
  const cardRef = useRef<HTMLElement>(null);
  const parsed = parseCodes(pasted);

  useEffect(() => {
    if (replaceSignal === 0) return;
    setMode("paste");
    cardRef.current?.scrollIntoView({ block: "nearest" });
  }, [replaceSignal]);

  // main pushes the new view to every window
  const run = (call: () => Promise<unknown>, done?: string) => action.run(call, done ? () => toast(done) : undefined);

  async function saveCodes() {
    if (parsed.error) return;
    const replacing = Boolean(set);
    if (await run(() => vaultApi.setRecoveryCodes(entry.id, parsed.codes), replacing ? "Backup codes replaced" : "Backup codes saved")) {
      setCodes(null);
      setPasted("");
      setMode("view");
    }
  }

  async function toggleUsed(index: number) {
    if (!codes) return;
    const used = !codes[index].used;
    if (await run(() => vaultApi.markRecoveryCode(entry.id, index, used))) {
      setCodes(codes.map((c, i) => (i === index ? { ...c, used } : c)));
    }
  }

  async function addPaper() {
    if (!where.trim()) return;
    if (await run(() => vaultApi.addPaperCopy(entry.id, where, printedAt), "Printed copy added")) {
      setWhere("");
      setPrintedAt(localToday());
      setMode("view");
    }
  }

  const leftTone = !set ? "text-ink-3" : set.left === 0 ? "text-danger" : set.left <= 2 ? "text-warn" : "text-ink-3";

  return (
    <section ref={cardRef} aria-label="Backup codes" className="mt-5">
      <Card>
        <div className="flex min-h-14 items-center gap-3 px-4 py-2 @md:px-5">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium">Backup codes</p>
            <p className={`text-[12.5px] tabular-nums ${set ? "truncate" : ""} ${leftTone}`}>
              {set ? `${set.left} of ${set.total} left · Set ${formatDay(set.setAt)}` : "None saved - for when you lose your phone"}
            </p>
          </div>
          {set ? (
            <button onClick={toggleReveal} aria-expanded={codes !== null} aria-controls="backup-codes" className={cardPill}>
              {codes ? <EyeSlash size={14} /> : <Eye size={14} />}
              {codes ? "Hide codes" : "Show codes"}
            </button>
          ) : (
            mode !== "paste" && (
              <button onClick={() => setMode("paste")} className={cardPill}>
                Add codes
              </button>
            )
          )}
        </div>

        {codes && (
          <ol id="backup-codes" aria-label="Codes" className="settle grid grid-cols-1 border-t border-line px-2 py-2 @md:grid-cols-2 @md:px-3">
            {codes.map((c, i) => (
              <li key={i} className="flex min-h-11 items-center gap-2 rounded-[10px] px-2">
                <span className="w-5 shrink-0 text-right text-[12px] tabular-nums text-ink-3">{i + 1}</span>
                <span className={`selectable min-w-0 flex-1 truncate font-mono text-[14px] ${c.used ? "text-ink-3 line-through" : ""}`}>{c.code}</span>
                <button
                  onClick={() => toggleUsed(i)}
                  disabled={busy}
                  aria-pressed={c.used}
                  aria-label={c.used ? `Mark code ${i + 1} unused` : `Mark code ${i + 1} used`}
                  title={c.used ? "Used - click to undo" : "Mark used"}
                  className={`press grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-accent-soft ${c.used ? "text-ok" : "text-ink-3 hover:text-accent"} focus-ring`}
                >
                  <CheckCircle size={17} weight={c.used ? "fill" : "regular"} />
                </button>
                <CopyButton label={`Copy code ${i + 1} (clears in 30s)`} copy={() => vaultApi.copySecret(entry.id, "code", i)} toastText="Code copied - clears in 30s" />
              </li>
            ))}
          </ol>
        )}

        {mode === "paste" && (
          <div className="settle space-y-3 border-t border-line px-4 py-4 @md:px-5">
            <TextArea
              autoFocus
              aria-label="Paste backup codes"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={6}
              spellCheck={false}
              placeholder="Paste the codes from the site"
              className="min-h-[132px] resize-y! font-mono text-[13px] leading-relaxed"
            />
            {pasted.trim() && (
              <div aria-live="polite">
                {parsed.codes.length > 0 && (
                  <ol aria-label="Codes found" className="flex flex-wrap gap-1.5">
                    {parsed.codes.map((c, i) => (
                      <li key={`${c}-${i}`} className="rounded-[7px] bg-field px-2 py-1 font-mono text-[12.5px] text-ink-2">
                        {c}
                      </li>
                    ))}
                  </ol>
                )}
                <p className={`mt-2 text-[12.5px] ${parsed.error ? "text-danger" : "text-ink-3"}`}>{parsed.error || `${parsed.codes.length} codes found. Check they match the site.`}</p>
              </div>
            )}
            {set && <p className="text-[12.5px] text-warn">This replaces the {set.total} saved codes{set.paper.some((p) => !p.outdatedAt) ? " - printed copies go out of date" : ""}.</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => { setMode("view"); setPasted(""); }}>
                Cancel
              </Button>
              <Button type="button" variant="primary" disabled={busy || Boolean(parsed.error)} onClick={saveCodes}>
                {parsed.error ? "Save codes" : `Save ${parsed.codes.length} codes`}
              </Button>
            </div>
          </div>
        )}

        {set && set.paper.length > 0 && (
          <ul aria-label="Printed copies" className="border-t border-line">
            {set.paper.map((p, i) => (
              <li key={`${p.where}-${i}`} className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2 last:border-b-0 @md:px-5">
                <Printer size={17} className={`shrink-0 ${p.outdatedAt ? "text-warn" : "text-ink-3"}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-[13.5px] ${p.outdatedAt ? "font-medium text-warn" : ""}`}>
                    {p.outdatedAt ? `Printed copy in ${p.where} is out of date - shred it` : `Printed copy in ${p.where}`}
                  </p>
                  <p className="text-[12px] text-ink-3">
                    Printed {formatDay(p.printedAt)}
                    {p.outdatedAt && ` · codes replaced ${formatDay(p.outdatedAt)}`}
                  </p>
                </div>
                {p.outdatedAt ? (
                  <button onClick={() => run(() => vaultApi.removePaperCopy(entry.id, i), "Printed copy removed")} disabled={busy} title="Remove it from the list" className={shredButton}>
                    Shredded
                  </button>
                ) : (
                  <IconButton label={`Remove the printed copy in ${p.where}`} disabled={busy} onClick={() => run(() => vaultApi.removePaperCopy(entry.id, i), "Printed copy removed")}>
                    <X size={15} />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        )}

        {mode === "paper" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addPaper();
            }}
            className="settle flex flex-wrap items-end gap-2 border-t border-line px-4 py-4 @md:px-5"
          >
            <label className="min-w-[180px] flex-1">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">Where is it?</span>
              <TextInput autoFocus value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Desk drawer" />
            </label>
            <label className="w-[170px]">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">Printed on</span>
              <TextInput type="date" value={printedAt} onChange={(e) => setPrintedAt(e.target.value)} />
            </label>
            <div className="flex gap-2 pb-0.5">
              <Button type="button" onClick={() => setMode("view")}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={busy || !where.trim()}>
                Save
              </Button>
            </div>
          </form>
        )}

        {set && mode === "view" && (
          <div className="flex flex-wrap justify-end gap-1 border-t border-line px-3 py-2">
            <button onClick={() => setMode("paper")} className={cardQuiet}>
              Add printed copy
            </button>
            <button onClick={() => setMode("paste")} className={cardQuiet}>
              Replace codes
            </button>
          </div>
        )}
      </Card>
    </section>
  );
}
