import { useState, type FormEvent } from "react";
import { Button, ErrorText, Label, TextInput } from "@/components/form";
import type { CloudInput } from "@/lib/vault-api";

interface CredentialsFormProps {
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  error: string;
  onSubmit: (input: CloudInput) => void;
}

// The three things R2 needs. Used in Settings (connect) and on the lock screen (restore).
export function CredentialsForm({ submitLabel, busyLabel, busy, error, onSubmit }: CredentialsFormProps) {
  const [url, setUrl] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");

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
      <ErrorText message={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={busy || !url || !accessKeyId || !secretAccessKey}>
          {busy ? busyLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
