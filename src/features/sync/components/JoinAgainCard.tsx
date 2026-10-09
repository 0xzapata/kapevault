import { useState } from "react";
import { Button, ErrorText, Label, TextInput } from "@/components/form";

// This device was removed from sync (SYNC.md 3.9). The owner who trusts it again types the vault's master
// password once; the engine proves it on the vault file and the device joins like a new one. A wrong try
// comes back with an empty field, focused again.
export function JoinAgainCard({ onJoin }: { onJoin: (master: string) => Promise<string> }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0); // a new field per try: it mounts empty and takes the focus

  async function submit() {
    if (!typed || busy) return;
    setBusy(true);
    const problem = await onJoin(typed).finally(() => setBusy(false));
    setError(problem);
    setTyped("");
    if (problem) setTries((n) => n + 1);
  }

  return (
    <form
      aria-label="Join again"
      className="space-y-2.5 rounded-[12px] bg-warn-soft px-3.5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-[13.5px] font-medium text-ink">This device was removed from sync. Type this vault's master password to join again.</p>
      <Label text="Master password">
        <TextInput key={tries} type="password" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
      </Label>
      <ErrorText message={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" className={busy ? "shimmer" : ""} disabled={!typed || busy}>
          Join again
        </Button>
      </div>
    </form>
  );
}
