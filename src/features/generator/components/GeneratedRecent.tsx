import { useState } from "react";
import { CaretDown, Eye, EyeSlash } from "@phosphor-icons/react";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { CopyButton, IconButton } from "@/components/IconButton";
import { useReveal } from "@/hooks/use-reveal";
import { relativeTime } from "@/lib/local-date";
import { vaultApi, type GeneratedRow } from "@/lib/vault-api";

// One recent value: masked until shown, fetched from main by its place in the list.
function RecentRow({ row, index }: { row: GeneratedRow; index: number }) {
  const { value, toggle } = useReveal(() => vaultApi.getGenerated(index));
  return (
    <li className="flex min-h-11 items-center gap-1 pl-1">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-ink-3">{relativeTime(Date.parse(row.at))}</p>
        <p className="selectable truncate font-mono text-[13px] tracking-wide">{value ?? "•".repeat(14)}</p>
      </div>
      <IconButton label={value === null ? "Show password" : "Hide password"} onClick={toggle}>
        {value === null ? <Eye size={16} /> : <EyeSlash size={16} />}
      </IconButton>
      <CopyButton label="Copy password" copy={() => vaultApi.copyGenerated(index)} toastText="Password copied - clears in 30s" />
    </li>
  );
}

interface GeneratedRecentProps {
  rows: GeneratedRow[]; // newest first; the values stay in main
  onClear: () => Promise<void>;
}

// The generator's last values, closed by default: a password that left the generator is here even when
// the item form was lost before it was saved.
export function GeneratedRecent({ rows, onClear }: GeneratedRecentProps) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 border-t border-line pt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="generated-recent"
        onClick={() => setOpen(!open)}
        className="press flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-1 text-left text-[13px] font-medium text-ink-2 hover:bg-hover focus-ring"
      >
        Recent ({rows.length})
        <CaretDown size={14} weight="bold" className={`shrink-0 text-ink-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id="generated-recent" className="settle">
          <ul className="max-h-[188px] overflow-y-auto">
            {rows.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: recent passwords are addressed by position; the timestamp in the key makes a shifted list remount its rows, so a revealed password never sticks to another one
              <RecentRow key={`${row.at}-${i}`} row={row} index={i} />
            ))}
          </ul>
          <div className="flex items-center justify-end gap-2 pt-1">
            <ConfirmDelete label="Clear" onConfirm={onClear} />
          </div>
        </div>
      )}
    </div>
  );
}
