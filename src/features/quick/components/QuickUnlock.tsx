import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Fingerprint } from "@phosphor-icons/react";
import { vaultApi } from "@/lib/vault-api";
import { AppIcon } from "@/components/AppIcon";
import { UNLOCK_FAILED, useUnlock } from "@/features/lock/hooks/use-unlock";
import type { VaultView } from "@/features/vault/types";

interface QuickUnlockProps {
  shown: number; // bumps each time the window is summoned
  onOpen: (vault: VaultView) => void;
}

// Unlock inside the quick window: master password, or Windows Hello / Touch ID when it is on.
export function QuickUnlock({ shown, onOpen }: QuickUnlockProps) {
  const [master, setMaster] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // The biometric status is read each time the window is summoned, not once.
  const unlock = useUnlock(onOpen, false);
  const { error, failures, bio } = unlock;
  const busy = unlock.busy || unlock.bioBusy; // one attempt at a time

  useEffect(() => {
    inputRef.current?.focus();
    bio.refresh();
  }, [shown]);

  // A half-typed master password is dropped the moment main hides this window - never kept hidden.
  useEffect(() => vaultApi.onQuickHidden(() => setMaster("")), []);

  // A failed try empties the field and puts the focus back in it.
  function retry(failed: boolean) {
    if (!failed) return;
    setMaster("");
    inputRef.current?.focus();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!master || busy) return;
    const failed = await unlock.withMaster(() => vaultApi.unlock(master));
    retry(failed);
  }

  async function unlockBio() {
    if (busy) return;
    const failed = await unlock.withBiometric(UNLOCK_FAILED);
    retry(failed);
  }

  return (
    <form
      onSubmit={submit}
      className="settle flex h-full flex-col items-center justify-center px-8 text-center"
    >
      <AppIcon size={56} />
      <h1 className="mt-3.5 text-[17px] font-semibold tracking-[-0.01em]">KAPEVault is locked</h1>
      <p className="mt-1 text-[13px] text-ink-2">Unlock to search your vault</p>

      <div
        key={failures}
        className={`mt-5 flex h-11 w-[320px] items-center rounded-full bg-field pl-5 pr-1.5 focus-within:outline-2 focus-within:outline-accent focus-within:ring-4 focus-within:ring-accent-soft ${failures ? "shake" : ""}`}
      >
        <input
          ref={inputRef}
          type="password"
          aria-label="Master password"
          placeholder="Master password"
          value={master}
          onChange={(e) => setMaster(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-ink-3"
        />
        <button
          type="submit"
          aria-label={busy ? "Unlocking" : "Unlock"}
          disabled={busy || !master}
          className="press grid size-8 place-items-center rounded-full bg-accent text-on-accent transition-opacity disabled:opacity-35"
        >
          <ArrowRight size={16} weight="bold" />
        </button>
      </div>

      <p role="alert" className="mt-3 min-h-[18px] max-w-[360px] text-[12.5px] text-danger">
        {error}
      </p>

      {unlock.canUseBio && (
        <button
          type="button"
          onClick={unlockBio}
          disabled={busy}
          className="press mt-2 flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium text-accent hover:bg-accent-soft disabled:opacity-50"
        >
          <Fingerprint size={17} weight="bold" />
          Unlock with {unlock.bioName}
        </button>
      )}
    </form>
  );
}
