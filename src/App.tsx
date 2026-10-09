import { useEffect, useState } from "react";
import { hasBridge, vaultApi, type LockReason } from "@/lib/vault-api";
import { ToastProvider, useToast } from "@/components/Toast";
import { WindowStateProvider } from "@/components/TitleBar";
import { sidebarInline, useLayoutMode } from "@/hooks/use-layout";
import { useSidebarCollapse } from "@/hooks/use-sidebar-collapse";
import { useDrawer } from "@/hooks/use-drawer";
import { LockScreen } from "@/features/lock/LockScreen";
import { SettingsSheet } from "@/features/settings/SettingsSheet";
import { ShortcutsSheet } from "@/features/keyboard/ShortcutsSheet";
import { TrustSheet } from "@/features/trust/TrustSheet";
import { restoredNote } from "@/features/cloud/lib/restore-note";
import { useShortcuts } from "@/features/keyboard/use-shortcuts";
import { Sidebar } from "@/features/vault/components/Sidebar";
import { EntryList } from "@/features/vault/components/EntryList";
import { EntryDetail } from "@/features/vault/components/EntryDetail";
import { TrashDetail } from "@/features/vault/components/TrashDetail";
import { EntryForm } from "@/features/vault/components/EntryForm";
import { rowMenu } from "@/features/vault/components/row-menu";
import { DeleteClientSheet, MoveEntrySheet } from "@/features/vault/components/SpaceSheets";
import { HandBackSheet } from "@/features/held-for/components/HandBackSheet";
import { EvacuateView } from "@/features/things/components/EvacuateView";
import { isThing } from "@/features/things/lib/things";
import { personKey } from "@/features/held-for/lib/held-for";
import { isGone } from "@/features/closing/lib/lifecycle";
import { useVault } from "@/features/vault/hooks/use-vault";
import { useInstallFolderWriters } from "@/features/security/hooks/use-install-folder";
import { viewOf } from "@/features/vault/lib/views";
import { copyCode, copySecretOf, copyUsername, openEntry, primaryAction } from "@/features/vault/lib/entry-actions";
import { ipcMessage } from "@/lib/ipc-message";
import type { Entry, EntryKind, Space, VaultView, ViewFilter } from "@/features/vault/types";

// null = form closed, { kind } = add, an Entry = edit that entry
type FormState = null | { newKind: EntryKind } | Entry;
type SettingsSection = "general" | "security" | "backup" | "import";

function VaultApp({ initial, onLock }: { initial: VaultView; onLock: () => void }) {
  const vault = useVault(initial);
  const installWriters = useInstallFolderWriters();
  const mode = useLayoutMode();
  const inline = sidebarInline(mode);
  const collapse = useSidebarCollapse();
  const showSidebar = inline && !collapse.collapsed;
  const toast = useToast();
  const [form, setForm] = useState<FormState>(null);
  const [scanOnOpen, setScanOnOpen] = useState(false); // the form opened from a device's "Scan a label"
  const [settings, setSettings] = useState<{ section?: SettingsSection } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [trustOpen, setTrustOpen] = useState(false);
  const [deleting, setDeleting] = useState<Space | null>(null);
  const [moving, setMoving] = useState<Entry | null>(null);
  const [handingBack, setHandingBack] = useState<string | null>(null); // a person's name
  const [evacuating, setEvacuating] = useState(false);
  const drawer = useDrawer(inline);
  const [detailOpen, setDetailOpen] = useState(false); // compact layout: the item is pushed over the list
  const [revision, setRevision] = useState(0);
  const space = vault.spaces.find((s) => s.id === vault.spaceId);
  const selected = vault.selected;

  // "Show in KAPEVault" from quick search. reveal only sets state, so the first render's copy is fine.
  const reveal = vault.reveal;
  useEffect(
    () =>
      vaultApi.onReveal((id) => {
        reveal(id);
        setDetailOpen(true);
      }),
    [],
  );

  // Leaving one column: the pushed-over item goes back to the list.
  useEffect(() => {
    if (mode !== "compact") setDetailOpen(false);
  }, [mode]);

  // Wide windows collapse the sidebar in place; narrow ones slide it over as a drawer.
  function toggleSidebar() {
    if (inline) collapse.toggle();
    else drawer.toggle();
  }

  // Picking a list from the sidebar: the drawer shuts and one column shows the list, not an item.
  function leave(choose: () => void) {
    choose();
    drawer.close();
    setDetailOpen(false);
  }

  async function lock() {
    await vaultApi.lock();
    onLock();
  }

  // Runs an item action and reports it in a toast. The action says what it did, or null if it
  // did not apply (no username to copy, no link to open).
  async function act(action: (e: Entry) => Promise<string | null>, entry: Entry | null = selected, missing?: string) {
    if (!entry || entry.trashedAt) return; // an item in the Trash copies and opens nothing
    try {
      const message = await action(entry);
      if (message) toast(message);
      else if (missing) toast(missing, "error");
    } catch (e) {
      toast(ipcMessage(e), "error");
    }
  }

  function newItem() {
    setForm({ newKind: viewOf(vault.view).newKind ?? "login" }); // a new item starts as the kind of list you are looking at
  }

  async function toggleFavorite(id: string) {
    const entry = vault.entries.find((e) => e.id === id);
    await vault.toggleFavorite(id);
    if (entry) toast(entry.favorite ? "Removed from favorites" : "Added to favorites");
  }

  async function moveEntry(id: string, spaceId: string) {
    const entry = vault.entries.find((e) => e.id === id);
    if (!entry || entry.spaceId === spaceId) return;
    try {
      await vault.moveEntry(id, spaceId);
      toast(`Moved to ${vault.spaces.find((s) => s.id === spaceId)?.name ?? "space"}`);
    } catch (e) {
      toast(ipcMessage(e), "error");
    }
  }

  // Undo on the "Moved to Trash" toast: the item comes back and is the chosen one again.
  async function undoTrash(id: string) {
    try {
      await vault.restoreEntry(id);
      vault.reveal(id);
      if (mode === "compact") setDetailOpen(true);
      toast("Restored");
    } catch (e) {
      toast(ipcMessage(e), "error");
    }
  }

  function select(id: string) {
    vault.setSelectedId(id);
    if (mode === "compact") setDetailOpen(true);
  }

  useShortcuts({
    focusSearch: () => {
      const focus = () => {
        const input = document.querySelector<HTMLInputElement>("[data-search]:not([inert] *)");
        input?.focus();
        input?.select();
      };
      // In one-column mode the search box is on the list, which has to come back first.
      if (mode === "compact" && detailOpen) {
        setDetailOpen(false);
        requestAnimationFrame(focus);
      } else focus();
    },
    clearSearch: () => {
      if (!vault.query) return false;
      vault.setQuery("");
      return true;
    },
    back: () => {
      if (drawer.open) {
        drawer.close();
        return true;
      }
      if (mode === "compact" && detailOpen) {
        setDetailOpen(false);
        return true;
      }
      return false;
    },
    step: vault.step,
    primary: () => act(primaryAction, selected, "Nothing to copy for this item"),
    copyUsername: () => act(copyUsername, selected, "This item has no username"),
    copySecret: () => act(copySecretOf, selected, "This item has no password"),
    copyCode: () => act(copyCode, selected, "This item has no 2FA code"),
    open: () => act(openEntry, selected, "This item has no link"),
    create: newItem,
    edit: () => selected && !isGone(selected) && !selected.trashedAt && setForm(selected), // a closed account and a trashed item are read only
    favorite: () => selected && !isGone(selected) && !selected.trashedAt && toggleFavorite(selected.id),
    lock,
    settings: () => setSettings({}),
    help: () => setShortcutsOpen(true),
    toggleSidebar,
  });

  const menuActions = { act, onEdit: setForm, onToggleFavorite: toggleFavorite, onMove: setMoving, canMove: vault.spaces.length > 1 };

  const sidebarProps = {
    entries: vault.entries,
    trash: vault.trash,
    masterWeak: vault.masterWeak,
    installWriters,
    spaces: vault.spaces,
    view: vault.view,
    spaceId: vault.spaceId,
    heldFor: vault.heldFor,
    query: vault.query,
    onQuery: vault.setQuery,
    onView: (v: ViewFilter) => leave(() => vault.chooseView(v)),
    onSpace: (id: string) => leave(() => vault.chooseSpace(id)),
    onPerson: (name: string) => leave(() => vault.choosePerson(name)),
    onHandBack: (name: string) => {
      drawer.close();
      setHandingBack(name);
    },
    onAddClient: async (name: string) => {
      await vault.addSpace(name);
      drawer.close();
    },
    onRenameSpace: async (id: string, name: string) => {
      try {
        await vault.renameSpace(id, name);
      } catch (e) {
        toast(ipcMessage(e), "error");
      }
    },
    onDeleteSpace: setDeleting,
    onMoveEntry: moveEntry,
    onLock: lock,
    onSettings: () => setSettings({}),
    onAbout: () => {
      drawer.close();
      setTrustOpen(true);
    },
  };
  const sidebarVariant = mode === "wide" ? "wide" : "medium";

  const list = (
    <EntryList
      heading={space?.name ?? (vault.heldFor ? `Held for ${vault.heldFor}` : viewOf(vault.view).heading)}
      entries={vault.visible}
      spaces={vault.spaces}
      selectedId={selected?.id ?? null}
      query={vault.query}
      sort={vault.sort}
      view={vault.view}
      mode={mode}
      sidebarHidden={!showSidebar}
      showSpace={vault.spaces.length > 1 && !space}
      onQuery={vault.setQuery}
      onSort={vault.setSort}
      onSelect={select}
      onNew={newItem}
      onShowSidebar={toggleSidebar}
      rowMenu={(entry) => rowMenu(entry, menuActions)}
      onHandBack={vault.heldFor ? () => setHandingBack(vault.heldFor) : undefined}
      onEvacuate={vault.view === "thing" ? () => setEvacuating(true) : undefined}
      onEmptyTrash={async () => {
        try {
          await vault.emptyTrash();
          setDetailOpen(false);
          toast("Trash emptied");
        } catch (e) {
          toast(ipcMessage(e), "error");
        }
      }}
      masterWeak={vault.masterWeak}
      installWriters={installWriters}
      onFixMaster={() => setSettings({ section: "security" })}
    />
  );

  // revision remounts the pane after a save so a revealed password never shows a stale value
  const detail = selected?.trashedAt ? (
    <TrashDetail
      key={selected.id}
      entry={selected}
      spaces={vault.spaces}
      mode={mode}
      onBack={() => setDetailOpen(false)}
      onRestore={async (id) => {
        await vault.restoreEntry(id);
        setDetailOpen(false);
        toast("Restored");
      }}
      onDeleteNow={async (id) => {
        await vault.deleteForever(id);
        setDetailOpen(false);
        toast("Deleted for good");
      }}
    />
  ) : (
    <EntryDetail
      key={`${selected?.id}-${revision}`}
      entry={selected}
      entries={vault.entries}
      spaces={vault.spaces}
      mode={mode}
      onBack={() => setDetailOpen(false)}
      onReveal={(id) => {
        vault.reveal(id);
        if (mode === "compact") setDetailOpen(true);
      }}
      onEdit={() => selected && setForm(selected)}
      onScan={() => {
        if (!selected) return;
        setScanOnOpen(true);
        setForm(selected);
      }}
      onToggleFavorite={toggleFavorite}
      onShowClosed={(id) => {
        vault.chooseView("closed");
        vault.setSelectedId(id);
      }}
    />
  );

  return (
    <div className="relative flex h-full min-w-0">
      {showSidebar && <Sidebar {...sidebarProps} variant={sidebarVariant} onCollapse={collapse.toggle} />}
      {/* Collapsing: the sidebar slides out over the panes, then leaves. */}
      {inline && collapse.leaving && (
        <div inert className="absolute inset-y-0 left-0 z-20">
          <Sidebar {...sidebarProps} variant={sidebarVariant} />
        </div>
      )}
      {/* Surface behind the panes, so the gap they open while sliding never shows the bare window. */}
      <div className="flex h-full min-w-0 flex-1 bg-surface">
        {mode === "compact" ? (detailOpen && selected ? detail : list) : (
          <>
            {list}
            {detail}
          </>
        )}
      </div>

      {drawer.state && (
        <div className="fixed inset-0 z-40">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: the scrim is a mouse shortcut for closing the drawer; Escape closes it from the keyboard */}
          <div data-closing={drawer.state === "closing" || undefined} className="drawer-scrim absolute inset-0 bg-scrim" onMouseDown={drawer.close} />
          <div data-closing={drawer.state === "closing" || undefined} className="drawer absolute inset-y-0 left-0 flex">
            <Sidebar {...sidebarProps} variant="drawer" />
          </div>
        </div>
      )}

      {form !== null && (
        <EntryForm
          entry={"newKind" in form ? null : form}
          defaultKind={"newKind" in form ? form.newKind : undefined}
          defaultHeldFor={"newKind" in form ? (vault.heldFor ?? undefined) : undefined}
          startScan={scanOnOpen}
          entries={vault.entries}
          spaces={vault.spaces}
          defaultSpaceId={vault.spaceId ?? vault.spaces[0].id}
          onSave={async (input) => {
            await vault.saveEntry(input);
            setRevision((r) => r + 1);
            if (mode === "compact") setDetailOpen(true);
          }}
          onDelete={async (id) => {
            await vault.deleteEntry(id);
            setDetailOpen(false);
            toast("Moved to Trash", "ok", { label: "Undo", run: () => undoTrash(id) });
          }}
          onClose={() => {
            setForm(null);
            setScanOnOpen(false);
          }}
        />
      )}
      {settings && (
        <SettingsSheet
          initialSection={settings.section}
          onClose={() => setSettings(null)}
          onImported={vault.load}
          onRestored={(next, kept) => {
            vault.load(next);
            setSettings(null);
            toast(restoredNote(kept));
          }}
          onShowShortcuts={() => setShortcutsOpen(true)}
        />
      )}
      {shortcutsOpen && <ShortcutsSheet onClose={() => setShortcutsOpen(false)} />}
      {trustOpen && <TrustSheet onClose={() => setTrustOpen(false)} />}
      {deleting && (
        <DeleteClientSheet
          space={deleting}
          spaces={vault.spaces}
          itemCount={vault.entries.filter((e) => e.spaceId === deleting.id && !isGone(e)).length}
          onDelete={async (moveToId) => {
            await vault.deleteSpace(deleting.id, moveToId);
            toast(`Deleted ${deleting.name}`);
          }}
          onClose={() => setDeleting(null)}
        />
      )}
      {handingBack && <HandBackSheet person={handingBack} entries={vault.entries.filter((e) => personKey(e.heldFor) === personKey(handingBack))} onClose={() => setHandingBack(null)} />}
      {evacuating && <EvacuateView things={vault.entries.filter(isThing)} onClose={() => setEvacuating(false)} />}
      {moving && <MoveEntrySheet entry={moving} spaces={vault.spaces} onMove={(spaceId) => moveEntry(moving.id, spaceId)} onClose={() => setMoving(null)} />}
    </div>
  );
}

type Screen = { name: "loading" } | { name: "locked"; isNew: boolean; reason?: LockReason } | { name: "open"; vault: VaultView };

function Root() {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });

  useEffect(() => {
    vaultApi.status().then((s) => setScreen({ name: "locked", isNew: !s.exists, reason: s.lockReason }));
    // Auto-lock (idle, sleep, OS lock) comes from the main process, and so does an unlock done in
    // the quick search window - both windows always show the same state.
    const offLocked = vaultApi.onLocked((reason) => setScreen({ name: "locked", isNew: false, reason }));
    const offUnlocked = vaultApi.onUnlocked((vault) => setScreen((s) => (s.name === "open" ? s : { name: "open", vault })));
    return () => {
      offLocked();
      offUnlocked();
    };
  }, []);

  switch (screen.name) {
    case "loading":
      return <div className="h-full bg-surface" />;
    case "locked":
      return (
        <LockScreen
          isNew={screen.isNew}
          reason={screen.reason}
          onOpen={(vault) => setScreen({ name: "open", vault })}
        />
      );
    case "open":
      return <VaultApp initial={screen.vault} onLock={() => setScreen({ name: "locked", isNew: false })} />;
  }
}

export default function App() {
  if (!hasBridge) {
    return (
      <div className="grid h-full place-items-center bg-surface px-10 text-center text-[14px] text-ink-2">
        KAPEVault runs as a desktop app. Start it with npm start (or npm run app:dev while developing).
      </div>
    );
  }
  return (
    <WindowStateProvider>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </WindowStateProvider>
  );
}
