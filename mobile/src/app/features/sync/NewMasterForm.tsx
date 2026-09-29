import { useState } from "react";
import { Key } from "@phosphor-icons/react";
import { Button, ErrorText, Label, TextInput } from "../../components/form";
import { useHost } from "../../host/host-context";

// Another device set a new master password (SYNC.md 3.6): its changes open only with it, typed here
// once (counted like an unlock). A review follows before anything changes. A wrong try comes back with
// an empty field.
export function NewMasterForm({ device, onOpened }: { device: string; onOpened: () => void }) {
  const host = useHost();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0); // a new field per try: it mounts empty

  async function submit() {
    if (!typed || busy) return;
    setBusy(true);
    const result = await host.adoptSyncKey(typed);
    setBusy(false);
    setTyped("");
    if (result.ok) return onOpened();
    setError(result.error);
    setTries((n) => n + 1);
  }

  return (
    <form
      aria-label="New master password"
      className="mt-4 rounded-2xl bg-warn-soft p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="flex items-start gap-2 text-[14px] font-semibold text-warn">
        <Key size={18} weight="fill" className="mt-px shrink-0" />
        {device} has a new master password
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">Type it once to keep syncing. Until then this phone cannot open that device's changes.</p>
      <div className="mt-3">
        <Label text={`Master password set on ${device}`}>
          <TextInput key={tries} type="password" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Label>
      </div>
      <ErrorText message={error} />
      <div className="mt-3 flex justify-end">
        <Button type="submit" variant="primary" disabled={!typed || busy} className={busy ? "shimmer" : ""}>
          Continue
        </Button>
      </div>
    </form>
  );
}
