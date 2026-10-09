import { useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import { Archive, Clock, Code, Devices, DotsThree, Gear, HourglassMedium, IdentificationCard, Info, Key, Link, Lock, MagnifyingGlass, NotePencil, Package, PencilSimple, Plus, Printer, ShieldWarning, SidebarSimple, SquaresFour, Star, Trash } from "@phosphor-icons/react";
import { AppIcon } from "@/components/AppIcon";
import { Menu, useMenu } from "@/components/Menu";
import { TitleBar } from "@/components/TitleBar";
import { keys } from "@/lib/platform";
import { localToday } from "@/lib/local-date";
import { peopleHeldFor, personKey, type Person } from "@/features/held-for/lib/held-for";
import { followUpDue, isGone } from "@/features/closing/lib/lifecycle";
import { matchesView } from "../lib/filter-entries";
import { VIEWS, viewOf, type ViewDef } from "../lib/views";
import type { Entry, Space, ViewFilter } from "../types";

// Drag an item row onto a space to move it there. The payload is only the item id.
export const ENTRY_DRAG_TYPE = "application/x-kapevault-entry";

interface SidebarProps {
  entries: Entry[];
  trash: Entry[]; // the Trash row shows while it holds something
  masterWeak: boolean; // counts in Security
  installWriters: string[]; // other accounts that can change the KAPEVault folder: one more in Security
  spaces: Space[];
  view: ViewFilter;
  spaceId: string | null;
  heldFor: string | null;
  query: string;
  variant: "wide" | "medium" | "drawer";
  onQuery: (q: string) => void;
  onView: (view: ViewFilter) => void;
  onSpace: (id: string) => void;
  onPerson: (name: string) => void;
  onHandBack: (name: string) => void;
  onAddClient: (name: string) => Promise<void>;
  onRenameSpace: (id: string, name: string) => Promise<void>;
  onDeleteSpace: (space: Space) => void;
  onMoveEntry: (entryId: string, spaceId: string) => void;
  onLock: () => void;
  onSettings: () => void;
  onCollapse?: () => void; // inline only: tuck the sidebar away
  onAbout: () => void; // the "how KAPEVault protects you" page
}

// A source-list row (macOS Passwords): tinted glyph square, label, and a count only when there is one.
function SmartRow({ active, icon, tone, label, count, alert = false, onClick }: {
  active: boolean;
  icon: ReactNode;
  tone: string; // a --color-sys-* token
  label: string;
  count: number;
  alert?: boolean; // the count needs attention (Security)
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`row flex h-8 w-full items-center gap-2.5 rounded-[7px] px-2 text-left text-[13.5px] font-medium text-ink focus-ring focus-ring-inset ${active ? "bg-select" : "hover:bg-hover"}`}
    >
      <span className="grid size-[22px] shrink-0 place-items-center rounded-[6px] text-on-accent" style={{ background: `var(${tone})` }}>
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {count > 0 &&
        (alert ? (
          <span className="rounded-full bg-sys-red px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums text-on-accent">{count}</span>
        ) : (
          <span className="text-[12px] tabular-nums text-ink-3">{count}</span>
        ))}
    </button>
  );
}

// Space and person rows share one look: monogram, name, count; "..." appears on hover.
const sourceRow = "row flex h-8 w-full items-center gap-2.5 rounded-[7px] px-2 pr-9 text-[13.5px] text-ink focus-ring focus-ring-inset";
const moreButton = "absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100 focus-ring";

function Monogram({ name }: { name: string }) {
  const letters = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-linear-to-b from-mono-top to-mono-bottom text-[9.5px] font-semibold tracking-wide text-on-accent">
      {letters}
    </span>
  );
}

// A space row: click to open, right-click or "..." for Rename / Delete, and a drop target for items.
function SpaceRow({ space, active, count, onClick, onRename, onDelete, onDropEntry }: {
  space: Space;
  active: boolean;
  count: number;
  onClick: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
  onDropEntry: (entryId: string) => void;
}) {
  const menu = useMenu();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(space.name);
  const [dropping, setDropping] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim() && name.trim() !== space.name) await onRename(name);
    setRenaming(false);
  }

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes(ENTRY_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropping(true);
  }

  function onDrop(e: DragEvent) {
    setDropping(false);
    const id = e.dataTransfer.getData(ENTRY_DRAG_TYPE);
    if (id) {
      e.preventDefault();
      onDropEntry(id);
    }
  }

  if (renaming) {
    return (
      <form onSubmit={submit} className="px-0.5 py-0.5">
        <input
          // biome-ignore lint/a11y/noAutofocus: the field opens from the Rename menu item, so typing is the next step
          autoFocus
          aria-label={`Rename ${space.name}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => setRenaming(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setName(space.name);
              setRenaming(false);
            }
          }}
          className="h-9 w-full rounded-[8px] border border-accent bg-raised px-2.5 text-[13.5px] outline-none ring-4 ring-accent-soft"
        />
      </form>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a mouse drop target for dragging an item onto a space; the keyboard way to move an item is Move to... in its menu
    <div className="group relative" onDragOver={onDragOver} onDragLeave={() => setDropping(false)} onDrop={onDrop}>
      <button
        type="button"
        onClick={onClick}
        onContextMenu={menu.openAt}
        aria-current={active ? "true" : undefined}
        className={`${sourceRow} ${active ? "bg-select" : "hover:bg-hover"} ${dropping ? "drop-target" : ""}`}
      >
        <Monogram name={space.name} />
        <span className="flex-1 truncate text-left font-medium">{space.name}</span>
        <span className="text-[12px] tabular-nums text-ink-3 group-hover:opacity-0">{count || ""}</span>
      </button>
      <button
        type="button"
        ref={moreRef}
        aria-label={`${space.name} options`}
        title="Options"
        onClick={() => moreRef.current && menu.openUnder(moreRef.current, "end")}
        className={`${moreButton} ${menu.anchor ? "opacity-100" : ""}`}
      >
        <DotsThree size={18} weight="bold" />
      </button>
      {menu.anchor && (
        <Menu
          label={`${space.name} options`}
          anchor={menu.anchor}
          onClose={menu.close}
          items={[
            { label: "Rename", icon: <PencilSimple size={14} />, onSelect: () => { setName(space.name); setRenaming(true); } },
            ...(space.kind === "client" ? (["separator", { label: "Delete client...", icon: <Trash size={14} />, danger: true, onSelect: onDelete }] as const) : []),
          ]}
        />
      )}
    </div>
  );
}

// Someone items are kept for: click lists them; right-click or "..." offers Hand back.
function PersonRow({ person, active, onClick, onHandBack }: { person: Person; active: boolean; onClick: () => void; onHandBack: () => void }) {
  const menu = useMenu();
  const moreRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="group relative">
      <button type="button" onClick={onClick} onContextMenu={menu.openAt} aria-current={active ? "true" : undefined} className={`${sourceRow} ${active ? "bg-select" : "hover:bg-hover"}`}>
        <Monogram name={person.name} />
        <span className="flex-1 truncate text-left font-medium">{person.name}</span>
        <span className="text-[12px] tabular-nums text-ink-3 group-hover:opacity-0">{person.count}</span>
      </button>
      <button
        type="button"
        ref={moreRef}
        aria-label={`${person.name} options`}
        title="Options"
        onClick={() => moreRef.current && menu.openUnder(moreRef.current, "end")}
        className={`${moreButton} ${menu.anchor ? "opacity-100" : ""}`}
      >
        <DotsThree size={18} weight="bold" />
      </button>
      {menu.anchor && <Menu label={`${person.name} options`} anchor={menu.anchor} onClose={menu.close} items={[{ label: "Hand back...", icon: <Printer size={14} />, onSelect: onHandBack }]} />}
    </div>
  );
}

function AddClient({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await onAdd(name);
    setName("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Add client"
        title="Add client"
        onClick={() => setOpen(true)}
        className="press grid size-6 place-items-center rounded-full text-ink-3 hover:bg-hover hover:text-accent"
      >
        <Plus size={13} weight="bold" />
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="absolute inset-x-0 top-7 z-10 px-3">
      <input
        // biome-ignore lint/a11y/noAutofocus: the field opens from the Add client button, so typing is the next step
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => !name.trim() && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        placeholder="Client name, then Enter"
        className="drop h-9 w-full rounded-[9px] border border-accent bg-raised px-3 text-[13px] outline-none ring-4 ring-accent-soft placeholder:text-ink-3"
      />
    </form>
  );
}

const WIDTH = { wide: "w-[248px]", medium: "w-[224px]", drawer: "w-[min(280px,86vw)]" };

const VIEW_ICON: Record<ViewFilter, ReactNode> = {
  all: <SquaresFour size={13} weight="fill" />,
  favorites: <Star size={13} weight="fill" />,
  login: <Key size={13} weight="fill" />,
  totp: <Clock size={13} weight="bold" />,
  note: <NotePencil size={13} weight="fill" />,
  key: <Code size={13} weight="bold" />,
  link: <Link size={13} weight="bold" />,
  thing: <Package size={13} weight="fill" />,
  device: <Devices size={13} weight="fill" />,
  id: <IdentificationCard size={13} weight="fill" />,
  security: <ShieldWarning size={13} weight="fill" />,
  closing: <HourglassMedium size={13} weight="fill" />,
  closed: <Archive size={13} weight="fill" />,
  trash: <Trash size={13} weight="fill" />,
};

export function Sidebar(props: SidebarProps) {
  const { spaces, view, spaceId, heldFor, query, variant, onQuery, onView, onSpace, onPerson, onHandBack, onAddClient, onRenameSpace, onDeleteSpace, onMoveEntry, onLock, onSettings, onCollapse, onAbout } = props;
  const entries = props.entries.filter((e) => !isGone(e)); // tombstones count only in Closed
  const countIn = (id: string) => entries.filter((e) => e.spaceId === id).length;
  const isView = (v: ViewFilter) => spaceId === null && heldFor === null && view === v;
  const people = peopleHeldFor(entries); // the section shows once one item is held for someone
  const personal = spaces.filter((s) => s.kind === "personal");
  const clients = spaces.filter((s) => s.kind === "client");
  const today = localToday();
  const followUps = entries.filter((e) => followUpDue(e, today)).length;

  // One smart list's row. Security's count is a red capsule (gray glyph while there is nothing to
  // fix); Closing shows its follow-ups due as a red capsule instead of its count.
  function smartRow(v: ViewDef) {
    const n = props.entries.filter((e) => matchesView(e, v.id)).length + (v.id === "security" ? Number(props.masterWeak) + Number(props.installWriters.length > 0) : 0);
    if (v.hideWhenEmpty && n === 0) return null;
    let look = { tone: v.tone, count: n, alert: false };
    if (v.id === "security") look = { tone: n ? v.tone : "--color-sys-gray", count: n, alert: true };
    if (v.id === "closing") look = { tone: v.tone, count: followUps || n, alert: followUps > 0 };
    return <SmartRow key={v.id} active={isView(v.id)} tone={look.tone} icon={VIEW_ICON[v.id]} label={v.label} count={look.count} alert={look.alert} onClick={() => onView(v.id)} />;
  }

  const row = (s: Space) => (
    <SpaceRow
      key={s.id}
      space={s}
      active={spaceId === s.id}
      count={countIn(s.id)}
      onClick={() => onSpace(s.id)}
      onRename={(name) => onRenameSpace(s.id, name)}
      onDelete={() => onDeleteSpace(s)}
      onDropEntry={(id) => onMoveEntry(id, s.id)}
    />
  );

  return (
    // Inline, the sidebar is glass over the window's acrylic; as a drawer it floats over the list, so it is solid.
    <aside aria-label="Vault navigation" data-sidebar-slide={variant === "drawer" ? undefined : ""} className={`flex h-full ${WIDTH[variant]} shrink-0 flex-col ${variant === "drawer" ? "bg-surface shadow-sheet" : "border-r border-line bg-sidebar"}`}>
      <TitleBar edgeLeft className="gap-2.5 pl-4 pr-2">
        <AppIcon size={20} />
        <span className="text-[13.5px] font-semibold tracking-[-0.01em]">KAPEVault</span>
        <button type="button" aria-label="How KAPEVault protects you" title="How KAPEVault protects you" onClick={onAbout} className="press -ml-1 grid size-6 place-items-center rounded-full text-ink-3 hover:bg-hover hover:text-accent">
          <Info size={15} weight="bold" />
        </button>
        <div className="flex-1" />
        {onCollapse && (
          <button type="button" aria-label="Hide sidebar" title={`Hide sidebar (${keys("mod", "\\")})`} onClick={onCollapse} className="press grid size-8 place-items-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink">
            <SidebarSimple size={17} />
          </button>
        )}
      </TitleBar>

      <div className="px-3">
        <label className="flex h-8 items-center gap-2 rounded-[8px] bg-field px-2.5 transition-[box-shadow,background-color] focus-within:bg-raised focus-within:outline-2 focus-within:outline-accent focus-within:ring-4 focus-within:ring-accent-soft">
          <MagnifyingGlass size={14} className="shrink-0 text-ink-3" />
          <input
            data-search
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search logins, links, clients"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="shrink-0 font-sans text-[11px] text-ink-3">{keys("mod", "K")}</kbd>
        </label>
      </div>

      {/* Everything between search and the footer scrolls together, so short windows still reach every client. */}
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <nav aria-label="Smart lists" className="space-y-px">
          {VIEWS.filter((v) => v.id !== "trash").map(smartRow)}
        </nav>

        <p className="mb-1 mt-6 px-2 text-[11px] font-semibold text-ink-3">Mine</p>
        <div className="space-y-px">{personal.map(row)}</div>

        <div className="relative mb-1 mt-5 flex items-center justify-between pl-2 pr-0.5">
          <p className="text-[11px] font-semibold text-ink-3">Clients</p>
          <AddClient onAdd={onAddClient} />
        </div>
        <div className="space-y-px">
          {clients.map(row)}
          {clients.length === 0 && <p className="px-2 py-1 text-[12.5px] text-ink-3">No clients yet.</p>}
        </div>

        {people.length > 0 && (
          <>
            <p className="mb-1 mt-5 px-2 text-[11px] font-semibold text-ink-3">Held for</p>
            <div className="space-y-px">
              {people.map((p) => (
                <PersonRow key={p.name} person={p} active={personKey(heldFor ?? "") === personKey(p.name)} onClick={() => onPerson(p.name)} onHandBack={() => onHandBack(p.name)} />
              ))}
            </div>
          </>
        )}

        {props.trash.length > 0 && (
          <div className="mt-5">
            <SmartRow active={isView("trash")} tone={viewOf("trash").tone} icon={VIEW_ICON.trash} label="Trash" count={props.trash.length} onClick={() => onView("trash")} />
          </div>
        )}
      </div>

      <div className="flex gap-1 px-3 pb-3 pt-1">
        <button type="button" onClick={onLock} className="press flex h-8 flex-1 items-center gap-2 rounded-[7px] px-2 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink">
          <Lock size={15} weight="bold" />
          Lock vault
        </button>
        <button type="button" aria-label="Settings" title="Settings" onClick={onSettings} className="press grid size-8 place-items-center rounded-[7px] text-ink-2 hover:bg-hover hover:text-ink">
          <Gear size={16} />
        </button>
      </div>
    </aside>
  );
}
