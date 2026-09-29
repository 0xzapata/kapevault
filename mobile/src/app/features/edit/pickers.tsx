import { useMemo, useRef, useState, type ReactNode } from "react";
import { Bank, MagnifyingGlass, Prohibit, Sparkle } from "@phosphor-icons/react";
import { Button } from "../../components/form";
import { Sheet } from "../../components/Sheet";
import { BRANDS, NO_BRAND, brandBySlug, detectBrand, providerBrand, type Brand } from "../../lib/brands";
import { GROUPS } from "../../lib/payee-providers";
import type { Draft, SetDraft } from "./use-item-form";

// The PC's LogoPicker and ProviderPicker. On the PC each opens under its button; on the phone the button
// is a form row that opens a sheet with the search and the grouped grid.

const heading = "mb-1.5 block text-[12.5px] font-medium text-ink-2";
const groupTitle = "mb-1.5 text-[11.5px] font-semibold text-ink-3";
const tile = (active: boolean) => `press rounded-[10px] border focus-ring ${active ? "border-accent bg-accent-soft" : "border-line bg-raised"}`;

// The row in the form: what is picked now, and Change. Closing the sheet hands the focus back to it.
function PickerRow({ label, icon, text, muted = false, sheet }: { label: string; icon: ReactNode; text: string; muted?: boolean; sheet: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <span className={heading}>{label}</span>
      <button
        ref={row}
        type="button"
        aria-haspopup="dialog"
        aria-label={`${label}: ${text}`}
        onClick={() => setOpen(true)}
        className="press flex h-11 w-full items-center gap-2.5 rounded-[10px] border border-line bg-raised px-3 text-left text-[14px] focus-ring"
      >
        {icon}
        <span className={`min-w-0 flex-1 truncate ${muted ? "text-ink-3" : ""}`}>{text}</span>
        <span className="text-[12.5px] text-accent">Change</span>
      </button>
      {open &&
        sheet(() => {
          setOpen(false);
          row.current?.focus();
        })}
    </div>
  );
}

// The sheet's search, the phone's search field look (the item list's).
function SearchBox({ value, onChange, label, placeholder, onEnter }: { value: string; onChange: (v: string) => void; label: string; placeholder: string; onEnter?: () => void }) {
  return (
    <label className="hit flex h-8 shrink-0 items-center gap-2 rounded-[8px] bg-field px-2.5 text-ink-3 focus-within:bg-raised focus-within:outline-2 focus-within:outline-accent focus-within:ring-4 focus-within:ring-accent-soft">
      <MagnifyingGlass size={14} className="shrink-0" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !onEnter) return;
          e.preventDefault();
          onEnter();
        }}
        enterKeyHint={onEnter ? "done" : "search"}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  );
}

// A picker sheet: the search stays pinned while the grid scrolls under it.
function PickerSheet({ title, onClose, search, children }: { title: string; onClose: () => void; search: (close: () => void) => ReactNode; children: (close: () => void) => ReactNode }) {
  return (
    <Sheet
      title={title}
      tall
      onClose={onClose}
      footer={(close) => (
        <>
          <span className="flex-1" />
          <Button onClick={close}>Cancel</Button>
        </>
      )}
    >
      {(close) => (
        <>
          <div className="sticky -top-7 z-10 -mx-7 mt-2 bg-raised px-7 pb-3 pt-2">{search(close)}</div>
          <div className="flex flex-col gap-4">{children(close)}</div>
        </>
      )}
    </Sheet>
  );
}

// The logo for a login, note, API key, file link or device: Auto (what auto-detect picks from the link,
// then the title), No logo, or any logo. value: undefined = auto, "none" = no logo, else a brand slug.
function LogoPicker({ value, link, title, onChange }: { value: string | undefined; link: string; title: string; onChange: (value: string | undefined) => void }) {
  const [query, setQuery] = useState("");
  const detected = detectBrand(link, title);
  const chosen = value && value !== NO_BRAND ? brandBySlug(value) : null;
  const shown = value === undefined ? detected : chosen;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = BRANDS.filter((b) => !q || b.name.toLowerCase().includes(q));
    return [...new Set(list.map((b) => b.group))].map((g) => ({ group: g, brands: list.filter((b) => b.group === g) }));
  }, [query]);

  let text = "No logo";
  if (value === undefined) text = detected ? `Auto: ${detected.name}` : "Auto: none found";
  else if (chosen) text = chosen.name;

  return (
    <PickerRow
      label="Logo"
      icon={<span className="grid size-6 shrink-0 place-items-center">{shown ? <img src={shown.logo} alt="" className="size-5 object-contain" /> : <Prohibit size={16} className="text-ink-3" />}</span>}
      text={text}
      sheet={(onClose) => (
        <PickerSheet title="Logo" onClose={onClose} search={() => <SearchBox value={query} onChange={setQuery} label="Search logos" placeholder="Search logos" />}>
          {(close) => {
            const pick = (next: string | undefined) => {
              onChange(next);
              setQuery("");
              close();
            };
            return (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  <button type="button" aria-pressed={value === undefined} onClick={() => pick(undefined)} className={`${tile(value === undefined)} flex h-11 min-w-0 items-center justify-center gap-2 px-2 text-[13px]`}>
                    <Sparkle size={14} className="shrink-0 text-accent" />
                    <span className="truncate">{detected ? `Auto: ${detected.name}` : "Auto-detect"}</span>
                  </button>
                  <button type="button" aria-pressed={value === NO_BRAND} onClick={() => pick(NO_BRAND)} className={`${tile(value === NO_BRAND)} flex h-11 items-center justify-center gap-2 text-[13px]`}>
                    <Prohibit size={14} className="text-ink-3" /> No logo
                  </button>
                </div>
                {groups.map(({ group, brands }) => (
                  <section key={group}>
                    <p className={groupTitle}>{group}</p>
                    <div className="grid grid-cols-6 gap-1.5">
                      {brands.map((b) => (
                        <button key={b.slug} type="button" aria-label={b.name} aria-pressed={value === b.slug} onClick={() => pick(b.slug)} className={`${tile(value === b.slug)} grid h-12 place-items-center`}>
                          <img src={b.logo} alt="" draggable={false} className="size-6 object-contain" />
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
                {groups.length === 0 && <p className="py-4 text-center text-[13px] text-ink-3">No logo called "{query}".</p>}
              </>
            );
          }}
        </PickerSheet>
      )}
    />
  );
}

// The Logo row of a kind's fields, on exactly the kinds the PC offers it (not a payee or a thing). The
// link is a file link's location, else the website; a device's maker is often only in its model.
export function LogoField({ draft, set }: { draft: Draft; set: SetDraft }) {
  const link = draft.kind === "link" ? draft.location : draft.url;
  const title = draft.kind === "device" ? `${draft.title} ${draft.model}` : draft.title;
  return <LogoPicker value={draft.brand} link={link} title={title} onChange={(v) => set("brand", v)} />;
}

// Where a payee's money goes: a wallet or bank from the PC's list, or any name typed into the search.
export function ProviderPicker({ value, onChange }: { value: string; onChange: (provider: string) => void }) {
  const [query, setQuery] = useState("");
  const shown = value ? providerBrand(value) : null;
  const typed = query.trim();

  const groups = useMemo(() => {
    const q = typed.toLowerCase();
    return GROUPS.map((g) => ({
      label: g.label,
      brands: g.slugs.map(brandBySlug).filter((b): b is Brand => b !== null && (!q || b.name.toLowerCase().includes(q))),
    })).filter((g) => g.brands.length > 0);
  }, [typed]);
  const first = groups[0]?.brands[0];
  const exact = groups.some((g) => g.brands.some((b) => b.name.toLowerCase() === typed.toLowerCase()));

  function pick(name: string, close: () => void) {
    onChange(name);
    setQuery("");
    close();
  }

  return (
    <PickerRow
      label="Wallet or bank"
      // Logos are drawn for white, so they sit on paper in every theme.
      icon={<span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-paper">{shown ? <img src={shown.logo} alt="" className="size-[18px] object-contain" /> : <Bank size={15} className="text-ink-3" />}</span>}
      text={value || "Choose one"}
      muted={!value}
      sheet={(onClose) => (
        <PickerSheet
          title="Wallet or bank"
          onClose={onClose}
          // Enter picks the first provider shown, or the typed name.
          search={(close) => <SearchBox value={query} onChange={setQuery} label="Search wallets and banks" placeholder="Search or type a name" onEnter={() => (first || typed) && pick(first?.name ?? typed, close)} />}
        >
          {(close) => (
            <>
              {typed && !exact && (
                <button type="button" onClick={() => pick(typed, close)} className={`${tile(false)} flex h-11 w-full items-center justify-center gap-2 px-3 text-[13px] font-medium`}>
                  <Bank size={15} className="shrink-0 text-ink-3" />
                  <span className="truncate">Use "{typed}"</span>
                </button>
              )}
              {groups.map(({ label, brands }) => (
                <section key={label}>
                  <p className={groupTitle}>{label}</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {brands.map((b) => (
                      <button
                        key={b.slug}
                        type="button"
                        aria-pressed={value === b.name}
                        onClick={() => pick(b.name, close)}
                        className={`${tile(value === b.name)} flex h-[58px] min-w-0 flex-col items-center justify-center gap-1 px-1`}
                      >
                        <span className="grid size-7 place-items-center rounded-[7px] bg-paper">
                          <img src={b.logo} alt="" draggable={false} className="size-[22px] object-contain" />
                        </span>
                        <span className="max-w-full truncate text-[11.5px] font-medium text-ink-2">{b.name}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </PickerSheet>
      )}
    />
  );
}
