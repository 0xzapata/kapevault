import { useState, type ReactNode } from "react";
import { Button, Label, TextInput } from "./form";

const quietDanger = "press h-8 shrink-0 rounded-full px-3 text-[12.5px] font-semibold text-danger transition-colors hover:bg-danger-soft focus-ring";

interface ConfirmDeleteProps {
  label?: string;
  // A copy that may be someone's only vault: the confirm also asks for that copy's own master password.
  password?: { label: string; note: ReactNode };
  onConfirm: (password: string) => Promise<void>;
}

// A quiet Delete that asks once more in place: Cancel, then the confirm. Never a native dialog.
// Focus moves to Cancel, the safe choice, because the button that was pressed is gone. Cancel, or a
// confirm that did not delete (the row stays), hands it back to the quiet Delete the same way.
// With a password step the field takes the focus instead, and a confirm that did not delete (most
// likely a wrong password) keeps the step open, the field emptied and focused for another try.
export function ConfirmDelete({ label = "Delete", password, onConfirm }: ConfirmDeleteProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false); // the quiet Delete is back from a confirm: it takes the focus
  const [typed, setTyped] = useState("");
  const [tries, setTries] = useState(0); // a new field per try: it mounts empty and takes the focus

  function back() {
    setConfirming(false);
    setTyped("");
    setAsked(true);
  }

  async function confirm() {
    if (busy || (password && !typed)) return;
    setBusy(true);
    try {
      await onConfirm(typed);
    } finally {
      setBusy(false);
      if (password) {
        setTyped("");
        setTries((n) => n + 1);
      } else {
        back();
      }
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        // biome-ignore lint/a11y/noAutofocus: after Cancel the quiet Delete takes back the focus its confirm step had
        autoFocus={asked}
        className={quietDanger}
        onClick={() => setConfirming(true)}
      >
        {label}
      </button>
    );
  }
  return (
    <>
      {password && (
        <div className="basis-full space-y-1.5">
          <Label text={password.label}>
            <TextInput
              key={tries}
              type="password"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirm();
              }}
            />
          </Label>
          <p className="text-[12.5px] text-ink-3">{password.note}</p>
        </div>
      )}
      <Button type="button" autoFocus={!password} className={`h-8 shrink-0 bg-raised ${password ? "ml-auto" : ""}`} onClick={back}>
        Cancel
      </Button>
      <Button type="button" variant="danger" className="h-8 shrink-0" disabled={busy || (password && !typed)} onClick={confirm}>
        {busy ? "Deleting..." : "Confirm delete"}
      </Button>
    </>
  );
}
