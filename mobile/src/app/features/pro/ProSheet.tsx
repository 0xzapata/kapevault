import { useEffect, useState } from "react";
import { ArrowsClockwise, Briefcase, CheckCircle } from "@phosphor-icons/react";
import { Button, ErrorText } from "../../components/form";
import { Point, Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { useHost } from "../../host/host-context";
import { usePro } from "../../hooks/use-vault";

// KAPEVault Pro: what it adds, Google Play's price, Buy and Restore purchase. Opening this sheet asks
// Google Play (host/pro.ts has the full rule): the price and what this account owns.
export function ProSheet({ onClose }: { onClose: () => void }) {
  const host = useHost();
  const toast = useToast();
  const pro = usePro();
  const [busy, setBusy] = useState(true); // Play's first answer, then a Buy or Restore purchase
  const [error, setError] = useState("");

  async function ask(run: () => ReturnType<typeof host.buyPro>) {
    setBusy(true);
    setError("");
    const result = await run();
    setBusy(false);
    if (!result.ok && !("canceled" in result)) setError(result.error);
    return result;
  }

  useEffect(() => {
    void ask(() => host.restorePro());
  }, [host]);

  async function restore() {
    const result = await ask(() => host.restorePro());
    if (result.ok && !result.owned && !result.pending) toast("This Google account has not bought KAPEVault Pro");
  }

  async function buy(close: () => void) {
    const result = await ask(() => host.buyPro());
    if (!result.ok || !result.owned) return;
    toast("KAPEVault Pro is on");
    close();
  }

  const owned = Boolean(pro?.owned);
  return (
    <Sheet
      title="KAPEVault Pro"
      onClose={onClose}
      footer={(close) => (
        <>
          {!owned && (
            <Button variant="primary" disabled={busy || pro?.pending} onClick={() => buy(close)}>
              {pro?.price ? `Buy for ${pro.price}` : "Buy"}
            </Button>
          )}
          <span className="flex-1" />
          <Button onClick={close}>Done</Button>
        </>
      )}
    >
      {() => (
        <>
          <p className="mt-1 text-[13px] text-ink-3">One purchase through Google Play. No account, no subscription.</p>
          <div className="mt-5 space-y-5">
            <Point icon={<ArrowsClockwise size={17} weight="bold" />} title="Sync with your PC">
              Changes on this phone and your PC meet through your own bucket, encrypted.
            </Point>
            <Point icon={<Briefcase size={17} weight="bold" />} title="Client folders">
              Keep each client's logins, keys and links in a folder of their own.
            </Point>
          </div>
          <p className="mt-5 text-[13px] leading-relaxed text-ink-2">Everything else stays free: backup, restore, autofill, fingerprint.</p>
          {owned && (
            <p className="mt-4 flex items-center gap-2 text-[13.5px] font-medium text-ok">
              <CheckCircle size={18} weight="fill" />
              Pro is on for this phone
            </p>
          )}
          {!owned && pro?.pending && <p className="mt-4 text-[13px] leading-relaxed text-ink-2">Your payment is pending. Pro turns on when Google Play confirms it.</p>}
          <div className="mt-3">
            <ErrorText message={owned ? "" : error} />
          </div>
          {!owned && (
            <button type="button" onClick={restore} disabled={busy} className="press hit -ml-1 mt-2 rounded-md px-1 text-[13px] font-medium text-accent focus-ring disabled:opacity-50">
              Restore purchase
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}
