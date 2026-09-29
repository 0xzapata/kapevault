import type { ReactNode } from "react";
import { CheckCircle, PhoneCall, SealCheck, WarningOctagon } from "@phosphor-icons/react";
import { EntryIcon } from "@/features/vault/components/EntryIcon";
import { formatDay } from "@/lib/local-date";
import { formatNumber, maskNumber, numberKey, type PayeeVerdict } from "../lib/payee-check";

const TONES = {
  ok: { box: "bg-ok-soft", ink: "text-ok" },
  info: { box: "bg-accent-soft", ink: "text-accent" },
  warn: { box: "bg-warn-soft", ink: "text-warn" },
  danger: { box: "bg-danger-soft", ink: "text-danger" },
};

// A number with the digits that differ from a saved one marked, grouped like the saved number.
function Digits({ number, diff }: { number: string; diff: number[] }) {
  let digit = -1;
  return (
    <span className="font-mono text-[12.5px] tracking-wide text-ink">
      {[...formatNumber(number)].map((c, i) => {
        if (c === " ") return <span key={i}> </span>;
        digit += 1;
        return diff.includes(digit) ? (
          <mark key={i} className="rounded-[3px] bg-danger px-px font-semibold text-on-accent">
            {c}
          </mark>
        ) : (
          <span key={i}>{c}</span>
        );
      })}
    </span>
  );
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// Payee Check's answer to a number in a search: one glanceable card, the colour says how safe it is.
// It only informs - the caller makes it a button (main search) or a list option (quick search).
export function PayeeVerdictCard({ verdict, selected = false }: { verdict: PayeeVerdict; selected?: boolean }) {
  let tone: keyof typeof TONES;
  let Icon = WarningOctagon;
  let title: string;
  let detail: ReactNode;

  switch (verdict.kind) {
    case "match": {
      const { payee, others } = verdict;
      tone = payee.confirmedAt ? "ok" : "info";
      Icon = payee.confirmedAt ? SealCheck : CheckCircle;
      title = `Matches ${payee.who}'s ${payee.provider}`;
      detail = (
        <>
          {payee.accountName && `${payee.accountName} · `}
          {payee.confirmedAt ? (
            <>
              Confirmed by call on <span className="whitespace-nowrap">{formatDay(payee.confirmedAt)}</span>
            </>
          ) : (
            "Not confirmed by call yet"
          )}
          {others.length > 0 && ` · Also saved for ${[...new Set(others.map((p) => p.who))].join(", ")}`}
        </>
      );
      break;
    }
    case "new-number": {
      const { payee, owner } = verdict;
      tone = "danger";
      title = `New number for ${payee.who}`;
      detail = owner ? (
        <>
          This number is {owner.who}'s. Call {payee.who} before you send.
        </>
      ) : (
        <>
          Saved {payee.provider}: <span className="whitespace-nowrap">{maskNumber(payee.number)}</span>. Call {payee.who} before you send.
        </>
      );
      break;
    }
    case "near-miss": {
      const { payee, typed, diff } = verdict;
      const saved = numberKey(payee.number);
      const swapped = diff.length === 2 && diff[1] === diff[0] + 1 && typed[diff[0]] === saved[diff[1]] && typed[diff[1]] === saved[diff[0]];
      tone = "danger";
      title = `Almost ${payee.who}'s ${payee.provider} - ${swapped ? "two digits swapped" : `${diff.length} ${plural(diff.length, "digit differs", "digits differ")}`}`;
      detail = (
        <span className="flex flex-wrap gap-x-3 gap-y-0.5">
          <span>
            You typed <Digits number={typed} diff={diff} />
          </span>
          <span>
            Saved <Digits number={saved} diff={diff} />
          </span>
        </span>
      );
      break;
    }
    case "not-payee":
      tone = "warn";
      Icon = PhoneCall;
      title = "Not one of your payees";
      detail = `${formatNumber(verdict.typed)} - call to check it before you send.`;
      break;
  }

  const { box, ink } = TONES[tone];
  const payee = verdict.kind === "not-payee" ? null : verdict.payee;
  return (
    // Spans only: in main search the card sits inside a button.
    <span data-verdict={verdict.kind} className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 ${box} ${selected ? "ring-2 ring-accent" : ""}`}>
      <Icon size={22} weight="fill" className={`shrink-0 self-start ${ink}`} />
      <span className="min-w-0 flex-1">
        <span className={`block text-[14px] font-semibold leading-snug tracking-[-0.01em] ${ink}`}>{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-2">{detail}</span>
      </span>
      {payee && (
        <span className="relative size-8 shrink-0">
          {/* EntryIcon's small tile is 40px; scaled to 32 like the quick search rows. */}
          <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 scale-80">
            <EntryIcon entry={payee} size="sm" />
          </span>
        </span>
      )}
    </span>
  );
}
