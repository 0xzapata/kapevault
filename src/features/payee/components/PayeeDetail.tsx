import { Phone, SealCheck } from "@phosphor-icons/react";
import { vaultApi } from "@/lib/vault-api";
import { useToast } from "@/components/Toast";
import { providerBrand } from "@/features/brands/brands";
import { CopyButton } from "@/components/IconButton";
import { Field } from "@/components/Card";
import { formatDay } from "@/lib/local-date";
import type { PayeeEntry } from "@/features/vault/types";
import { useAction } from "@/hooks/use-action";
import { formatNumber } from "../lib/payee-check";

// Above the payee's card: whether its number was confirmed by a real phone call, and when.
export function PayeeConfirmation({ entry }: { entry: PayeeEntry }) {
  const toast = useToast();
  const { busy, run } = useAction();

  // main pushes the new view to every window
  const confirm = () => run(() => vaultApi.confirmPayee(entry.id, entry.number), () => toast("Marked confirmed today"));

  if (entry.confirmedAt) {
    return (
      <section aria-label="Confirmation" className="mb-5 flex gap-3 rounded-2xl bg-ok-soft px-4 py-4 @md:px-5">
        <SealCheck size={20} weight="fill" className="mt-px shrink-0 text-ok" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-ok">Confirmed by call on {formatDay(entry.confirmedAt)}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">If {entry.who} sends a new number, call before you send money.</p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Confirmation" className="mb-5 flex gap-3 rounded-2xl bg-warn-soft px-4 py-4 @md:px-5">
      <Phone size={20} weight="fill" className="mt-px shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <h2 className="text-[14px] font-semibold text-warn">Not confirmed yet</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">Call {entry.who} on a number you already know and read this one back.</p>
        <button
          onClick={confirm}
          disabled={busy}
          className="press mt-3 h-8 rounded-full bg-raised px-3.5 text-[12.5px] font-semibold text-accent shadow-tile transition-colors hover:bg-hover disabled:opacity-50 focus-ring"
        >
          Mark confirmed today
        </button>
      </div>
    </section>
  );
}

export function PayeeRows({ entry }: { entry: PayeeEntry }) {
  const brand = providerBrand(entry.provider);
  return (
    <>
      <Field label="Who">
        {entry.who}
        {entry.relation && <span className="text-ink-3"> · {entry.relation}</span>}
      </Field>
      <Field label="Wallet or bank">
        <span className="flex items-center gap-2 font-medium">
          {/* Logos are drawn for white, so they sit on paper in every theme. */}
          {brand && (
            <span className="grid size-6 shrink-0 place-items-center rounded-[6px] border border-line bg-paper">
              <img src={brand.logo} alt="" className="size-4 object-contain" />
            </span>
          )}
          {entry.provider}
        </span>
      </Field>
      <Field label="Number" actions={<CopyButton label="Copy number" copy={() => vaultApi.copyText(entry.number, entry.id)} toastText="Number copied" />}>
        <span className="font-mono text-[15px] tracking-wide">{formatNumber(entry.number)}</span>
      </Field>
      <Field label="Account name">{entry.accountName || <span className="text-ink-3">Not saved</span>}</Field>
    </>
  );
}
