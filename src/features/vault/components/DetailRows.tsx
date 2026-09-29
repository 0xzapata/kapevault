import type { ReactNode } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { vaultApi } from "@/lib/vault-api";
import { useReveal } from "@/hooks/use-reveal";
import { Card, Field } from "@/components/Card";
import { CopyButton } from "@/components/IconButton";
import { Expiry } from "@/components/Expiry";
import { SecretField } from "@/components/SecretField";
import { cardPill } from "@/components/buttons";
import { TotpField } from "@/features/totp/components/TotpField";
import { EntryIcon } from "./EntryIcon";
import { SignInMark } from "./SignInMark";
import { signInOption, usesPassword } from "../lib/sign-in";
import type { Entry, KeyEntry, LoginEntry, NoteEntry } from "../types";

// The detail pane's rows for a login and an API key, and a secure note's card. The other kinds
// keep theirs in their own feature (PayeeRows, ThingRows, DeviceRows, IdRows).

interface RowHelpers {
  copyText: (text: string) => () => Promise<void>;
  openButton: () => ReactNode;
  copyLink: (location: string) => ReactNode;
}

export function LoginRows({ entry, entries, copyText, openButton, copyLink, onReveal }: RowHelpers & { entry: LoginEntry; entries: Entry[]; onReveal: (id: string) => void }) {
  const password = usesPassword(entry.signIn);
  // For an OAuth login: the saved account it signs in through (e.g. the Gmail item).
  const via = entries.find((e) => e.id === entry.viaEntryId);
  const account = via?.kind === "login" ? via : undefined;

  return (
    <>
      {!password && (
        <Field label="Sign in with">
          <span className="flex items-center gap-2 font-medium">
            <SignInMark method={entry.signIn} size={18} />
            {signInOption(entry.signIn).label}
          </span>
        </Field>
      )}
      {!password && (
        <Field
          label="Account"
          actions={
            account && (
              <button
                onClick={() => onReveal(account.id)}
                className="press h-8 rounded-full bg-accent-soft px-3 text-[12.5px] font-semibold text-accent transition-colors hover:bg-accent hover:text-on-accent focus-ring"
              >
                Go to account
              </button>
            )
          }
        >
          {account ? (
            <span className="flex items-center gap-2.5">
              <span className="scale-[0.8]">
                <EntryIcon entry={account} size="sm" />
              </span>
              <span className="truncate">
                {account.title}
                {account.username && <span className="text-ink-3"> - {account.username}</span>}
              </span>
            </span>
          ) : (
            <span className="text-ink-3">Not saved in KAPEVault</span>
          )}
        </Field>
      )}
      <Field
        label={password ? "Username" : "Email used"}
        actions={entry.username && <CopyButton copy={copyText(entry.username)} toastText={password ? "Username copied" : "Email copied"} />}
      >
        {entry.username || <span className="text-ink-3">None</span>}
      </Field>
      {(password || entry.hasPassword) &&
        (entry.hasPassword ? (
          <SecretField
            label="Password"
            reveal={() => vaultApi.getPassword(entry.id)}
            copy={() => vaultApi.copyPassword(entry.id)}
            copyLabel="Copy password (clears in 30s)"
            copiedToast="Password copied - clears in 30s"
          />
        ) : (
          <Field label="Password">
            <span className="text-ink-3">None saved</span>
          </Field>
        ))}
      {entry.hasTotp && <TotpField key={entry.id} entryId={entry.id} />}
      <Field label="Website" actions={entry.url && <>{openButton()}{copyLink(entry.url)}</>}>
        {entry.url ? <span className="text-accent">{entry.url}</span> : <span className="text-ink-3">None</span>}
      </Field>
    </>
  );
}

export function KeyRows({ entry, copyText, openButton, copyLink }: RowHelpers & { entry: KeyEntry }) {
  return (
    <>
      <Field label="Key ID" actions={entry.keyId && <CopyButton copy={copyText(entry.keyId)} toastText="Key ID copied" />}>
        {entry.keyId ? <span className="font-mono text-[13px]">{entry.keyId}</span> : <span className="text-ink-3">None</span>}
      </Field>
      {entry.hasSecret ? (
        <SecretField
          label="Secret"
          reveal={() => vaultApi.getSecret(entry.id, "secret")}
          copy={() => vaultApi.copySecret(entry.id, "secret")}
          copyLabel="Copy secret (clears in 30s)"
          copiedToast="Secret copied - clears in 30s"
        />
      ) : (
        <Field label="Secret">
          <span className="text-ink-3">None saved</span>
        </Field>
      )}
      <Field label="Link" actions={entry.url && <>{openButton()}{copyLink(entry.url)}</>}>
        {entry.url ? <span className="text-accent">{entry.url}</span> : <span className="text-ink-3">None</span>}
      </Field>
      <Field label="Expires">
        <Expiry expires={entry.expires} />
      </Field>
    </>
  );
}

// The body stays in main until asked for; hidden again with one click.
export function NoteCard({ entry }: { entry: NoteEntry }) {
  const { value: body, toggle } = useReveal(() => vaultApi.getSecret(entry.id, "body"));

  return (
    <Card>
      <div className="flex min-h-14 items-center gap-3 px-4 py-2 @md:px-5">
        <span className="flex-1 text-[13px] text-ink-3">Note</span>
        {entry.hasBody && (
          <>
            <button
              onClick={toggle}
              aria-expanded={body !== null}
              aria-controls="note-body"
              className={cardPill}
            >
              {body === null ? <Eye size={14} /> : <EyeSlash size={14} />}
              {body === null ? "Show note" : "Hide note"}
            </button>
            <CopyButton label="Copy note (clears in 30s)" copy={() => vaultApi.copySecret(entry.id, "body")} toastText="Note copied - clears in 30s" />
          </>
        )}
      </div>
      <div id="note-body" className="border-t border-line px-4 py-4 @md:px-5">
        {!entry.hasBody ? (
          <p className="text-[14px] text-ink-3">Empty note</p>
        ) : body === null ? (
          <p className="font-mono text-[14px] tracking-wide text-ink-3">{"•".repeat(18)}</p>
        ) : (
          <p className="selectable swap-in whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{body}</p>
        )}
      </div>
    </Card>
  );
}
