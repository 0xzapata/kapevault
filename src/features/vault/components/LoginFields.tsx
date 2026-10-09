import { useEffect, useRef, useState } from "react";
import { MagicWand } from "@phosphor-icons/react";
import { EyeButton, Label, Select, TextInput } from "@/components/form";
import { fieldIconButton } from "@/components/buttons";
import { useRovingTiles } from "@/hooks/use-roving-tiles";
import { GeneratorPopover } from "@/features/generator/components/GeneratorPopover";
import { StrengthMeter } from "@/features/generator/components/StrengthMeter";
import { TotpInput } from "@/features/totp/components/TotpInput";
import { QuestionsInput } from "@/features/questions/components/QuestionsInput";
import { SignInMark } from "./SignInMark";
import { SIGN_IN_OPTIONS, signInOption, usesPassword } from "../lib/sign-in";
import { accountCandidates } from "../lib/account-candidates";
import type { useLoginForm } from "../hooks/use-login-form";
import type { Entry, LoginEntry } from "../types";

type LoginForm = ReturnType<typeof useLoginForm>;

interface LoginFieldsProps {
  login: LoginForm;
  entries: Entry[]; // for picking the account an OAuth login signs in through
  url: string;
  onUrl: (url: string) => void;
}

const NO_QUESTIONS: LoginEntry["questions"] = []; // stable, so the answer loader runs once

const accountOption = (c: LoginEntry) => (
  <option key={c.id} value={c.id}>
    {c.title}
    {c.username ? ` - ${c.username}` : ""}
  </option>
);

// The login part of the item form: how it signs in, the username, the password (with the generator),
// the website, the 2FA key and the security questions.
export function LoginFields({ login, entries, url, onUrl }: LoginFieldsProps) {
  const { entry, username, setUsername, password, setPassword, signIn, setSignIn, viaEntryId, setViaEntryId } = login;
  const [passwordShown, setPasswordShown] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const passwordBox = useRef<HTMLDivElement>(null);
  const generateButton = useRef<HTMLButtonElement>(null);
  const candidates = accountCandidates(entries, signIn, entry?.id, viaEntryId);
  const signInTile = useRovingTiles(SIGN_IN_OPTIONS.length, SIGN_IN_OPTIONS.findIndex((o) => o.value === signIn), (i) => setSignIn(SIGN_IN_OPTIONS[i].value));
  useEffect(() => login.resetRemounted, [login.resetRemounted]); // the 2FA box and the questions leave with these fields

  function applyGenerated(generated: string) {
    setPassword(generated);
    setPasswordShown(true);
    setGeneratorOpen(false);
    generateButton.current?.focus();
  }

  return (
    <>
      <div>
        <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">Sign in with</span>
        <div role="radiogroup" aria-label="Sign in with" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {SIGN_IN_OPTIONS.map((o, i) => (
            // biome-ignore lint/a11y/useSemanticElements: a radio drawn as a button tile; a native radio input cannot be styled as this control
            <button
              key={o.value}
              {...signInTile(i)}
              type="button"
              role="radio"
              aria-checked={signIn === o.value}
              onClick={() => setSignIn(o.value)}
              className={`press row flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-[9px] border px-1.5 text-[12.5px] font-medium focus-ring ${
                signIn === o.value ? "border-accent bg-accent-soft text-accent" : "border-line bg-raised text-ink-2 hover:bg-hover"
              }`}
            >
              <SignInMark method={o.value} size={14} />
              <span className="truncate whitespace-nowrap">{o.label}</span>
            </button>
          ))}
        </div>
      </div>
      <Label text={usesPassword(signIn) ? "Username or email" : `Email or username on ${signInOption(signIn).label}`}>
        <TextInput value={username} onChange={(e) => setUsername(e.target.value)} />
      </Label>
      {!usesPassword(signIn) && (
        <Label text={`Which ${signInOption(signIn).label} account`}>
          <Select
            value={viaEntryId}
            onChange={(e) => {
              setViaEntryId(e.target.value);
              // The email you sign in with is usually that account's username.
              const account = [...candidates.provider, ...candidates.other].find((c) => c.id === e.target.value);
              if (account && !username.trim()) setUsername(account.username);
            }}
          >
            <option value="">Not saved in KAPEVault</option>
            {candidates.provider.map(accountOption)}
            {candidates.other.length > 0 && <optgroup label="Other saved logins">{candidates.other.map(accountOption)}</optgroup>}
          </Select>
        </Label>
      )}
      {(usesPassword(signIn) || password) && (
        <div>
          <Label text={usesPassword(signIn) ? "Password" : "Password (optional, if the account also has one)"}>
            <div ref={passwordBox} className="relative">
              <TextInput
                type={passwordShown ? "text" : "password"}
                value={password ?? ""}
                onChange={(e) => setPassword(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                className="pr-[72px] font-mono"
              />
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-0.5">
                <button
                  ref={generateButton}
                  type="button"
                  aria-label="Generate password"
                  title="Generate password"
                  aria-expanded={generatorOpen}
                  onClick={() => setGeneratorOpen(!generatorOpen)}
                  className={`${fieldIconButton} ${generatorOpen ? "bg-accent-soft text-accent" : ""}`}
                >
                  <MagicWand size={16} />
                </button>
                <EyeButton shown={passwordShown} what="password" onClick={() => setPasswordShown(!passwordShown)} />
              </div>
            </div>
          </Label>
          <StrengthMeter password={password ?? ""} className="mt-2" />
          {login.replacesPassword && <p className="mt-1.5 text-[12px] text-ink-3">The old password moves to Password history.</p>}
          {generatorOpen && <GeneratorPopover anchor={passwordBox} trigger={generateButton} onUse={applyGenerated} onClose={() => setGeneratorOpen(false)} />}
        </div>
      )}
      <Label text="Website">
        <TextInput value={url} onChange={(e) => onUrl(e.target.value)} placeholder="https://" />
      </Label>
      <TotpInput hasTotp={entry?.hasTotp ?? false} onChange={login.setTotp} />
      <QuestionsInput entryId={entry?.id} saved={entry?.questions ?? NO_QUESTIONS} onChange={login.setQuestions} />
    </>
  );
}
