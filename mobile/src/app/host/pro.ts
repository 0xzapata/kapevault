// KAPEVault Pro, a one-time Google Play purchase: this phone syncs with the other devices, and new items
// go into client folders. Everything else stays free (backup, restore, autofill, fingerprint). This file
// is the one place for that rule; the purchase itself is Google Play's (BillingPlugin.kt).
// pro.json beside settings.json keeps what Play last said, so Pro works offline. It is this phone's alone:
// never in the vault, never synced. Play is asked only after the user touched Pro (the Pro sheet, Buy,
// Restore purchase), or while pro.json says this install bought Pro or waits on a payment - a phone that
// never opened the Pro sheet never contacts Play. After a reinstall, Restore purchase brings Pro back.
import type { ProStatus, Result, Space } from "./types";
import type { Store } from "./storage";

const FILE = "pro.json";
const UNAVAILABLE = "Google Play is not on this phone, or not signed in. Pro is bought through Google Play.";
const FAILED = "Google Play did not answer. Try again.";
const NOT_IN_BUILD = "Pro is not available in this build of KAPEVault.";
export const CLIENTS_ARE_PRO = "Client folders are part of KAPEVault Pro.";

interface ProCache {
  owned: boolean;
  pending: boolean; // bought, the payment not through yet
}

// The Billing plugin (BillingPlugin.kt). Rejects with a code: unavailable (no Play Store, not signed in,
// the product not offered), canceled (closed the Play sheet), failed. The foss build has no Play Billing:
// its plugin has no methods, and Capacitor rejects with UNIMPLEMENTED.
export interface Billing {
  status(): Promise<{ owned: boolean; pending: boolean; price?: string }>;
  buy(): Promise<{ owned: boolean; pending: boolean }>;
}

type Answer = { ok: true; owned: boolean; pending: boolean } | { ok: false };

export const syncAllowed = (pro: boolean) => pro;
// A phone without Pro names its snapshots backup-only: every device restores them, none merges them.
export const snapshotNote = (pro: boolean) => (pro ? "" : "backup-only");
export const canAddClient = (pro: boolean) => pro;

// A save (the input) into the vault (data): without Pro an item goes to Personal, or stays in the client
// folder it is already in.
export function canPlaceIn(pro: boolean, data: { spaces: Pick<Space, "id" | "kind">[]; entries: { id: string; spaceId: string }[] }, input: { id?: string; spaceId: string }) {
  if (pro || data.spaces.some((s) => s.id === input.spaceId && s.kind === "personal")) return true;
  return input.id !== undefined && data.entries.some((e) => e.id === input.id && e.spaceId === input.spaceId);
}

// What Play answered decides: not owned after an answer is a refund or a payment that never came, and Pro
// goes. No answer (offline, Play busy) keeps what was kept.
export function nextEntitlement(cached: ProCache, answer: Answer): ProCache {
  return answer.ok ? { owned: answer.owned, pending: !answer.owned && answer.pending } : cached;
}

// Whether Play may be asked without the user touching Pro: only once this install bought it or waits on a payment.
export const shouldQuery = (cache: ProCache) => cache.owned || cache.pending;

const codeOf = (e: unknown) => (e as { code?: string })?.code;
const words = (e: unknown) => (codeOf(e) === "UNIMPLEMENTED" ? NOT_IN_BUILD : codeOf(e) === "unavailable" ? UNAVAILABLE : FAILED);

// onChange: after every answer kept; flipped when Pro itself came or went (the one place that decides it).
export function createPro({ store, billing, onChange }: { store: Store; billing?: Billing; onChange: (flipped: boolean) => void }) {
  let cache: ProCache = { owned: false, pending: false };
  let price: string | undefined; // Play's, in the phone's currency, once asked
  let kept = 0; // counts keep(): a status asked before a newer answer was kept is stale

  const status = (): ProStatus => ({ ...cache, price });

  async function keep(next: ProCache) {
    kept++;
    const flipped = next.owned !== cache.owned;
    const changed = flipped || next.pending !== cache.pending;
    cache = next;
    // A fresh install that only looked at the sheet writes nothing, so it never asks Play by itself.
    if (changed) await store.write(FILE, JSON.stringify(cache)).catch(() => {}); // kept in memory for this run
    onChange(flipped);
  }

  // A buy that answered while this ask waited wins: the ask then only brings the price.
  async function ask(): Promise<Result<ProStatus>> {
    if (!billing) return { ok: false, error: UNAVAILABLE };
    try {
      const before = kept;
      const answer = await billing.status();
      price = answer.price ?? price;
      if (kept === before) await keep(nextEntitlement(cache, { ok: true, owned: answer.owned, pending: answer.pending }));
      return { ok: true, ...status() };
    } catch (e) {
      return { ok: false, error: words(e) };
    }
  }

  return {
    get owned() {
      return cache.owned;
    },
    status,
    // On start: what pro.json kept, then Play's answer when this install bought Pro or waits on a payment.
    async load() {
      try {
        const saved = JSON.parse((await store.read(FILE)) ?? "null");
        cache = { owned: saved?.owned === true, pending: saved?.pending === true };
      } catch {
        // damaged: without Pro until Play says otherwise (Restore purchase)
      }
      if (shouldQuery(cache)) void ask();
    },
    // Back on screen: a refund or a payment that came through meanwhile.
    resumed() {
      if (shouldQuery(cache)) void ask();
    },
    // The Pro sheet opened, or Restore purchase: the price, and whether this Google account owns Pro.
    ask,
    async buy(): Promise<Result<ProStatus> | { ok: false; canceled: true; error: string }> {
      if (!billing) return { ok: false, error: UNAVAILABLE };
      try {
        const answer = await billing.buy();
        await keep(nextEntitlement(cache, { ok: true, ...answer }));
        return { ok: true, ...status() };
      } catch (e) {
        if (codeOf(e) === "canceled") return { ok: false, canceled: true, error: "" };
        return { ok: false, error: words(e) };
      }
    },
  };
}
