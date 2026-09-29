import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Clock, Code, Devices, Gear, HandCoins, IdentificationCard, Info, Key, Link, Lock, MagnifyingGlass, NotePencil, Package, Plus, ShieldWarning, SquaresFour, Star } from "@phosphor-icons/react";
import { AppIcon, Monogram } from "../../components/icons";
import { useBackLayer } from "../../hooks/use-back-layer";
import { useDragDismiss } from "../../hooks/use-drag-dismiss";
import { isGone, peopleHeldFor, personKey } from "../../lib/entries";
import { countIn, type ListScope, type ViewFilter } from "../../lib/filter";
import type { Entry, Space } from "../../host/types";

interface SidebarDrawerProps {
  open: boolean;
  entries: Entry[];
  spaces: Space[];
  scope: ListScope;
  query: string;
  onQuery: (q: string) => void;
  onScope: (scope: ListScope, title: string) => void;
  onAddClient: (name: string) => Promise<boolean>;
  onLock: () => void;
  onSettings: () => void;
  onAbout: () => void;
  onClose: () => void;
}

const SMART: { view: ViewFilter; label: string; tone: string; icon: ReactNode; always?: boolean }[] = [
  { view: "all", label: "All items", tone: "--color-sys-blue", icon: <SquaresFour size={13} weight="fill" />, always: true },
  { view: "favorites", label: "Favorites", tone: "--color-sys-orange", icon: <Star size={13} weight="fill" />, always: true },
  { view: "login", label: "Logins", tone: "--color-sys-teal", icon: <Key size={13} weight="fill" />, always: true },
  { view: "totp", label: "2FA codes", tone: "--color-sys-indigo", icon: <Clock size={13} weight="bold" />, always: true },
  { view: "note", label: "Notes", tone: "--color-sys-orange", icon: <NotePencil size={13} weight="fill" />, always: true },
  { view: "payee", label: "Payees", tone: "--color-sys-green", icon: <HandCoins size={13} weight="fill" /> },
  { view: "key", label: "API keys", tone: "--color-sys-purple", icon: <Code size={13} weight="bold" />, always: true },
  { view: "link", label: "File links", tone: "--color-sys-green", icon: <Link size={13} weight="bold" />, always: true },
  { view: "thing", label: "Things", tone: "--color-sys-brown", icon: <Package size={13} weight="fill" /> },
  { view: "device", label: "Devices", tone: "--color-sys-cyan", icon: <Devices size={13} weight="fill" /> },
  { view: "id", label: "IDs", tone: "--color-sys-pink", icon: <IdentificationCard size={13} weight="fill" /> },
  { view: "security", label: "Security", tone: "--color-sys-red", icon: <ShieldWarning size={13} weight="fill" />, always: true },
];

const row = "press flex h-11 w-full items-center gap-2.5 rounded-[7px] px-2 text-left text-[13.5px] font-medium text-ink focus-ring [--focus-ring-offset:-2px]";
const section = "track-small mb-1 mt-[22px] px-2 text-[11px] font-semibold text-ink-3";

// The PC sidebar as a drawer from the left (the PC's own narrow-window behaviour), rows 44 px tall.
// Drag it left 1:1 to close; the scrim, a row, or Android's back close it too.
export function SidebarDrawer(props: SidebarDrawerProps) {
  const { open, spaces, scope, query, onQuery, onScope, onLock, onSettings, onAbout, onClose } = props;
  const entries = props.entries.filter((e) => !isGone(e));
  const panel = useRef<HTMLElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const gestures = useDragDismiss(panel, scrim, -1, onClose);
  useBackLayer(open, onClose);

  const current = (s: ListScope) => JSON.stringify(s) === JSON.stringify(scope);
  const pick = (s: ListScope, title: string) => {
    onScope(s, title);
    onClose();
  };
  const people = peopleHeldFor(entries);
  const issues = countIn(entries, { view: "security" });

  return (
    <>
      <div ref={scrim} data-open={open || undefined} className="drawer-scrim fixed inset-0 z-40 bg-scrim" onClick={onClose} />
      <aside
        ref={panel}
        {...gestures}
        aria-label="Vault navigation"
        inert={!open}
        data-open={open || undefined}
        className="drawer fixed inset-y-0 left-0 z-50 flex w-[min(280px,86vw)] touch-pan-y flex-col bg-surface pb-[var(--sab)] pt-[var(--sat)] shadow-sheet"
      >
        <div className="flex h-[52px] shrink-0 items-center gap-2 pl-4 pr-1.5">
          <AppIcon size={20} />
          <span className="text-[13.5px] font-semibold tracking-[-0.01em]">KAPEVault</span>
          <button type="button" aria-label="How KAPEVault protects you" onClick={onAbout} className="press -ml-2 grid size-11 place-items-center rounded-full text-ink-3 focus-ring">
            <Info size={15} weight="bold" />
          </button>
        </div>

        <label className="hit mx-3 flex h-8 shrink-0 items-center gap-2 rounded-[8px] bg-field px-2.5 text-ink-3 focus-within:bg-raised focus-within:outline-2 focus-within:outline-accent">
          <MagnifyingGlass size={14} className="shrink-0" />
          <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search" aria-label="Search logins, links, clients" className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3" />
        </label>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-4">
          <nav aria-label="Smart lists">
            {SMART.map((s) => {
              const n = countIn(entries, { view: s.view });
              if (!s.always && n === 0) return null;
              const alert = s.view === "security";
              return (
                <button key={s.view} type="button" aria-current={current({ view: s.view }) || undefined} onClick={() => pick({ view: s.view }, s.label)} className={`${row} ${current({ view: s.view }) ? "bg-select" : "active:bg-hover"}`}>
                  <span className="grid size-[22px] shrink-0 place-items-center rounded-[6px] text-on-accent" style={{ background: `var(${alert && !issues ? "--color-sys-gray" : s.tone})` }}>
                    {s.icon}
                  </span>
                  <span className="flex-1 truncate">{s.label}</span>
                  {n > 0 && (alert ? <span className="rounded-full bg-sys-red px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums text-on-accent">{n}</span> : <span className="text-[12px] tabular-nums text-ink-3">{n}</span>)}
                </button>
              );
            })}
          </nav>

          <p className={section}>Mine</p>
          {spaces.filter((s) => s.kind === "personal").map((s) => <SpaceRow key={s.id} name={s.name} n={countIn(entries, { spaceId: s.id })} on={current({ spaceId: s.id })} onClick={() => pick({ spaceId: s.id }, s.name)} />)}

          <div className="relative mt-[22px] mb-1 flex items-center justify-between pl-2">
            <p className="track-small text-[11px] font-semibold text-ink-3">Clients</p>
            <AddClient onAdd={props.onAddClient} />
          </div>
          {spaces.filter((s) => s.kind === "client").map((s) => <SpaceRow key={s.id} name={s.name} n={countIn(entries, { spaceId: s.id })} on={current({ spaceId: s.id })} onClick={() => pick({ spaceId: s.id }, s.name)} />)}

          {people.length > 0 && (
            <>
              <p className={section}>Held for</p>
              {people.map((p) => <SpaceRow key={p.name} name={p.name} n={p.count} on={"heldFor" in scope && personKey(scope.heldFor) === personKey(p.name)} onClick={() => pick({ heldFor: p.name }, p.name)} />)}
            </>
          )}
        </div>

        <div className="flex gap-1 px-3 pb-2 pt-1">
          <button type="button" onClick={onLock} className="press flex h-11 flex-1 items-center gap-2 rounded-[7px] px-2 text-[13px] font-medium text-ink-2 active:bg-hover focus-ring">
            <Lock size={15} weight="bold" />
            Lock vault
          </button>
          <button type="button" aria-label="Settings" onClick={onSettings} className="press grid size-11 place-items-center rounded-[7px] text-ink-2 active:bg-hover focus-ring">
            <Gear size={16} />
          </button>
        </div>
      </aside>
    </>
  );
}

function SpaceRow({ name, n, on, onClick }: { name: string; n: number; on: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-current={on || undefined} onClick={onClick} className={`${row} ${on ? "bg-select" : "active:bg-hover"}`}>
      <Monogram name={name} />
      <span className="flex-1 truncate">{name}</span>
      <span className="text-[12px] tabular-nums text-ink-3">{n || ""}</span>
    </button>
  );
}

function AddClient({ onAdd }: { onAdd: (name: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !(await onAdd(name))) return;
    setName("");
    setOpen(false);
  }
  if (!open) {
    return (
      <button type="button" aria-label="Add client" onClick={() => setOpen(true)} className="press -my-2.5 grid size-11 place-items-center rounded-full text-ink-3 focus-ring">
        <Plus size={13} weight="bold" />
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="absolute inset-x-0 top-7 z-10">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => !name.trim() && setOpen(false)}
        placeholder="Client name, then Enter"
        enterKeyHint="done"
        className="drop h-11 w-full rounded-[9px] border border-accent bg-raised px-3 text-[13.5px] outline-none ring-4 ring-accent-soft placeholder:text-ink-3"
      />
    </form>
  );
}
