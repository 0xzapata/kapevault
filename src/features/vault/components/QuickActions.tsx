import { ArrowSquareOut, Check, Copy } from "@phosphor-icons/react";
import { explorerName } from "@/lib/platform";
import { useCopyAction } from "@/hooks/use-copy-action";
import { entryCopies, linkOf, openLabel } from "../lib/entry-actions";
import type { Entry } from "../types";

// The pill words two kinds its own way: a folder opens "in Explorer" (quick search: "Open folder"),
// and a key's link is "Open link" (quick search and the row menu: "Open website").
function pillLabel(entry: Entry): string {
  if (entry.kind === "link" && entry.linkType === "folder") return `Open in ${explorerName}`;
  return entry.kind === "key" ? "Open link" : openLabel(entry);
}

// The pills leave out a login's username, a key's ID and a Wi-Fi name (their rows copy them), but
// keep a thing's spot.
const pillCopies = (entry: Entry) => entryCopies(entry).filter((c) => c.slot !== "username" || entry.kind === "thing");

const pill = "press flex h-9 items-center gap-2 rounded-full px-4 text-[13.5px] font-semibold focus-ring";

function CopyPill({ label, primary, copy, toastText }: { label: string; primary: boolean; copy: () => Promise<unknown>; toastText: string }) {
  const { copied, run } = useCopyAction();
  const look = primary ? "bg-accent text-on-accent shadow-accent hover:brightness-110" : "bg-raised text-accent shadow-tile hover:bg-hover";
  return (
    <button type="button" onClick={() => run(copy, toastText)} className={`${pill} ${look}`}>
      {copied ? <Check size={15} weight="bold" className="swap-in" /> : <Copy size={15} weight="bold" />}
      {copied ? "Copied" : label}
    </button>
  );
}

// The one or two things you open an item to do, as pills under the title (Passwords-app style).
export function QuickActions({ entry, onOpen }: { entry: Entry; onOpen: () => void }) {
  const copies = pillCopies(entry);
  const link = linkOf(entry);
  if (copies.length === 0 && !link) return null;

  return (
    <div className="mt-5 flex flex-wrap justify-center gap-2">
      {copies.map((c, i) => (
        <CopyPill key={c.label} label={c.label} primary={i === 0} copy={c.run} toastText={c.toast} />
      ))}
      {link && (
        <button type="button" onClick={onOpen} className={`${pill} bg-raised text-accent shadow-tile hover:bg-hover`}>
          <ArrowSquareOut size={15} weight="bold" />
          {pillLabel(entry)}
        </button>
      )}
    </div>
  );
}
