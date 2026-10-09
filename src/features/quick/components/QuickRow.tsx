import { Clock } from "@phosphor-icons/react";
import { EntryIcon } from "@/features/vault/components/EntryIcon";
import { entrySubtitle } from "@/features/vault/lib/entry-text";
import type { Entry } from "@/features/vault/types";

export const ROW_HEIGHT = 44;
export const optionId = (entryId: string) => `quick-opt-${entryId}`;

interface QuickRowProps {
  entry: Entry;
  spaceName: string;
  selected: boolean;
  onRun: () => void;
}

// One result. Hover only tints the row - the selection moves by keyboard or click, never by
// pointer position, so the list does not jump under a resting mouse while you type.
export function QuickRow({ entry, spaceName, selected, onRun }: QuickRowProps) {
  const tone = selected ? "bg-accent text-on-accent" : "hover:bg-hover";
  const quiet = selected ? "text-on-accent-2" : "text-ink-3";
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: an option of a listbox: the search field keeps the focus and owns the keys (aria-activedescendant), so the row is not a tab stop
    // biome-ignore lint/a11y/useFocusableInteractive: an option of a listbox: the search field keeps the focus and owns the keys (aria-activedescendant), so the row is not a tab stop
    <li
      id={optionId(entry.id)}
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA in HTML allows role option on a li
      role="option"
      aria-selected={selected}
      onClick={onRun}
      style={{ height: ROW_HEIGHT }}
      className={`row flex cursor-default items-center gap-3 rounded-[10px] px-2.5 ${tone}`}
    >
      {/* EntryIcon's small tile is 40px; scaled to 32 to fit the compact row. */}
      <span className="relative size-8 shrink-0">
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 scale-80">
          <EntryIcon entry={entry} size="sm" inverted={selected} />
        </span>
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[14px] font-semibold tracking-[-0.005em]">{entry.title}</p>
        <p className={`truncate text-[12px] ${quiet}`}>{entrySubtitle(entry, { orUrl: true })}</p>
      </div>
      {entry.kind === "login" && entry.hasTotp && (
        <span
          title="Has a 2FA code"
          className={`flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ${selected ? "bg-on-accent/20 text-on-accent" : "bg-field text-ink-2"}`}
        >
          <Clock size={11} weight="bold" />
          2FA
        </span>
      )}
      <span className={`max-w-[150px] shrink-0 truncate text-[12px] ${quiet}`}>{spaceName}</span>
    </li>
  );
}
