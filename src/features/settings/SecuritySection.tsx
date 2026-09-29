import { useState, type FormEvent } from "react";
import { Button, ErrorText, Label, TextInput } from "@/components/form";
import { StrengthMeter } from "@/features/generator/components/StrengthMeter";
import { vaultApi } from "@/lib/vault-api";
import { OlderBackupsNotice } from "@/features/cloud/components/OlderBackupsNotice";
import { BiometricSection } from "@/features/biometric/components/BiometricSection";
import { AirWallSection } from "@/features/air-wall/components/AirWallSection";
import { biometricName } from "@/lib/platform";
import { useBiometricStatus } from "@/features/biometric/hooks/use-biometric-status";
import { CaptureSection } from "./CaptureSection";

export function SecuritySection() {
  const bio = useBiometricStatus();
  const [bioNotice, setBioNotice] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function changeMaster(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    if (next !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    let result;
    try {
      result = await vaultApi.changeMaster(current, next);
    } catch {
      result = { ok: false, error: "The vault locked while changing the password. Unlock and try again." };
    } finally {
      setBusy(false);
    }
    if (!result.ok) {
      setError(result.error ?? "Could not change the password.");
      return;
    }
    setError("");
    setDone(true);
    setCurrent("");
    setNext("");
    setConfirm("");
    if (result.biometricOff) {
      setBioNotice(`${biometricName(bio.status)} was turned off because the vault key changed. Turn it on again above.`);
      bio.refresh();
    }
  }

  return (
    <>
      <BiometricSection
        status={bio.status}
        notice={bioNotice}
        onStatus={(s) => {
          bio.setStatus(s);
          setBioNotice("");
        }}
      />

      <AirWallSection />

      <CaptureSection />

      <form onSubmit={changeMaster} className="space-y-3 border-t border-line pt-6">
        <h3 className="text-[13px] font-semibold text-ink-2">Change master password</h3>
        <Label text="Current password">
          <TextInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label text="New password">
            <TextInput type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Label>
          <Label text="Confirm new password">
            <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Label>
        </div>
        {next ? <StrengthMeter password={next} /> : <p className="text-[12.5px] text-ink-3">At least 12 characters, rated Strong.</p>}
        <ErrorText message={error} />
        {done && <p className="text-[13px] text-ok">Master password changed.</p>}
        {done && <OlderBackupsNotice />}
        <div className="flex justify-end pt-2">
          <Button type="submit" variant="primary" disabled={busy || !current || !next}>
            {busy ? "Changing..." : "Change password"}
          </Button>
        </div>
      </form>
    </>
  );
}
