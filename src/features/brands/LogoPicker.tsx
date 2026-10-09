import { useMemo, useRef, useState } from "react";
import { MagnifyingGlass, Prohibit, Sparkle } from "@phosphor-icons/react";
import { useRovingTiles } from "@/hooks/use-roving-tiles";
import { BrandLogo } from "./BrandLogo";
import { BRANDS, NO_BRAND, brandBySlug, detectBrand } from "./brands";

interface LogoPickerProps {
  value: string | undefined; // undefined = auto
  link: string;
  title: string;
  onChange: (value: string | undefined) => void;
}

export function LogoPicker({ value, link, title, onChange }: LogoPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const toggle = useRef<HTMLButtonElement>(null);
  const detected = detectBrand(link, title);
  const chosen = value && value !== NO_BRAND ? brandBySlug(value) : null;
  const shown = value === undefined ? detected : chosen;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = BRANDS.filter((b) => b.logo && (!q || b.name.toLowerCase().includes(q))); // the picker is of logos: a name-only brand has none to show
    return [...new Set(list.map((b) => b.group))].map((g) => ({ group: g, brands: list.filter((b) => b.group === g) }));
  }, [query]);
  // The choices in order, for the arrow keys: Auto-detect, No logo, then every logo shown.
  const choices = [undefined, NO_BRAND, ...groups.flatMap((g) => g.brands.map((b) => b.slug))];
  const tileKeys = useRovingTiles(choices.length, choices.indexOf(value));

  // Closing hands the focus back to the button: the tile or search that had it is gone.
  function close() {
    setOpen(false);
    toggle.current?.focus();
  }

  function pick(next: string | undefined) {
    onChange(next);
    setQuery("");
    close();
  }

  let label = "No logo";
  if (value === undefined) label = detected ? `Auto: ${detected.name}` : "Auto: none found";
  else if (chosen) label = chosen.name;

  const tile = (active: boolean) =>
    `press grid h-14 place-items-center rounded-[10px] border transition-colors focus-ring ${active ? "border-accent bg-accent-soft" : "border-line bg-raised hover:bg-hover"}`;

  return (
    <div>
      <button
        ref={toggle}
        type="button"
        onClick={() => setOpen(!open)}
        className="press flex h-10 w-full items-center gap-2.5 rounded-[10px] border border-line bg-raised px-3 text-left text-[14px] hover:bg-hover focus-ring"
      >
        <span className="grid size-6 place-items-center">
          {shown ? <BrandLogo brand={shown} size={20} /> : <Prohibit size={16} className="text-ink-3" />}
        </span>
        <span className="flex-1 truncate">{label}</span>
        <span className="text-[12.5px] text-accent">{open ? "Close" : "Change"}</span>
      </button>

      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: Escape handler for the picker as a whole; every control inside it is a real input or button
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
              // biome-ignore lint/a11y/noAutofocus: the picker is opened to search, so the search box is where typing goes
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search logos"
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-3"
            />
          </label>

          {/* Padded so a tile's focus ring is never clipped by the scroll box. */}
          <div className="-mx-1 mt-2 max-h-[248px] space-y-3 overflow-y-auto p-1">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" {...tileKeys(0)} onClick={() => pick(undefined)} className={`${tile(value === undefined)} h-10 grid-flow-col gap-2 text-[12.5px]`}>
                <Sparkle size={14} className="text-accent" /> Auto-detect
              </button>
              <button type="button" {...tileKeys(1)} onClick={() => pick(NO_BRAND)} className={`${tile(value === NO_BRAND)} h-10 grid-flow-col gap-2 text-[12.5px]`}>
                <Prohibit size={14} className="text-ink-3" /> No logo
              </button>
            </div>
            {groups.map(({ group, brands }) => (
              <section key={group}>
                <p className="mb-1.5 text-[11.5px] font-semibold text-ink-3">{group}</p>
                <div className="grid grid-cols-8 gap-1.5">
                  {brands.map((b) => (
                    <button key={b.slug} {...tileKeys(choices.indexOf(b.slug))} type="button" title={b.name} aria-label={b.name} onClick={() => pick(b.slug)} className={tile(value === b.slug)}>
                      <BrandLogo brand={b} size={24} />
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {groups.length === 0 && <p className="py-4 text-center text-[13px] text-ink-3">No logo called "{query}".</p>}
          </div>
        </div>
      )}
    </div>
  );
}
