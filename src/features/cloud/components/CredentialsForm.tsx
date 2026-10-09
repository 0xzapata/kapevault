import { useState, type FormEvent } from "react";
import { Button, ErrorText, Label, TextInput } from "@/components/form";
import type { CloudInput } from "@/lib/vault-api";
import { bucketOf } from "../lib/bucket";

interface CredentialsFormProps {
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  error: string;
  onSubmit: (input: CloudInput) => void;
  uploads?: boolean; // Connect uploads the vault at once, so it shows whose bucket first
}

// The three things R2 needs. Used in Settings (connect) and on the lock screen (restore).
export function CredentialsForm({ submitLabel, busyLabel, busy, error, onSubmit, uploads }: CredentialsFormProps) {
  const [url, setUrl] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");

  const place = bucketOf(url);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ url, accessKeyId, secretAccessKey });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Label text="S3 API URL">
        <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://<account-id>.r2.cloudflarestorage.com/<bucket>" spellCheck={false} />
      </Label>
      <div className="grid grid-cols-2 gap-3">
        <Label text="Access key ID">
          <TextInput value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} spellCheck={false} />
        </Label>
        <Label text="Secret access key">
          <TextInput type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} />
        </Label>
      </div>
      <p className="text-[12.5px] text-ink-3">
        In Cloudflare: R2, open the bucket, Settings, copy the S3 API URL. Then Manage API tokens, create one with Object Read &amp; Write on this bucket only.
      </p>
      {uploads && place && (
        <div className="settle space-y-2">
          <div className="divide-y divide-line overflow-hidden rounded-[12px] border border-line">
            {[["Account", place.account], ["Bucket", place.bucket]].map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5 px-3.5 py-2">
                <span className="text-[12px] text-ink-3">{label}</span>
                <span className="font-mono text-[13px] break-all text-ink">{value}</span>
              </div>
            ))}
          </div>
          <p className="text-[12.5px] text-ink-3">Backups go to this bucket. Connect only if it is yours.</p>
        </div>
      )}
      <ErrorText message={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={busy || !url || !accessKeyId || !secretAccessKey}>
          {busy ? busyLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
