import { useId, useState } from "react";
import { QrCode, ShieldCheck } from "@phosphor-icons/react";
import { TextInput } from "@/components/form";
import { vaultApi } from "@/lib/vault-api";

// kept = the saved key stays (untouched), removed = save deletes it, edit = the input is showing
type Mode = "kept" | "removed" | "edit";

interface TotpInputProps {
  hasTotp: boolean; // the entry already has a 2FA key
  // undefined = keep what is saved, "" = remove it, text = the new setup key
  onChange: (value: string | undefined) => void;
}

const smallButton =
  "press inline-flex shrink-0 items-center gap-1.5 rounded-full bg-field px-3.5 text-[13px] font-medium hover:bg-line focus-ring disabled:opacity-60";

function foundText(issuer: string, account: string) {
  if (issuer && account) return `Found: ${issuer} (${account})`;
  if (issuer || account) return `Found: ${issuer || account}`;
  return "Found a 2FA code.";
}

export function TotpInput({ hasTotp, onChange }: TotpInputProps) {
  const id = useId();
  const [mode, setMode] = useState<Mode>(hasTotp ? "kept" : "edit");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [found, setFound] = useState("");
  const [scanning, setScanning] = useState(false);

  function update(nextMode: Mode, nextText: string) {
    setMode(nextMode);
    setText(nextText);
    if (nextMode !== "edit") {
      setError("");
      setFound("");
    }
    if (nextMode === "removed") onChange("");
    else if (nextMode === "edit" && nextText.trim()) onChange(nextText);
    else onChange(undefined); // a blank box keeps whatever is saved
  }

  async function validate() {
    const value = text.trim();
    if (!value) {
      setError("");
      return;
    }
    const result = await vaultApi.parseTotp(value);
    setError(result.ok ? "" : result.error);
  }

  async function scan() {
    setScanning(true);
    setError("");
    setFound("");
    try {
      const result = await vaultApi.scanQr();
      if (result.ok) {
        update("edit", result.uri);
        setFound(foundText(result.issuer, result.account));
      } else {
        setError(result.error);
      }
    } catch {
      setError("Could not read the screen. Paste the setup key instead.");
    } finally {
      setScanning(false);
    }
  }

  if (mode !== "edit") {
    const removed = mode === "removed";
    return (
      <div>
        <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">2FA</span>
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-raised py-2 pl-3 pr-2">
          <ShieldCheck size={18} weight={removed ? "regular" : "fill"} className={`shrink-0 ${removed ? "text-ink-3" : "text-ok"}`} />
          <span className={`min-w-0 flex-1 text-[13.5px] ${removed ? "text-ink-3" : "text-ink"}`}>{removed ? "2FA code will be removed when you save." : "2FA code is set up"}</span>
          {removed ? (
            <button type="button" onClick={() => update("kept", "")} className={`${smallButton} h-8 text-ink`}>
              Undo
            </button>
          ) : (
            <>
              <button type="button" onClick={() => update("edit", "")} className={`${smallButton} h-8 text-ink`}>
                Replace
              </button>
              <button type="button" onClick={() => update("removed", "")} className={`${smallButton} h-8 text-danger`}>
                Remove
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-medium text-ink-2">
        2FA setup key
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          id={id}
          value={text}
          // Replace mounts this box on click, so it takes focus; a new login does not.
          autoFocus={hasTotp}
          onChange={(e) => {
            update("edit", e.target.value);
            setError("");
            setFound("");
          }}
          onBlur={validate}
          placeholder="Setup key or otpauth:// link"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-help`}
          className="min-w-0 flex-1 basis-[180px] font-mono"
        />
        <button type="button" onClick={scan} disabled={scanning} aria-busy={scanning} className={`${smallButton} h-10 text-ink`}>
          <QrCode size={16} />
          {scanning ? "Scanning..." : "Scan QR code"}
        </button>
      </div>
      <div id={`${id}-help`} className="mt-1.5 space-y-1">
        {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
        {found && !error && <p className="text-[12.5px] text-ok">{found}</p>}
        <p className="text-[12px] text-ink-3">Saving the 2FA key here means this vault holds both sign-in factors.</p>
        {hasTotp && (
          <button type="button" onClick={() => update("kept", "")} className="rounded text-[12.5px] font-medium text-accent focus-ring">
            Keep the current 2FA code
          </button>
        )}
      </div>
    </div>
  );
}
