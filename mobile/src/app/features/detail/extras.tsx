import { useState } from "react";
import { CaretDown, Eye, EyeSlash } from "@phosphor-icons/react";
import { cardPill } from "../../components/buttons";
import { Card, SecretField, useReveal } from "../../components/fields";
import { PhotoTile } from "../../components/photo";
import { Button, ErrorText, Label, TextArea } from "../../components/form";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { useHost } from "../../host/host-context";
import { formatDay } from "../../lib/format";
import type { IdEntry, LoginEntry } from "../../host/types";

// An ID's photo under the card: hidden, not even loaded, until Show photo (the PC's SecretPhoto).
export function IdPhotoCard({ entry }: { entry: IdEntry }) {
  const host = useHost();
  const { value: photo, toggle } = useReveal(() => host.getSecret(entry.id, "photo"));
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-[12.5px] font-semibold text-ink-3">ID photo</h3>
        <button type="button" onClick={toggle} aria-expanded={photo !== null} className={cardPill}>
          {photo === null ? <Eye size={14} /> : <EyeSlash size={14} />}
          {photo === null ? "Show photo" : "Hide photo"}
        </button>
      </div>
      <PhotoTile photo={photo} label="ID photo" className="aspect-[8/5] w-full rounded-2xl" />
    </section>
  );
}

// A login's backup codes: counts on the card, the codes themselves one reveal at a time.
export function BackupCodesCard({ entry }: { entry: LoginEntry }) {
  const host = useHost();
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState(false);
  const set = entry.recoveryCodes;
  return (
    <Card className="mt-5">
      <div className="flex items-center gap-3 py-3.5 pl-4 pr-3">
        <span className="min-w-0 flex-1">
          <b className="block text-[14px] font-semibold">Backup codes</b>
          <small className="mt-0.5 block text-[12.5px] text-ink-3">{set ? `${set.left} of ${set.total} left · set ${formatDay(set.setAt)}` : "None saved - for when you lose your phone"}</small>
        </span>
        {set ? (
          <button type="button" onClick={() => setShown(!shown)} aria-expanded={shown} className={cardPill}>
            {shown ? "Hide codes" : "Show codes"}
          </button>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={cardPill}>
            Add codes
          </button>
        )}
      </div>
      {shown && set && (
        <div className="settle border-t border-line">
          {Array.from({ length: set.total }, (_, i) => (
            <SecretField key={i} label={`Code ${i + 1}`} what="code" reveal={() => host.getSecret(entry.id, "code", i)} copy={() => host.copySecret(entry.id, "code", i)} copiedToast="Backup code copied - clears in 30s" dots={10} />
          ))}
        </div>
      )}
      {adding && <AddCodesSheet id={entry.id} onClose={() => setAdding(false)} />}
    </Card>
  );
}

function AddCodesSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const host = useHost();
  const toast = useToast();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  async function save(close: () => void) {
    const codes = text.split(/[\s,]+/).filter(Boolean);
    const result = await host.setRecoveryCodes(id, codes);
    if (!result.ok) return setError(result.error);
    toast(`${codes.length} backup codes saved`);
    close();
  }
  return (
    <Sheet
      title="Backup codes"
      onClose={onClose}
      footer={(close) => (
        <>
          <span className="flex-1" />
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={() => save(close)}>
            Save
          </Button>
        </>
      )}
    >
      {() => (
        <div className="mt-5 space-y-3">
          <Label text="Paste the codes the site gave you">
            <TextArea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoComplete="off" className="h-40 font-mono" placeholder="One per line" />
          </Label>
          <ErrorText message={error} />
        </div>
      )}
    </Sheet>
  );
}

// Old passwords, closed by default; clearing asks once more.
export function PasswordHistory({ entry }: { entry: LoginEntry }) {
  const host = useHost();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const text = "press hit h-8 rounded-full px-3 text-[12.5px] font-semibold focus-ring";
  return (
    <Card className="mt-5">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="press flex min-h-[52px] w-full items-center justify-between gap-3 px-4 text-left text-[14px] font-semibold focus-ring">
        Password history ({entry.history.length})
        <CaretDown size={13} weight="bold" className={`shrink-0 text-ink-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="settle border-t border-line">
          {entry.history.map((h, i) => (
            <SecretField key={`${h.changedAt}-${i}`} label={`Replaced ${formatDay(h.changedAt)}`} what="old password" reveal={() => host.getSecret(entry.id, "history", i)} copy={() => host.copySecret(entry.id, "history", i)} copiedToast="Password copied - clears in 30s" />
          ))}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-3 py-2">
            {confirming ? (
              <>
                <span className="mr-auto px-1 text-[12.5px] text-ink-3">Old passwords cannot be brought back.</span>
                <button type="button" onClick={() => setConfirming(false)} className={`${text} text-ink-2`}>
                  Cancel
                </button>
                <button type="button" onClick={() => host.clearHistory(entry.id).then(() => toast("Password history cleared"))} className={`${text} bg-danger-soft text-danger`}>
                  Confirm clear
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className={`${text} text-danger`}>
                Clear history
              </button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
