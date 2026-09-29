import { useRovingTiles } from "@/hooks/use-roving-tiles";
import type { ThemeChoice } from "@/lib/vault-api";

const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: "system", label: "System" },
  { id: "classic", label: "Classic" },
  { id: "dark", label: "Dark" },
  { id: "colorblind", label: "Colorblind" },
  { id: "contrast", label: "High contrast" },
];

// A tiny KAPEVault window drawn in that theme's own tokens: data-theme re-scopes every colour
// variable for the subtree, so the thumbnail can never drift from the real theme.
function Thumb({ theme }: { theme: string }) {
  return (
    <div data-theme={theme} className="absolute inset-0 flex bg-surface">
      <div className="w-[30%] space-y-1 bg-sidebar p-1.5">
        <div className="h-1.5 rounded-full bg-sys-blue" />
        <div className="h-1.5 w-3/4 rounded-full bg-line-strong" />
        <div className="h-1.5 w-2/3 rounded-full bg-line-strong" />
      </div>
      <div className="w-[36%] space-y-1 border-x border-line bg-canvas p-1.5">
        <div className="h-3 rounded-[3px] bg-accent" />
        <div className="h-1.5 w-3/4 rounded-full bg-ink-3" />
        <div className="h-1.5 w-1/2 rounded-full bg-line-strong" />
      </div>
      <div className="flex-1 p-1.5">
        <div className="h-5 rounded-[3px] bg-raised shadow-card" />
        <div className="mt-1.5 flex gap-1">
          <span className="size-1.5 rounded-full bg-ok" />
          <span className="size-1.5 rounded-full bg-warn" />
          <span className="size-1.5 rounded-full bg-danger" />
        </div>
      </div>
    </div>
  );
}

// One Tab stop on the chosen theme (System until the settings load); the arrows, Home and End choose.
export function ThemePicker({ value, disabled, onChange }: { value: ThemeChoice | undefined; disabled: boolean; onChange: (theme: ThemeChoice) => void }) {
  const tile = useRovingTiles(THEMES.length, THEMES.findIndex((t) => t.id === value), (i) => onChange(THEMES[i].id));

  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3">
      {THEMES.map((t, i) => {
        const checked = value === t.id;
        return (
          <button
            key={t.id}
            {...tile(i)}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(t.id)}
            className="flex flex-col items-center gap-1.5 rounded-[10px] focus-ring"
          >
            <span
              className={`press relative block aspect-[16/10] w-full overflow-hidden rounded-[8px] border border-line transition-shadow ${
                checked ? "ring-2 ring-accent ring-offset-2 ring-offset-raised" : ""
              }`}
            >
              {t.id === "system" ? (
                <>
                  <span className="absolute inset-0 [clip-path:inset(0_50%_0_0)]">
                    <Thumb theme="classic" />
                  </span>
                  <span className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
                    <Thumb theme="dark" />
                  </span>
                </>
              ) : (
                <Thumb theme={t.id} />
              )}
            </span>
            <span className={`text-[12px] ${checked ? "font-semibold text-ink" : "text-ink-2"}`}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
