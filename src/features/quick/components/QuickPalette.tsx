import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { vaultApi } from "@/lib/vault-api";
import { modPressed } from "@/lib/platform";
import { filterEntries } from "@/features/vault/lib/filter-entries";
import { ipcMessage } from "@/lib/ipc-message";
import type { Entry, VaultView } from "@/features/vault/types";
import { footerHints, quickActions, runQuickAction, type QuickActionId } from "../lib/quick-actions";
import { QuickRow, ROW_HEIGHT, optionId } from "./QuickRow";
import { QuickFooter, type Feedback } from "./QuickFooter";

const MAX_RESULTS = 50;
const CONFIRM_MS = 350; // long enough to read "Password copied", short enough to paste straight away
const LIST_ID = "quick-results";

// Alt beats mod beats Shift, so a stray extra modifier never copies the wrong thing silently.
function enterAction(e: KeyboardEvent): QuickActionId {
  if (e.altKey) return "show";
  if (modPressed(e)) return "totp";
  if (e.shiftKey) return "secondary";
  return "primary";
}

interface QuickPaletteProps {
  vault: VaultView;
  shown: number; // bumps each time the window is summoned
}

export function QuickPalette({ vault, shown }: QuickPaletteProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const busy = useRef(false); // one action at a time; the window is about to hide anyway
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const feedbackId = useRef(0);

  // Empty query = recently used first: the item you want is usually the one you used last.
  const results = useMemo(
    () => filterEntries({ entries: vault.entries, spaces: vault.spaces, view: "all", spaceId: null, query, sort: "recent" }).slice(0, MAX_RESULTS),
    [vault, query],
  );
  const spaceNames = useMemo(() => new Map(vault.spaces.map((s) => [s.id, s.name])), [vault.spaces]);
  const active = Math.min(index, results.length - 1); // -1 when nothing matches
  const selected: Entry | undefined = results[active];
  const actions = selected ? quickActions(selected) : [];

  // Every summon: top of the list, the last query kept and selected so typing replaces it.
  useEffect(() => {
    clearTimeout(timer.current);
    busy.current = false;
    setIndex(0);
    setFeedback(null);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [shown]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const activeId = selected ? optionId(selected.id) : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const say = (tone: Feedback["tone"], text: string) => setFeedback({ id: ++feedbackId.current, tone, text });

  function hide() {
    vaultApi.quickHide().finally(() => {
      busy.current = false;
      setFeedback(null); // gone before the next summon paints
    });
  }

  function changeQuery(next: string) {
    setQuery(next);
    setIndex(0);
    if (feedback?.tone === "error") setFeedback(null);
  }

  async function run(id: QuickActionId, entry: Entry | undefined = selected) {
    const action = entry && quickActions(entry).find((a) => a.id === id);
    if (!entry || !action || busy.current) return;
    busy.current = true;
    try {
      if (id === "show") {
        await vaultApi.quickShowInMain(entry.id); // main hides this window
        busy.current = false;
        return;
      }
      const text = await runQuickAction(entry, id);
      if (text === null) {
        busy.current = false;
        return;
      }
      if (action.opens) return hide();
      say("ok", text);
      timer.current = setTimeout(hide, CONFIRM_MS); // then you are back in your app, ready to paste
    } catch (e) {
      busy.current = false;
      say("error", ipcMessage(e));
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    const n = results.length;
    const page = Math.max(1, Math.floor((listRef.current?.clientHeight ?? 0) / ROW_HEIGHT) - 1);
    let to: number | null = null;
    switch (e.key) {
      case "ArrowDown":
        to = (active + 1) % n;
        break;
      case "ArrowUp":
        to = (active - 1 + n) % n;
        break;
      case "PageDown":
        to = Math.min(active + page, n - 1);
        break;
      case "PageUp":
        to = Math.max(active - page, 0);
        break;
      case "Home":
        if (!query) to = 0; // with a query, Home / End move the caret in the field
        break;
      case "End":
        if (!query) to = n - 1;
        break;
      case "Enter":
        e.preventDefault();
        run(enterAction(e));
        return;
      case "Escape":
        // A query clears first; an empty field lets Escape through to QuickSearch, which hides.
        if (query) {
          e.preventDefault();
          changeQuery("");
        }
        return;
      default:
        if (modPressed(e) && e.key.toLowerCase() === "o") {
          e.preventDefault();
          run("open");
        }
        return;
    }
    if (to === null || n === 0) return;
    e.preventDefault();
    setIndex(to);
    if (feedback?.tone === "error") setFeedback(null);
  }

  let empty: { title: string; hint: string } | null = null;
  if (vault.entries.length === 0) empty = { title: "Your vault is empty", hint: "Add items in KAPEVault and they show up here." };
  else if (results.length === 0) empty = { title: `No matches for "${query.trim()}"`, hint: "Try a client name, a site, or a username." };

  return (
    // Clicks anywhere keep the caret in the search field, so the keys keep working.
    // biome-ignore lint/a11y/noStaticElementInteractions: a click anywhere keeps the caret in the search field so the keys keep working; this wrapper is not a control
    <div
      className="flex h-full flex-col"
      onMouseDown={(e) => {
        if (e.target !== inputRef.current) e.preventDefault();
      }}
    >
      <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line px-5">
        <MagnifyingGlass size={22} weight="bold" className="shrink-0 text-ink-3" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Search KAPEVault"
          aria-expanded={results.length > 0}
          aria-controls={LIST_ID}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          placeholder="Search KAPEVault"
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-[20px] tracking-[-0.01em] text-ink outline-none placeholder:text-ink-3"
        />
      </div>

      <div className="settle relative min-h-0 flex-1">
        {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA in HTML allows role listbox on a ul */}
        <ul ref={listRef} id={LIST_ID} role="listbox" aria-label="Results" className="h-full overflow-y-auto px-2 py-1.5">
          {results.map((entry, i) => (
            <QuickRow
              key={entry.id}
              entry={entry}
              spaceName={spaceNames.get(entry.spaceId) ?? ""}
              selected={i === active}
              onRun={() => {
                setIndex(i);
                run("primary", entry);
              }}
            />
          ))}
        </ul>
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
            <p className="max-w-full truncate text-[15px] font-semibold text-ink-2">{empty.title}</p>
            <p className="mt-1 text-[13px] text-ink-3">{empty.hint}</p>
          </div>
        )}
      </div>

      <QuickFooter hints={footerHints(actions)} feedback={feedback} />
    </div>
  );
}
