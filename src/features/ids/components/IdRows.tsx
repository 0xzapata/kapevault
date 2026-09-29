import { vaultApi } from "@/lib/vault-api";
import { Field } from "@/components/Card";
import { SecretField } from "@/components/SecretField";
import type { IdEntry } from "@/features/vault/types";

// The number stays in main until Reveal or Copy, and a copy clears like a password.
export function IdRows({ entry }: { entry: IdEntry }) {
  return (
    <>
      <Field label="ID">
        <span className="font-medium">{entry.idType}</span>
      </Field>
      {entry.hasNumber ? (
        <SecretField
          label="ID number"
          reveal={() => vaultApi.getSecret(entry.id, "idNumber")}
          copy={() => vaultApi.copySecret(entry.id, "idNumber")}
          copyLabel="Copy ID number (clears in 30s)"
          copiedToast="ID number copied - clears in 30s"
        />
      ) : (
        <Field label="ID number">
          <span className="text-ink-3">None saved</span>
        </Field>
      )}
    </>
  );
}
