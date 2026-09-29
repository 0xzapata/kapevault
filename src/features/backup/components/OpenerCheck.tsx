import { useEffect, useState } from "react";
import { MoreOptions } from "@/components/MoreOptions";
import { textLink } from "@/components/buttons";
import { vaultApi } from "@/lib/vault-api";
import { useCopyAction } from "@/hooks/use-copy-action";

// The Opener's fingerprint (SHA-256), folded away: the first 16 digits on screen, the whole code on Copy.
export function OpenerCheck() {
  const [open, setOpen] = useState(false);
  const [hash, setHash] = useState("");
  const { copied, run } = useCopyAction();

  useEffect(() => {
    vaultApi.openerHash().then(setHash, () => {});
  }, []);

  return (
    <MoreOptions open={open} onOpen={() => setOpen(true)} label="Check it's genuine" className="space-y-1.5">
      <p className="text-[12.5px] text-ink-3">This code lets you check an Opener page is the real one.</p>
      <div className="flex items-center gap-3">
        <code className="font-mono text-[13px] tracking-wide text-ink">{hash ? `${hash.slice(0, 8)} ${hash.slice(8, 16)}` : "..."}</code>
        <button
          type="button"
          disabled={!hash}
          onClick={() => run(() => vaultApi.copyText(hash), "Code copied")}
          aria-label={copied ? "Copied" : "Copy the whole code"}
          className={`${textLink} text-accent disabled:opacity-40`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </MoreOptions>
  );
}
