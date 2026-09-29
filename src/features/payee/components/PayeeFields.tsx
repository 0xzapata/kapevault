import type { ReactNode } from "react";
import { Label, TextInput } from "@/components/form";
import { cleanNumber } from "../lib/payee-check";
import type { usePayeeForm } from "../hooks/use-payee-form";
import { ProviderPicker } from "./ProviderPicker";

interface PayeeFieldsProps {
  payee: ReturnType<typeof usePayeeForm>;
  titleRow: ReactNode; // the form's Title + Space, last: the title can be left to "Who Provider"
}

// The payee part of the item form: who it is, where the money goes, and the number to check by call.
export function PayeeFields({ payee, titleRow }: PayeeFieldsProps) {
  const { entry, who, setWho, relation, setRelation, provider, setProvider, number, setNumber, accountName, setAccountName } = payee;

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Label text="Who">
          <TextInput autoFocus value={who} onChange={(e) => setWho(e.target.value)} placeholder="Mama" />
        </Label>
        <Label text="Relation (optional)">
          <TextInput value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="Mother" />
        </Label>
      </div>
      <div>
        <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">Wallet or bank</span>
        <ProviderPicker value={provider} onChange={setProvider} />
      </div>
      <div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Label text="Account or mobile number">
            <TextInput value={number} onChange={(e) => setNumber(e.target.value)} inputMode="tel" placeholder="0917 123 4567" spellCheck={false} autoComplete="off" className="font-mono" />
          </Label>
          <Label text="Registered name (optional)">
            <TextInput value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="As the app shows it" spellCheck={false} />
          </Label>
        </div>
        {entry?.confirmedAt ? (
          cleanNumber(number) !== entry.number && <p className="mt-1.5 text-[12px] text-warn">New number - call {who.trim() || "them"} again to confirm it.</p>
        ) : (
          <p className="mt-1.5 text-[12px] text-ink-3">Call {who.trim() || "them"} to check this number before you send money.</p>
        )}
      </div>
      {titleRow}
    </>
  );
}
