import { useState } from "react";
import { EyeButton, Label, TextInput } from "@/components/form";
import type { useKeyForm } from "../hooks/use-key-form";
import { ExpiresField } from "./ExpiresField";

interface KeyFieldsProps {
  apiKey: ReturnType<typeof useKeyForm>;
  url: string;
  onUrl: (url: string) => void;
}

// The API key part of the item form: key ID, secret, where it is managed, and when it runs out.
export function KeyFields({ apiKey, url, onUrl }: KeyFieldsProps) {
  const { keyId, setKeyId, secret, setSecret, expires, setExpires } = apiKey;
  const [secretShown, setSecretShown] = useState(false);

  return (
    <>
      <Label text="Key ID">
        <TextInput value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="Client ID or access key ID" spellCheck={false} autoComplete="off" className="font-mono" />
      </Label>
      <Label text="Secret">
        <div className="relative">
          <TextInput
            type={secretShown ? "text" : "password"}
            value={secret ?? ""}
            onChange={(e) => setSecret(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="pr-11 font-mono"
          />
          <EyeButton shown={secretShown} what="secret" onClick={() => setSecretShown(!secretShown)} className="absolute right-1.5 top-1/2 -translate-y-1/2" />
        </div>
      </Label>
      <Label text="Link">
        <TextInput value={url} onChange={(e) => onUrl(e.target.value)} placeholder="https://" />
      </Label>
      <ExpiresField value={expires} onChange={setExpires} />
    </>
  );
}
