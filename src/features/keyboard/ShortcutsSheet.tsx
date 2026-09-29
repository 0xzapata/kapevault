import { Sheet } from "@/components/Sheet";
import { keys } from "@/lib/platform";

// The one list of shortcuts shown to the user. use-shortcuts.ts implements the same set.
const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Find",
    items: [
      [keys("mod", "K"), "Search"],
      ["/", "Search"],
      ["Up / Down", "Move through the list"],
      ["Esc", "Clear the search, or go back"],
      [keys("mod", "shift", "Space"), "Quick search from any app"],
    ],
  },
  {
    title: "Use the selected item",
    items: [
      ["Enter", "Copy password (or open a file link)"],
      [keys("mod", "C"), "Copy username"],
      [keys("mod", "shift", "C"), "Copy password"],
      [keys("mod", "alt", "C"), "Copy 2FA code"],
      [keys("mod", "O"), "Open website or link"],
    ],
  },
  {
    title: "Manage",
    items: [
      [keys("mod", "N"), "New item"],
      [keys("mod", "E"), "Edit item"],
      [keys("mod", "D"), "Add to or remove from favorites"],
      [keys("mod", "\\"), "Show or hide the sidebar"],
      [keys("mod", "L"), "Lock vault"],
      [keys("mod", ","), "Settings"],
      [keys("mod", "/"), "This list"],
    ],
  },
];

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Keyboard shortcuts" onClose={onClose} width="w-[520px]">
      <div className="space-y-6">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-[12.5px] font-semibold text-ink-3">{g.title}</h3>
            <dl className="divide-y divide-line rounded-2xl border border-line">
              {g.items.map(([combo, what]) => (
                <div key={`${combo}-${what}`} className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <dt className="text-[13.5px] text-ink">{what}</dt>
                  <dd>
                    <kbd className="whitespace-nowrap rounded-[6px] bg-field px-2 py-1 font-sans text-[12px] font-medium text-ink-2">{combo}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
