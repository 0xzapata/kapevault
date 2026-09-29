import { useEffect, useState } from "react";
import { Button } from "../../components/form";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { autofill, type AutofillStatus } from "../../host/autofill";

// Whether KAPEVault is the phone's autofill service. Read again when the app comes back to the front:
// it can be changed in Android's Settings at any time.
export function useAutofillStatus() {
  const [status, setStatus] = useState<AutofillStatus | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => void autofill.status().then((s) => live && setStatus(s), () => {});
    read();
    window.addEventListener("kapevault:resume", read);
    return () => {
      live = false;
      window.removeEventListener("kapevault:resume", read);
    };
  }, []);
  return [status, setStatus] as const;
}

export const autofillValue = (status: AutofillStatus | null) => (!status ? "" : !status.supported ? "Not on this phone" : status.enabled ? "On" : "Off");

// Autofill is on: what it does, and Turn off. (Turning it on is Android's own screen.)
export function AutofillSheet({ onStatus, onClose }: { onStatus: (s: AutofillStatus) => void; onClose: () => void }) {
  const toast = useToast();

  async function turnOff(close: () => void) {
    onStatus(await autofill.disable());
    toast("Autofill is off");
    close();
  }

  return (
    <Sheet
      title="Autofill"
      onClose={onClose}
      footer={(close) => (
        <>
          <Button variant="danger" onClick={() => void turnOff(close)}>
            Turn off
          </Button>
          <span className="flex-1" />
          <Button onClick={close}>Done</Button>
        </>
      )}
    >
      {() => <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">Sign-in screens in other apps and browsers offer Fill from KAPEVault. You pick the login after you unlock.</p>}
    </Sheet>
  );
}
