import { useEffect, useRef, type DragEvent } from "react";
import { ArrowsDownUp, Backpack, Clock, MagnifyingGlass, Plus, Printer, SidebarSimple, Star } from "@phosphor-icons/react";
import { Menu, useMenu, type MenuItem } from "@/components/Menu";
import { TitleBar } from "@/components/TitleBar";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import type { LayoutMode } from "@/hooks/use-layout";
import { keys } from "@/lib/platform";
import { localToday } from "@/lib/local-date";
import { EntryIcon } from "./EntryIcon";
import { ENTRY_DRAG_TYPE } from "./Sidebar";
import { entrySubtitle } from "../lib/entry-text";
import { issueLabel, worstIssue } from "../lib/issues";
import { trashLine } from "../lib/trash-text";
import { followUpDue, isGone } from "@/features/closing/lib/lifecycle";
import { SyncLine } from "@/features/sync/components/SyncLine";
import { MasterIssueRow } from "@/features/security/components/MasterIssueRow";
import { InstallFolderIssueRow } from "@/features/security/components/InstallFolderIssueRow";
import type { Entry, SortOrder, Space, ViewFilter } from "../types";

interface EntryListProps {
  heading: string;
  entries: Entry[];
  spaces: Space[];
  selectedId: string | null;
  query: string;
  sort: SortOrder;
  view: ViewFilter;
  mode: LayoutMode;
  sidebarHidden: boolean; // collapsed or tucked into the drawer: the list carries the toggle and search
  showSpace: boolean; // label each row with its space (only worth it when there is more than one)
  onQuery: (q: string) => void;
  onSort: (sort: SortOrder) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onShowSidebar: () => void;
  rowMenu: (entry: Entry) => MenuItem[];
  onHandBack?: () => void; // a person's list: print what is kept for them
  onEvacuate?: () => void; // the Things list: the grab-first checklist
  onEmptyTrash: () => Promise<void>; // the Trash list: let go of everything in it
  masterWeak: boolean; // Security also lists the master password
  installWriters: string[]; // ... and a KAPEVault folder other accounts can change
  onFixMaster: () => void; // opens Settings > Security, Change master password
}

const SORT_LABELS: Record<SortOrder, string> = { recent: "Recently used", title: "Title", edited: "Date edited" };
const WIDTH: Record<LayoutMode, string> = { wide: "w-[360px]", medium: "w-[316px]", narrow: "w-[300px]", compact: "min-w-0 flex-1" };
// A list's own action beside its count (Hand back, Evacuate).
const headerPill = "press -my-1 flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-[12.5px] font-semibold text-accent transition-colors hover:bg-accent hover:text-on-accent focus-ring";
const toolbarButton = "press grid size-8 place-items-center rounded-[7px] text-ink-2 hover:bg-hover hover:text-ink";

// "3 reused · 2 weak" for the Security view header.
function issueSummary(entries: Entry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) for (const i of e.issues) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);
  const names: Record<string, string> = { reused: "reused", weak: "weak", old: "old", expired: "expired", expiring: "expiring soon", codes: "low on backup codes" };
  return Object.keys(names)
    .filter((k) => counts.get(k))
    .map((k) => `${counts.get(k)} ${names[k]}`)
    .join(" · ");
}

export function EntryList(props: EntryListProps) {
  const { heading, entries, spaces, selectedId, query, sort, view, mode, sidebarHidden, showSpace, onQuery, onSort, onSelect, onNew, onShowSidebar, rowMenu, onHandBack, onEvacuate, onEmptyTrash, masterWeak, installWriters, onFixMaster } = props;
  const spaceName = (id: string) => spaces.find((s) => s.id === id)?.name ?? "";
  const sortMenu = useMenu();
  const rowMenuState = useMenu();
  const menuEntry = useRef<Entry | null>(null);
  const sortRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const security = view === "security" && !query;
  const trash = view === "trash"; // trashed items: no New, no drag, days left under each row
  const sharedFolder = installWriters.length > 0;
  const fixes = entries.length + (security ? Number(masterWeak) + Number(sharedFolder) : 0);
  const today = localToday();

  // Keyboard moves the selection; keep it in view without jumping the list around.
  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector(`[data-entry="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  function onDragStart(e: DragEvent, entry: Entry) {
    e.dataTransfer.setData(ENTRY_DRAG_TYPE, entry.id);
    e.dataTransfer.effectAllowed = "move";
  }

  return (
    <section aria-label="Items" data-flip className={`flex h-full ${WIDTH[mode]} shrink-0 flex-col border-r border-line bg-canvas`}>
      <TitleBar edgeLeft={sidebarHidden} edgeRight={mode === "compact"} className="gap-0.5 px-2">
        {sidebarHidden && (
          <button type="button" aria-label="Show sidebar" title={`Show sidebar (${keys("mod", "\\")})`} onClick={onShowSidebar} className={toolbarButton}>
            <SidebarSimple size={17} />
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          ref={sortRef}
          aria-label={`Sort by: ${SORT_LABELS[sort]}`}
          title={`Sort by: ${SORT_LABELS[sort]}`}
          onClick={() => sortRef.current && sortMenu.openUnder(sortRef.current, "end")}
          className={toolbarButton}
        >
          <ArrowsDownUp size={16} />
        </button>
        {!trash && (
          <button type="button" onClick={onNew} aria-label="New" title={`New item (${keys("mod", "N")})`} className={toolbarButton}>
            <Plus size={17} />
          </button>
        )}
      </TitleBar>

      <h2 className="truncate px-5 text-[26px] font-bold leading-[1.15] tracking-[-0.025em]">{query ? "Results" : heading}</h2>
      <div className="px-5 pb-3 pt-0.5">
        {security ? (
          <p className="text-[12.5px] text-ink-3">{fixes ? `${fixes} ${fixes === 1 ? "item needs" : "items need"} attention: ${[masterWeak && "weak master password", sharedFolder && "shared KAPEVault folder", issueSummary(entries)].filter(Boolean).join(" · ")}` : "Nothing to fix. Every password is unique, strong and fresh."}</p>
        ) : (
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[12.5px] tabular-nums text-ink-3">
              {entries.length} {query ? (entries.length === 1 ? "match" : "matches") : entries.length === 1 ? "item" : "items"} · {query ? "Best first" : trash ? "Gone after 30 days" : SORT_LABELS[sort]}
            </p>
            {trash && !query && <ConfirmDelete label="Empty Trash" onConfirm={onEmptyTrash} />}
            {onHandBack && (
              <button type="button" onClick={onHandBack} className={headerPill}>
                <Printer size={13} weight="bold" />
                Hand back
              </button>
            )}
            {onEvacuate && !query && (
              <button type="button" onClick={onEvacuate} className={headerPill}>
                <Backpack size={13} weight="bold" />
                Evacuate
              </button>
            )}
          </div>
        )}
        <SyncLine onShow={onSelect} />
      </div>

      {/* With the sidebar tucked away, search lives here. */}
      {sidebarHidden && (
        <div className="px-3 pb-2">
          <label className="flex h-8 items-center gap-2 rounded-[8px] bg-field px-2.5 transition-[box-shadow,background-color] focus-within:bg-raised focus-within:outline-2 focus-within:outline-accent focus-within:ring-4 focus-within:ring-accent-soft">
            <MagnifyingGlass size={14} className="shrink-0 text-ink-3" />
            <input
              data-search
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search logins, links, clients"
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3"
            />
          </label>
        </div>
      )}

      <ul
        ref={listRef}
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA in HTML allows role listbox on a ul
        role="listbox"
        aria-label={query ? "Search results" : heading}
        tabIndex={0}
        data-entry-list
        data-focus-home
        aria-activedescendant={selectedId ? `entry-${selectedId}` : undefined}
        className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 outline-none"
      >
        {security && masterWeak && <MasterIssueRow onFix={onFixMaster} />}
        {security && <InstallFolderIssueRow writers={installWriters} />}
        {entries.map((entry) => {
          const selected = entry.id === selectedId;
          const tone = selected ? "bg-accent text-on-accent" : "hover:bg-hover";
          const quiet = selected ? "text-on-accent-2" : "text-ink-3";
          const issue = security ? worstIssue(entry.issues) : undefined;
          // The line under the title: a health issue (Security view), then a due follow-up, then what it is.
          const due = followUpDue(entry, today);
          let line = entrySubtitle(entry) || spaceName(entry.spaceId);
          if (due) line = "Follow up due";
          if (issue) line = issueLabel(issue);
          if (trash) line = trashLine(entry);
          return (
            <li key={entry.id} className="group">
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: an option of a listbox: the list owns the keys (arrows, Enter) through aria-activedescendant, so the row is not a tab stop */}
              {/* biome-ignore lint/a11y/useFocusableInteractive: an option of a listbox: the list owns the keys (arrows, Enter) through aria-activedescendant, so the row is not a tab stop */}
              <div
                id={`entry-${entry.id}`}
                data-entry={entry.id}
                role="option"
                aria-selected={selected}
                draggable={!isGone(entry) && !trash}
                onDragStart={(e) => onDragStart(e, entry)}
                onClick={() => onSelect(entry.id)}
                onContextMenu={(e) => {
                  onSelect(entry.id);
                  if (rowMenu(entry).length === 0) return;
                  menuEntry.current = entry;
                  rowMenuState.openAt(e);
                }}
                className={`row relative flex w-full cursor-default items-center gap-3 rounded-[10px] px-2.5 py-2 text-left focus-ring focus-ring-inset [--focus-ring-color:var(--color-on-accent)] ${tone}`}
              >
                <EntryIcon entry={entry} size="sm" inverted={selected} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[14px] font-semibold tracking-[-0.01em]">{entry.title}</span>
                    {entry.favorite && <Star size={11} weight="fill" aria-label="Favorite" className={`shrink-0 ${selected ? "text-on-accent" : "text-sys-orange"}`} />}
                    {entry.kind === "login" && entry.hasTotp && <Clock size={11} weight="bold" aria-label="Has 2FA code" className={`shrink-0 ${quiet}`} />}
                  </div>
                  <p className={`truncate text-[12.5px] ${(issue || due) && !selected ? "text-warn" : quiet}`}>{line}</p>
                </div>
                {showSpace && <span className={`max-w-[96px] shrink-0 truncate text-[11.5px] ${quiet} ${mode === "compact" ? "hidden min-[480px]:inline" : ""}`}>{spaceName(entry.spaceId)}</span>}
              </div>
            </li>
          );
        })}
        {entries.length === 0 && !(security && (masterWeak || sharedFolder)) && (
          <li className="px-6 pt-16 text-center">
            <p className="text-[15px] font-semibold text-ink-2">{query ? "No results" : security ? "All clear" : "Nothing here yet"}</p>
            {query || security ? (
              <p className="mt-1 text-[13px] text-ink-3">{query ? `Nothing matches "${query}".` : "No weak, reused or old passwords, no keys running out, and enough backup codes."}</p>
            ) : (
              <button
                type="button"
                onClick={onNew}
                className="press mx-auto mt-3.5 flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[13.5px] font-semibold text-on-accent shadow-accent hover:brightness-110 focus-ring"
              >
                <Plus size={15} weight="bold" />
                Add an item
              </button>
            )}
          </li>
        )}
      </ul>

      {sortMenu.anchor && (
        <Menu
          label="Sort by"
          anchor={sortMenu.anchor}
          onClose={sortMenu.close}
          items={(Object.keys(SORT_LABELS) as SortOrder[]).map((s) => ({ label: SORT_LABELS[s], checked: s === sort, onSelect: () => onSort(s) }))}
        />
      )}
      {rowMenuState.anchor && menuEntry.current && <Menu label={`${menuEntry.current.title} actions`} anchor={rowMenuState.anchor} onClose={rowMenuState.close} items={rowMenu(menuEntry.current)} />}
    </section>
  );
}
