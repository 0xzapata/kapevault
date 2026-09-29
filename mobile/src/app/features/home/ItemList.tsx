import { useState, type ReactNode } from "react";
import { ArrowsDownUp, MagnifyingGlass, Plus, SidebarSimple } from "@phosphor-icons/react";
import { barIcon } from "../../components/buttons";
import { issueSummary } from "../../lib/entries";
import { SORT_LABELS, type SortOrder } from "../../lib/filter";
import { EntryRow } from "./EntryRow";
import { SortMenu } from "./SortMenu";
import type { Entry } from "../../host/types";

interface ItemListProps {
  title: string;
  entries: Entry[] | null; // null while the vault loads
  issuesView: boolean; // the Security list: issue lines and a summary count
  query: string;
  sort: SortOrder;
  selectedId: string | null;
  syncLine?: ReactNode;
  onQuery: (q: string) => void;
  onSort: (s: SortOrder) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDrawer: () => void;
}

// The PC compact list: toolbar, large title, count line, grey search, the white card of rows.
export function ItemList({ title, entries, issuesView, query, sort, selectedId, syncLine, onQuery, onSort, onOpen, onNew, onDrawer }: ItemListProps) {
  const [sorting, setSorting] = useState(false);
  const n = entries?.length ?? 0;
  const security = issuesView && !query;
  let count = `${n} ${query ? (n === 1 ? "match" : "matches") : n === 1 ? "item" : "items"} · ${query ? "Best first" : SORT_LABELS[sort]}`;
  if (security) count = n ? `${n} ${n === 1 ? "item needs" : "items need"} attention: ${issueSummary(entries ?? [])}` : "Nothing to fix. Every password is unique, strong and fresh.";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-0.5 px-1.5">
        <button type="button" aria-label="Show sidebar" onClick={onDrawer} className={barIcon}>
          <SidebarSimple size={17} />
        </button>
        <span className="flex-1" />
        <button type="button" aria-label={`Sort by: ${SORT_LABELS[sort]}`} onClick={() => setSorting(true)} className={barIcon}>
          <ArrowsDownUp size={16} />
        </button>
        <button type="button" aria-label="New" onClick={onNew} className={barIcon}>
          <Plus size={17} />
        </button>
      </div>

      <h1 className="truncate px-5 text-[26px] font-bold leading-[1.15] tracking-[-0.025em]">{query ? "Results" : title}</h1>
      <p className="track-small truncate px-5 pb-3 pt-0.5 text-[12.5px] tabular-nums text-ink-3">{entries ? count : " "}</p>
      {syncLine}

      <label className="hit mx-3 mb-2.5 flex h-8 shrink-0 items-center gap-2 rounded-[8px] bg-field px-2.5 text-ink-3 focus-within:bg-raised focus-within:outline-2 focus-within:outline-accent focus-within:ring-4 focus-within:ring-accent-soft">
        <MagnifyingGlass size={14} className="shrink-0" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search logins, links, clients"
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
        />
      </label>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
        <div className="mx-2.5 rounded-2xl border border-line bg-raised p-1 shadow-card">
          {entries === null ? (
            <Skeleton />
          ) : (
            <ul role="listbox" aria-label={query ? "Search results" : title}>
              {entries.map((e) => (
                <EntryRow key={e.id} entry={e} selected={e.id === selectedId} issues={security} onOpen={onOpen} />
              ))}
            </ul>
          )}
          {entries?.length === 0 && <Empty query={query} security={security} onNew={onNew} />}
        </div>
      </div>
      {sorting && <SortMenu value={sort} onChange={onSort} onClose={() => setSorting(false)} />}
    </div>
  );
}

function Empty({ query, security, onNew }: { query: string; security: boolean; onNew: () => void }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-[15px] font-semibold text-ink-2">{query ? "No results" : security ? "All clear" : "Nothing here yet"}</p>
      {query || security ? (
        <p className="mt-1 text-[13px] text-ink-3">{query ? `Nothing matches "${query}".` : "No weak, reused or old passwords, no keys running out, and enough backup codes."}</p>
      ) : (
        <button type="button" onClick={onNew} className="press hit mx-auto mt-3.5 flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[13.5px] font-semibold text-on-accent shadow-accent focus-ring">
          <Plus size={15} weight="bold" />
          Add an item
        </button>
      )}
    </div>
  );
}

// Loading: rows of soft shimmer at the real rows' size, never a spinner.
function Skeleton() {
  return (
    <div aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 px-2.5 py-2">
          <span className="shimmer size-10 shrink-0 rounded-[11px] bg-field" />
          <span className="flex-1 space-y-2">
            <span className="shimmer block h-3 w-2/5 rounded bg-field" />
            <span className="shimmer block h-2.5 w-3/5 rounded bg-field" />
          </span>
        </div>
      ))}
    </div>
  );
}
