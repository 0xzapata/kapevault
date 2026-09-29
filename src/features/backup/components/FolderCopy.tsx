import { FolderSimple } from "@phosphor-icons/react";
import { Button, ErrorText } from "@/components/form";
import { cardQuiet } from "@/components/buttons";
import { formatWhen } from "@/lib/format";
import { Group } from "@/features/settings/SettingRow";
import type { useFolderCopy } from "../hooks/use-folder-copy";

// The end of a path, where the names people know are: "OneDrive\KAPEVault", not "C:\Users\...".
const lastTwo = (dir: string) => dir.split(/[\\/]/).filter(Boolean).slice(-2).join(dir.includes("\\") ? "\\" : "/");

// Settings > Backup > Keep a copy in a folder. Off: Choose folder. On: the folder, its last copy, Change
// folder and Turn off.
export function FolderCopy({ copy }: { copy: ReturnType<typeof useFolderCopy> }) {
  const status = copy.status;
  if (!status) return null;

  return (
    <Group title="Keep a copy in a folder">
      <p className="-mt-2 text-[13px] text-ink-3">
        After each change the encrypted vault is copied into a folder you choose. A OneDrive, Google Drive or Dropbox folder keeps it off this PC.
      </p>
      {status.folder ? (
        <div className="settle flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] bg-field px-3.5 py-3">
          <FolderSimple size={22} weight="duotone" className={`shrink-0 ${status.error ? "text-danger" : "text-accent"}`} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-ink" title={status.folder}>
              {lastTwo(status.folder)}
            </p>
            <p className={`truncate text-[12.5px] ${status.error ? "text-danger" : "text-ink-3"}`}>{status.error || (status.at ? `Last copy ${formatWhen(status.at)}` : "No copy yet")}</p>
          </div>
          <Button type="button" className="h-8 shrink-0 bg-raised" onClick={copy.choose}>
            Change folder...
          </Button>
          <button type="button" className={cardQuiet} onClick={copy.stop}>
            Turn off
          </button>
        </div>
      ) : (
        <Button type="button" onClick={copy.choose}>
          Choose folder...
        </Button>
      )}
      {(status.opener === "foreign" || status.opener === "failed") && <p className="text-[12.5px] text-warn">The Opener could not go beside the copy. Use Save Opener below.</p>}
      <ErrorText message={copy.error} />
    </Group>
  );
}
