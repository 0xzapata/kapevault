import { useState, type ReactNode } from "react";
import { Fingerprint } from "@phosphor-icons/react";
import { ErrorText } from "@/components/form";
import { vaultApi, type BiometricStatus } from "@/lib/vault-api";
import { biometricName, isMac } from "@/lib/platform";
import { Group, SwitchRow } from "@/features/settings/SettingRow";
import { useAction } from "@/hooks/use-action";
import { unsupportedNote } from "../lib/biometric-note";

interface BiometricSectionProps {
  status: BiometricStatus | null;
  onStatus: (status: BiometricStatus) => void;
  notice?: string; // e.g. turned off by a master password change
}

// Settings > Security: turn Windows Hello / Touch ID unlock on or off.
export function BiometricSection({ status, onStatus, notice }: BiometricSectionProps) {
  const { busy, run } = useAction();
  const [error, setError] = useState("");
  const name = biometricName(status);

  function toggle(on: boolean) {
    setError("");
    run(
      async () => {
        if (on) {
          const result = await vaultApi.biometricEnable();
          if (result.ok) onStatus(result.status);
          else setError(result.error);
        } else {
          onStatus(await vaultApi.biometricDisable());
        }
      },
      undefined,
      () => setError(`Could not reach ${name}. Try again.`),
    );
  }

  let note: ReactNode = `Unlock with ${name} instead of typing your master password. KAPEVault still asks for your master password every 14 days.`;
  if (status && !status.supported) note = unsupportedNote(status, isMac);
  // Set up for the vault's old key and could not be removed then: it no longer opens this vault.
  if (status?.stale) note = <span className="text-warn">{name} needs to be turned on again.</span>;
  if (busy) note = `Waiting for ${name}...`;

  return (
    <Group title="Unlock">
      <SwitchRow
        title={name}
        icon={<Fingerprint size={20} weight="duotone" />}
        checked={(status?.enabled && !status.stale) ?? false}
        disabled={busy || !status || (!status.supported && !status.enabled)}
        onChange={toggle}
        note={note}
      />
      {notice && <p className="text-[13px] text-ink-2">{notice}</p>}
      <ErrorText message={error} />
    </Group>
  );
}
