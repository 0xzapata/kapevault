import { useState } from "react";
import { Camera } from "@phosphor-icons/react";
import { parseTotp } from "@core";
import { Button, Label, Select, TextInput } from "../../components/form";
import { SignInMark } from "../../components/icons";
import { useHost } from "../../host/host-context";
import { signInLabel } from "../../lib/entries";
import { SIGN_IN_OPTIONS } from "../../lib/sign-in";
import { SecretInput, StrengthMeter } from "./inputs";
import { LogoField } from "./pickers";
import type { Draft, SetDraft } from "./use-item-form";
import type { Entry, LoginEntry } from "../../host/types";

// The login part of the form: how it signs in, the username, the password, the website, the 2FA key.
export function LoginFields({ draft, set, entry, entries }: { draft: Draft; set: SetDraft; entry: LoginEntry | null; entries: Entry[] }) {
  const password = draft.signIn === "password";
  const accounts = entries.filter((e): e is LoginEntry => e.kind === "login" && e.id !== entry?.id);
  return (
    <>
      <div>
        <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">Sign in with</span>
        <div role="radiogroup" aria-label="Sign in with" className="grid grid-cols-2 gap-1.5">
          {SIGN_IN_OPTIONS.map((o) => {
            const on = draft.signIn === o.value;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a radio drawn as a button tile; a native radio input cannot be styled as this control
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set("signIn", o.value)}
                className={`press flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-[10px] border px-1.5 text-[13px] font-medium focus-ring ${on ? "border-accent bg-accent-soft text-accent" : "border-line bg-raised text-ink"}`}
              >
                <SignInMark method={o.value} size={14} />
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <Label text={password ? "Username or email" : `Email or username on ${signInLabel(draft.signIn)}`}>
        <TextInput value={draft.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" autoCapitalize="none" inputMode="email" />
      </Label>
      {!password && (
        <Label text={`Which ${signInLabel(draft.signIn)} account`}>
          <Select value={draft.viaEntryId} onChange={(e) => set("viaEntryId", e.target.value)}>
            <option value="">Not saved in KAPEVault</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
                {a.username ? ` - ${a.username}` : ""}
              </option>
            ))}
          </Select>
        </Label>
      )}
      {(password || draft.password) && (
        <div>
          <SecretInput label={password ? "Password" : "Password (optional)"} value={draft.password} onChange={(v) => set("password", v)} generator />
          <StrengthMeter password={draft.password ?? ""} />
        </div>
      )}
      <Label text="Website">
        <TextInput value={draft.url} onChange={(e) => set("url", e.target.value)} placeholder="github.com" inputMode="url" autoCapitalize="none" autoComplete="off" />
      </Label>
      <TotpInput value={draft.totp} hasTotp={entry?.hasTotp ?? false} onChange={(v) => set("totp", v)} />
      <LogoField draft={draft} set={set} />
    </>
  );
}

// The 2FA setup key: pasted, or read off the site's QR code with the camera.
function TotpInput({ value, hasTotp, onChange }: { value: string | undefined; hasTotp: boolean; onChange: (v: string | undefined) => void }) {
  const host = useHost();
  const [note, setNote] = useState("");
  let error = "";
  if (value) {
    try {
      parseTotp(value);
    } catch (e) {
      error = e instanceof Error ? e.message : "That is not a valid 2FA setup key.";
    }
  }
  async function scan() {
    setNote("");
    const result = await host.scanQr("totp");
    if (result.ok) onChange(result.text);
    else if (!("canceled" in result)) setNote(result.error);
  }
  const removed = hasTotp && value === "";
  return (
    <div className="flex flex-col gap-2">
      <Label text="2FA setup key">
        <TextInput
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || (hasTotp ? undefined : ""))}
          placeholder={removed ? "Removed when you save" : hasTotp ? "Saved - paste a new key to replace it" : "Paste the key"}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          className="font-mono"
        />
      </Label>
      {(error || note) && <p className="text-[12.5px] text-danger">{error || note}</p>}
      <div className="flex gap-2">
        <Button onClick={scan}>
          <Camera size={16} />
          Scan QR code
        </Button>
        {hasTotp && !removed && (
          <Button variant="danger" onClick={() => onChange("")}>
            Remove 2FA
          </Button>
        )}
      </div>
    </div>
  );
}
