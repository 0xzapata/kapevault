import { useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { Button } from "../../components/form";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { autofill, type FillTarget } from "../../host/autofill";
import { useHost } from "../../host/host-context";
import { useVault } from "../../hooks/use-vault";
import { filterEntries } from "../../lib/filter";
import { EntryRow } from "../home/EntryRow";
import { matchesTarget, mismatchWarning, searchHint, targetSite } from "./match";
import type { LoginEntry } from "../../host/types";

const groupTitle = "px-2.5 pb-1 pt-3 text-[12.5px] font-semibold text-ink-3";

// Autofill's picker, over the unlocked vault: "Fill <site>" for a checked browser, the logins saved for
// that site or app first (match.ts), then every login, with search. Another app is named by its package,
// which it cannot fake, never by its name, which it can; its name only fills the search box as a hint. A pick fetches that login's password (the one secret it needs) and hands both to Android,
// which fills the other app; the vault goes to the background. Cancel, Back or the scrim fill nothing.
export function FillPicker({ target }: { target: FillTarget }) {
  const host = useHost();
  const toast = useToast();
  const view = useVault();
  const [typed, setQuery] = useState<string | null>(null); // null: the hint, until the user types
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<LoginEntry | null>(null); // a login that is not for this app or site, waiting for a yes
  const site = targetSite(target);
  const hint = useMemo(() => (view ? searchHint(view.entries.filter((e): e is LoginEntry => e.kind === "login"), target) : ""), [view, target]);
  const query = typed ?? hint;

  const logins = useMemo(() => {
    if (!view) return null;
    const all = filterEntries(view.entries, view.spaces, { view: "login" }, query, "recent") as LoginEntry[];
    const usable = all.filter((e) => e.username || e.hasPassword);
    return { suggested: usable.filter((e) => matchesTarget(e, target)), others: usable.filter((e) => !matchesTarget(e, target)) };
  }, [view, query, target]);

  // A login saved for another site or app is never filled on one tap: the app asking can be a look-alike.
  function choose(id: string) {
    const entry = logins && [...logins.suggested, ...logins.others].find((e) => e.id === id);
    if (!entry || busy) return;
    if (matchesTarget(entry, target)) void pick(entry);
    else setAsking(entry);
  }

  async function pick(entry: LoginEntry) {
    const id = entry.id;
    if (busy) return;
    setBusy(true);
    try {
      const password = target.password && entry.hasPassword ? await host.getSecret(id, "password") : "";
      if (!password && !(target.username && entry.username)) {
        toast(target.password ? "This login has no password saved." : "This login has no username saved.", "error");
        return;
      }
      await autofill.fill(target, target.username ? entry.username : "", password);
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "Could not fill it. Try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  const rows = (list: LoginEntry[]) => (
    // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA in HTML allows role listbox on a ul
    <ul role="listbox" aria-label="Logins">
      {list.map((e) => (
        <EntryRow key={e.id} entry={e} selected={false} issues={false} onOpen={choose} />
      ))}
    </ul>
  );

  return (
    <Sheet
      title={site ? `Fill ${site}` : "Pick a login"}
      tall
      onClose={() => void autofill.cancel()}
      footer={(close) =>
        asking ? (
          <>
            <span className="flex-1" />
            <Button onClick={() => setAsking(null)}>Back</Button>
            <Button variant="primary" disabled={busy} onClick={() => void pick(asking)}>
              Fill anyway
            </Button>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">{site ? `In ${target.appLabel}` : ""}</span>
            <Button onClick={close}>Cancel</Button>
          </>
        )
      }
    >
      {() =>
        asking ? (
          <p role="alert" className="mt-4 text-[14px] leading-relaxed text-ink-2">
            {mismatchWarning(asking, target)}
          </p>
        ) : (
          <div className="mt-4 flex flex-col">
            {!site && (
              <p className="mb-2 truncate px-0.5 text-[12.5px] text-ink-3">
                Asked by <span className="font-mono text-ink-2">{target.packageName}</span>
              </p>
            )}
            <label className="hit mb-1 flex h-8 shrink-0 items-center gap-2 rounded-[8px] bg-field px-2.5 text-ink-3 focus-within:bg-raised focus-within:outline-2 focus-within:outline-accent focus-within:ring-4 focus-within:ring-accent-soft">
              <MagnifyingGlass size={14} className="shrink-0" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search logins"
                aria-label="Search logins"
                autoComplete="off"
                className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
              />
            </label>
            {logins && logins.suggested.length > 0 && (
              <>
                <p className={groupTitle}>{site ? `For ${site}` : "For this app"}</p>
                {rows(logins.suggested)}
              </>
            )}
            {logins && logins.others.length > 0 && (
              <>
                <p className={groupTitle}>{logins.suggested.length > 0 ? "Other logins" : "All logins"}</p>
                {rows(logins.others)}
              </>
            )}
            {logins && logins.suggested.length + logins.others.length === 0 && (
              <p className="px-2 py-10 text-center text-[13px] text-ink-3">{query ? `Nothing matches "${query}".` : "No logins saved yet."}</p>
            )}
          </div>
        )
      }
    </Sheet>
  );
}
