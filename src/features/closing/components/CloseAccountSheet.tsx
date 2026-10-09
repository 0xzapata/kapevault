import { useState } from "react";
import { ArrowSquareOut, CaretRight, Check, Copy, EnvelopeSimple, Moon } from "@phosphor-icons/react";
import { Sheet } from "@/components/Sheet";
import { Button, ErrorText } from "@/components/form";
import { useToast } from "@/components/Toast";
import { vaultApi } from "@/lib/vault-api";
import { formatDay } from "@/lib/local-date";
import { useCopyAction } from "@/hooks/use-copy-action";
import { ipcMessage } from "@/lib/ipc-message";
import { useAction } from "@/hooks/use-action";
import type { LoginEntry } from "@/features/vault/types";
import { emailText, erasureEmail } from "../lib/erasure-email";

interface CloseAccountSheetProps {
  entry: LoginEntry;
  step: "choose" | "email"; // email: straight to the erasure request (Request deletion, Show email)
  onClose: () => void;
}

const choice = "press flex w-full items-center gap-3.5 rounded-[14px] border border-line bg-raised px-4 py-3.5 text-left transition-colors hover:bg-hover focus-ring";
const glyph = "grid size-9 shrink-0 place-items-center rounded-full bg-field text-ink-2";
const pill = "press flex h-9 items-center gap-2 rounded-full bg-field px-4 text-[13.5px] font-medium text-ink transition-colors hover:bg-line focus-ring";

// "Close this account": mark it dormant, or ask the company to delete it with a copy-ready email.
export function CloseAccountSheet({ entry, step: startStep, onClose }: CloseAccountSheetProps) {
  const toast = useToast();
  const [step, setStep] = useState(startStep);
  const { busy, run } = useAction();
  const [error, setError] = useState("");
  const copy = useCopyAction();
  const requested = entry.lifecycle?.state === "deletion-requested";
  const email = erasureEmail({ service: entry.title, account: entry.username, website: entry.url });

  function mark(state: "dormant" | "deletion-requested", close: () => void) {
    setError("");
    run(
      () => vaultApi.setLifecycle(entry.id, state),
      (view) => {
        const followUp = view.entries.find((e) => e.id === entry.id);
        const at = followUp?.kind === "login" ? followUp.lifecycle?.followUpAt : undefined;
        toast(state === "dormant" ? "Moved to Closing" : `Request saved - follow up ${at ? formatDay(at) : "in 30 days"}`);
        close();
      },
      setError,
    );
  }

  async function openSite() {
    try {
      await vaultApi.openEntry(entry.id);
    } catch (e) {
      setError(`Could not open it: ${ipcMessage(e)}.`);
    }
  }

  return (
    <Sheet title={step === "choose" ? `Close ${entry.title}` : "Ask them to delete it"} onClose={onClose} width="w-[560px]">
      {(close) =>
        step === "choose" ? (
          <div className="space-y-2.5">
            <p className="pb-2 text-[13.5px] leading-relaxed text-ink-2">An account you no longer use can still leak. Close it properly.</p>
            <button type="button" onClick={() => mark("dormant", close)} disabled={busy} className={choice}>
              <span className={glyph}>
                <Moon size={17} weight="fill" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold">I stopped using it</span>
                <span className="block text-[12.5px] text-ink-3">Moves it to Closing. No more password warnings.</span>
              </span>
            </button>
            <button type="button" onClick={() => setStep("email")} className={choice}>
              <span className={glyph}>
                <EnvelopeSimple size={17} weight="fill" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold">Ask to delete</span>
                <span className="block text-[12.5px] text-ink-3">KAPEVault writes the email and reminds you in 30 days.</span>
              </span>
              <CaretRight size={15} className="shrink-0 text-ink-3" />
            </button>
            <ErrorText message={error} />
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              Send this from the account's email, or paste it into the site's support form.
              {!entry.username && " Add the email you signed up with."}
            </p>
            <div className="rounded-[14px] border border-line bg-surface">
              <p className="border-b border-line px-4 py-3 text-[13px]">
                <span className="text-ink-3">Subject </span>
                <span className="selectable font-medium">{email.subject}</span>
              </p>
              <article aria-label="Email" className="selectable max-h-[300px] overflow-y-auto whitespace-pre-wrap px-4 py-3.5 text-[13px] leading-relaxed text-ink">
                {email.body}
              </article>
            </div>
            <p className="text-[12px] text-ink-3">A template, not legal advice.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => copy.run(() => vaultApi.copyText(emailText(email), entry.id), "Email copied")} className={pill}>
                {copy.copied ? <Check size={15} weight="bold" className="swap-in text-ok" /> : <Copy size={15} />}
                {copy.copied ? "Copied" : "Copy email"}
              </button>
              {entry.url && (
                <button type="button" onClick={openSite} className={pill}>
                  <ArrowSquareOut size={15} />
                  Open website
                </button>
              )}
            </div>
            <ErrorText message={error} />
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              {requested ? (
                <Button type="button" variant="primary" onClick={close}>
                  Done
                </Button>
              ) : (
                <>
                  <Button type="button" onClick={close}>
                    Not now
                  </Button>
                  <Button type="button" variant="primary" disabled={busy} onClick={() => mark("deletion-requested", close)}>
                    I sent it
                  </Button>
                </>
              )}
            </div>
          </div>
        )
      }
    </Sheet>
  );
}
