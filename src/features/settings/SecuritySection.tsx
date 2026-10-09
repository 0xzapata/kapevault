import { useState } from "react";
import { BiometricSection } from "@/features/biometric/components/BiometricSection";
import { AirWallSection } from "@/features/air-wall/components/AirWallSection";
import { biometricName } from "@/lib/platform";
import { useBiometricStatus } from "@/features/biometric/hooks/use-biometric-status";
import { CaptureSection } from "./CaptureSection";
import { ChangeMasterForm } from "./ChangeMasterForm";

export function SecuritySection() {
  const bio = useBiometricStatus();
  const [bioNotice, setBioNotice] = useState("");

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

      <ChangeMasterForm
        className="border-t border-line pt-6"
        onChanged={(result) => {
          if (result.biometricOff) {
            setBioNotice(`${biometricName(bio.status)} was turned off because the vault key changed. Turn it on again above.`);
            bio.refresh();
          }
        }}
      />
    </>
  );
}
