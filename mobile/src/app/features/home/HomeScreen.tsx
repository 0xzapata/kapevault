import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../../components/Toast";
import { useHost } from "../../host/host-context";
import { useSync, useVault } from "../../hooks/use-vault";
import { countIn, filterEntries, type ListScope, type SortOrder } from "../../lib/filter";
import { SHEET } from "../../lib/spring";
import { ItemDetail } from "../detail/ItemDetail";
import { ItemSheet } from "../edit/ItemSheet";
import { ConnectSheet } from "../settings/ConnectSheet";
import { SettingsTab } from "../settings/SettingsTab";
import { TrustSheet } from "../settings/TrustSheet";
import { ItemList } from "./ItemList";
import { SidebarDrawer } from "./SidebarDrawer";
import { SyncLine, SyncSheet } from "./SyncSheet";
import { TabBar, type Tab } from "./TabBar";
import type { Entry } from "../../host/types";

const TAB_LISTS: Record<"codes" | "security", { scope: ListScope; title: string }> = {
  codes: { scope: { view: "totp" }, title: "2FA codes" },
  security: { scope: { view: "security" }, title: "Security" },
};

// The unlocked app: the tab bar and the sidebar drawer, the item pushed over the list, the sheets.
export function HomeScreen({ startTab, onRestoreFile }: { startTab: Tab; onRestoreFile: () => void }) {
  const host = useHost();
  const toast = useToast();
  const view = useVault();
  const sync = useSync();
  const [tab, setTab] = useState<Tab>(startTab);
  const [items, setItems] = useState<{ scope: ListScope; title: string }>({ scope: { view: "all" }, title: "All items" });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOrder>("recent");
  const [drawer, setDrawer] = useState(false);
  const [detail, setDetail] = useState<{ id: string; open: boolean } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ entry: Entry | null } | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [about, setAbout] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const content = useRef<HTMLDivElement>(null);

  const list = tab === "codes" || tab === "security" ? TAB_LISTS[tab] : items;
  const entries = useMemo(() => (view ? filterEntries(view.entries, view.spaces, list.scope, query, sort) : null), [view, list.scope, query, sort]);
  const detailEntry = (detail && view?.entries.find((e) => e.id === detail.id)) || null;

  // An item deleted while open (a conflict copy) closes its page.
  useEffect(() => {
    if (view && detail?.open && !detailEntry) closeItem();
  });

  function openItem(id: string) {
    clearTimeout(leaveTimer.current);
    setSelectedId(id);
    setDetail({ id, open: true });
  }
  function closeItem() {
    setDetail((d) => d && { ...d, open: false });
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setDetail((d) => (d && !d.open ? null : d)), SHEET.ms);
  }
  function switchTab(next: Tab) {
    // The new tab's screen fades up instead of swapping in one frame; opacity only, so it stays with reduced motion.
    if (next !== tab) content.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    setTab(next);
    setQuery("");
  }

  const personal = view?.spaces.find((s) => s.kind === "personal")?.id ?? "";
  const scope = items.scope;
  const defaultSpace = tab === "items" && "spaceId" in scope ? scope.spaceId : personal;

  return (
    <div className="fixed inset-0 flex flex-col bg-surface pt-[var(--sat)]" style={{ animation: "fade 200ms ease" }}>
      <div ref={content} className="flex min-h-0 flex-1 flex-col">
        {tab === "settings" ? (
          <SettingsTab onRestoreFile={onRestoreFile} />
        ) : (
          <ItemList
            title={list.title}
            entries={entries}
            issuesView={"view" in list.scope && list.scope.view === "security"}
            query={query}
            sort={sort}
            selectedId={selectedId}
            syncLine={tab === "items" ? <SyncLine status={sync} onOpen={() => setSyncOpen(true)} /> : undefined}
            onQuery={setQuery}
            onSort={setSort}
            onOpen={openItem}
            onNew={() => setEditing({ entry: null })}
            onDrawer={() => setDrawer(true)}
          />
        )}
      </div>
      <TabBar tab={tab} issues={view ? countIn(view.entries, { view: "security" }) : 0} onTab={switchTab} />

      {view && (
        <SidebarDrawer
          open={drawer}
          entries={view.entries}
          spaces={view.spaces}
          scope={list.scope}
          query={query}
          onQuery={setQuery}
          onScope={(s, title) => {
            const v = "view" in s ? s.view : null;
            if (v === "totp" || v === "security") return switchTab(v === "totp" ? "codes" : "security");
            setItems({ scope: s, title });
            switchTab("items");
          }}
          onAddClient={async (name) => {
            const result = await host.addSpace(name);
            if (!result.ok) toast(result.error, "error");
            return result.ok;
          }}
          onLock={() => void host.lock("user")}
          onSettings={() => {
            setDrawer(false);
            switchTab("settings");
          }}
          onAbout={() => setAbout(true)}
          onClose={() => setDrawer(false)}
        />
      )}

      {view && (
        <ItemDetail
          entry={detailEntry}
          open={Boolean(detail?.open && detailEntry)}
          entries={view.entries}
          spaces={view.spaces}
          conflicts={sync?.conflicts ?? []}
          onBack={closeItem}
          onEdit={(entry) => setEditing({ entry })}
          onOpenItem={openItem}
        />
      )}

      {editing && view && (
        <ItemSheet
          entry={editing.entry}
          entries={view.entries}
          spaces={view.spaces}
          defaultSpaceId={defaultSpace}
          defaultHeldFor={tab === "items" && "heldFor" in scope ? scope.heldFor : ""}
          onSaved={(id) => !editing.entry && openItem(id)}
          onDeleted={() => closeItem()}
          onClose={() => setEditing(null)}
        />
      )}
      {syncOpen && sync && view && <SyncSheet status={sync} entries={view.entries} onOpenItem={openItem} onConnect={() => setConnectOpen(true)} onClose={() => setSyncOpen(false)} />}
      {connectOpen && <ConnectSheet onClose={() => setConnectOpen(false)} onConnected={() => {}} />}
      {about && <TrustSheet onClose={() => setAbout(false)} />}
    </div>
  );
}
