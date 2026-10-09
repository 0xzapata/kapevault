import { KindTile } from "@/features/vault/components/EntryIcon";
import { installFolderIssue } from "../lib/install-folder-issue";

// The Security list's row for a KAPEVault folder other accounts can change. Reinstalling is the fix and it
// happens outside the app, so unlike the master password row there is nothing to click.
export function InstallFolderIssueRow({ writers }: { writers: string[] }) {
  const issue = installFolderIssue(writers);
  if (!issue) return null;
  return (
    <li>
      <div className="row relative flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left">
        <KindTile kind="login" className="size-10 rounded-[11px]" />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold tracking-[-0.01em]">{issue.title}</span>
          <p className="text-[12.5px] text-warn">{issue.body}</p>
        </div>
      </div>
    </li>
  );
}
