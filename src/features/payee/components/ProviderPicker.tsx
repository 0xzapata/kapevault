import { useMemo, useRef, useState } from "react";
import { Bank, MagnifyingGlass } from "@phosphor-icons/react";
import { brandBySlug, providerBrand, type Brand } from "@/features/brands/brands";
import { useRovingTiles } from "@/hooks/use-roving-tiles";

// What the payee form offers, in the order people in the Philippines reach for them. Each slug is a
// brand in brands.json; any other provider is typed into the search and used as its name.
const GROUPS = [
  { label: "E-wallets", slugs: ["gcash", "maya"] },
  { label: "Banks", slugs: ["bdo", "bpi", "metrobank", "landbank", "unionbank", "pnb", "security-bank", "rcbc", "chinabank", "eastwest", "gotyme", "seabank", "cimb"] },
  { label: "Remittance and abroad", slugs: ["palawan-express", "cebuana", "mlhuillier", "western-union", "remitly", "wise", "paypal", "payoneer"] },
];

interface ProviderPickerProps {
  value: string; // the provider's name, "" = none picked yet
  onChange: (provider: string) => void;
}

export function ProviderPicker({ value, onChange }: ProviderPickerProps) {
  const [open, setOpen] = useState(!value);
  const [openedByHand, setOpenedByHand] = useState(false); // open by itself on a new payee: Who keeps the focus
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
  const brands = groups.flatMap((g) => g.brands); // the tiles in order, for the arrow keys
  const exact = brands.some((b) => b.name.toLowerCase() === typed.toLowerCase());
  const tileKeys = useRovingTiles(brands.length, brands.findIndex((b) => b.name === value));
  const toggle = useRef<HTMLButtonElement>(null);

  // Closing hands the focus back to the button: the tile or search that had it is gone.
  function close() {
    setOpen(false);
    toggle.current?.focus();
  }

  function pick(name: string) {
    onChange(name);
    setQuery("");
    close();
  }

  const tile = (active: boolean) =>
    `press flex h-[58px] min-w-0 flex-col items-center justify-center gap-1 rounded-[10px] border px-1 transition-colors focus-ring ${active ? "border-accent bg-accent-soft" : "border-line bg-raised hover:bg-hover"}`;

  return (
    <div>
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setOpenedByHand(true);
        }}
        className="press flex h-10 w-full items-center gap-2.5 rounded-[10px] border border-line bg-raised px-3 text-left text-[14px] hover:bg-hover focus-ring"
      >
        {/* Logos are drawn for white, so they sit on paper in every theme. */}
        <span className="grid size-6 place-items-center rounded-[6px] bg-paper">
          {shown ? <img src={shown.logo} alt="" className="size-[18px] object-contain" /> : <Bank size={15} className="text-ink-3" />}
        </span>
        <span className={`flex-1 truncate ${value ? "" : "text-ink-3"}`}>{value || "Choose one"}</span>
        <span className="text-[12.5px] text-accent">{open ? "Close" : "Change"}</span>
      </button>

      {open && (
        <div
          className="drop mt-2 rounded-[12px] border border-line bg-surface p-3"
          onKeyDown={(e) => {
            // Esc anywhere in the picker (search or a tile) closes just the picker, not the whole form behind it
            if (e.key !== "Escape") return;
            e.stopPropagation();
            close();
          }}
        >
          <label className="flex h-9 items-center gap-2 rounded-[8px] bg-raised px-2.5">
            <MagnifyingGlass size={14} className="text-ink-3" />
            <input
              autoFocus={openedByHand}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter picks the first provider shown (or the typed name), never submits the form.
                if (e.key === "Enter") {
                  e.preventDefault();
                  const first = brands[0];
                  if (first) pick(first.name);
                  else if (typed) pick(typed);
                }
              }}
              aria-label="Search wallets and banks"
              placeholder="Search or type a name"
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-3"
            />
          </label>

          {/* Padded so a tile's focus ring is never clipped by the scroll box. */}
          <div className="-mx-1 mt-2 max-h-[268px] space-y-3 overflow-y-auto p-1">
            {typed && !exact && (
              <button type="button" onClick={() => pick(typed)} className={`${tile(false)} h-10 w-full flex-row gap-2 text-[13px] font-medium`}>
                <Bank size={15} className="shrink-0 text-ink-3" />
                <span className="truncate">Use "{typed}"</span>
              </button>
            )}
            {groups.map(({ label, brands: inGroup }) => (
              <section key={label}>
                <p className="mb-1.5 text-[11.5px] font-semibold text-ink-3">{label}</p>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                  {inGroup.map((b) => (
                    <button key={b.slug} {...tileKeys(brands.indexOf(b))} type="button" aria-pressed={value === b.name} onClick={() => pick(b.name)} className={tile(value === b.name)}>
                      <span className="grid size-7 place-items-center rounded-[7px] bg-paper">
                        <img src={b.logo} alt="" draggable={false} className="size-[22px] object-contain" />
                      </span>
                      <span className="max-w-full truncate text-[11.5px] font-medium text-ink-2">{b.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
