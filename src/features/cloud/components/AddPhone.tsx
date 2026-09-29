import { useEffect, useState } from "react";
import { DeviceMobile } from "@phosphor-icons/react";
import { Button, ErrorText } from "@/components/form";
import { vaultApi, type PhoneCode } from "@/lib/vault-api";

// Settings > Backup: the R2 keys as a QR code, for KAPEVault on a phone to scan on its first run. The
// code holds the secret key, so main sends it only on this click; it goes after `seconds`, on Hide,
// and whenever this leaves the screen (Settings closed, the vault locked).
export function AddPhone() {
  const [code, setCode] = useState<PhoneCode | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!code) return;
    const timer = setTimeout(() => setCode(null), code.seconds * 1000);
    return () => clearTimeout(timer);
  }, [code]);

  async function show() {
    setError("");
    const result = await vaultApi.cloudPhoneCode();
    if (result.ok) setCode({ size: result.size, path: result.path, seconds: result.seconds });
    else setError(result.error);
  }

  if (code) {
    const side = code.size + 8; // a 4-module quiet zone all round
    return (
      <div className="settle flex flex-col items-center gap-3 rounded-[12px] bg-field px-3.5 py-4">
        <svg role="img" aria-label="Code for your phone" viewBox={`-4 -4 ${side} ${side}`} shapeRendering="crispEdges" className="size-56 rounded-[8px] bg-paper fill-stage">
          <path d={code.path} />
        </svg>
        <p className="max-w-[320px] text-center text-[12.5px] text-ink-2">This code holds your R2 keys, so it shows only here and hides after a minute.</p>
        <Button type="button" className="h-8 bg-raised" onClick={() => setCode(null)}>
          Hide code
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-[12px] bg-field px-3.5 py-3">
        <DeviceMobile size={22} weight="duotone" className="shrink-0 text-accent" />
        <p className="min-w-0 flex-1 text-[12.5px] text-ink-3">Set up KAPEVault on your phone by scanning a code.</p>
        <Button type="button" className="h-8 shrink-0 bg-raised" onClick={show}>
          Add a phone
        </Button>
      </div>
      <ErrorText message={error} />
    </div>
  );
}
