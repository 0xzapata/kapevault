import { KindTile } from "../../components/icons";

export const MASTER_ISSUE_TITLE = "Your master password is easy to guess";
export const MASTER_ISSUE_BODY = "It protects every backup of this vault. Change it to five unrelated words or a long random mix.";

// The Security list's one row that is not an item: the same row as an item's, opening the Change master password sheet.
export function MasterIssueRow({ onFix }: { onFix: () => void }) {
  return (
    <li>
      <button type="button" onClick={onFix} className="press flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left active:bg-hover focus-ring [--focus-ring-offset:-2px]">
        <KindTile kind="login" className="size-10 rounded-[11px]" size={19} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold tracking-[-0.01em]">{MASTER_ISSUE_TITLE}</span>
          <span className="block text-[12.5px] text-warn">{MASTER_ISSUE_BODY}</span>
        </span>
      </button>
    </li>
  );
}
