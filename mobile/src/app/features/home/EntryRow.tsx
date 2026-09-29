import { Clock, Star } from "@phosphor-icons/react";
import { EntryIcon } from "../../components/icons";
import { subtitle } from "../../lib/entries";
import { issueLabel, worstIssue } from "../../lib/issues";
import type { Entry } from "../../host/types";

// A list row at the PC's sizes: 40 px tile, 14 px title, 12.5 px line; the one blue selected row.
// issues: the Security list shows the worst issue in place of the usual line.
export function EntryRow({ entry, selected, issues, onOpen }: { entry: Entry; selected: boolean; issues: boolean; onOpen: (id: string) => void }) {
  const issue = issues ? worstIssue(entry.issues) : undefined;
  const quiet = selected ? "text-on-accent-2" : "text-ink-3";
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        data-entry={entry.id}
        onClick={() => onOpen(entry.id)}
        className={`press flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left focus-ring [--focus-ring-offset:-2px] ${selected ? "bg-accent text-on-accent [--focus-ring-color:var(--color-on-accent)]" : "active:bg-hover"}`}
      >
        <EntryIcon entry={entry} size="sm" inverted={selected} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-semibold tracking-[-0.01em]">{entry.title}</span>
            {entry.favorite && <Star size={11} weight="fill" aria-label="Favorite" className={`shrink-0 ${selected ? "text-on-accent" : "text-sys-orange"}`} />}
            {entry.kind === "login" && entry.hasTotp && <Clock size={11} weight="bold" aria-label="Has 2FA code" className={`shrink-0 ${quiet}`} />}
          </span>
          <span className={`block truncate text-[12.5px] ${issue && !selected ? "text-warn" : quiet}`}>{issue ? issueLabel(issue) : subtitle(entry)}</span>
        </span>
      </button>
    </li>
  );
}
