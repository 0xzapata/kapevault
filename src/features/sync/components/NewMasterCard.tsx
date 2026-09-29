import { useState } from "react";
import { Button, ErrorText, Label, TextInput } from "@/components/form";

// Another device set a new master password (SYNC.md 3.6): its changes open only with it, typed here
// once. A wrong try comes back with an empty field, focused again.
export function NewMasterCard({ device, onAdopt }: { device: string; onAdopt: (master: string) => Promise<string> }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0); // a new field per try: it mounts empty and takes the focus

  async function submit() {
    if (!typed || busy) return;
    setBusy(true);
    const problem = await onAdopt(typed).finally(() => setBusy(false));
    setError(problem);
    setTyped("");
    if (problem) setTries((n) => n + 1);
  }

  return (
    <form
      aria-label="New master password"
      className="space-y-2.5 rounded-[12px] bg-warn-soft px-3.5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-[13.5px] font-medium text-ink">{device} has a new master password. Type it once to keep syncing.</p>
      <Label text={`Master password set on ${device}`}>
        <TextInput key={tries} type="password" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
      </Label>
      <ErrorText message={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" className={busy ? "shimmer" : ""} disabled={!typed || busy}>
          Continue
        </Button>
      </div>
    </form>
  );
}
