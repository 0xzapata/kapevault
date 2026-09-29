import { useState } from "react";
import { CloudSlash } from "@phosphor-icons/react";
import { Button } from "@/components/form";
import { vaultApi, type OpenerWrite } from "@/lib/vault-api";
import { DEVICE } from "@/lib/platform";
import { useAction } from "@/hooks/use-action";
import { CloudBackupSection } from "@/features/cloud/components/CloudBackupSection";
import { Group } from "@/features/settings/SettingRow";
import { useSync } from "@/features/sync/hooks/use-sync";
import { noBackup } from "@/features/sync/lib/sync-line";
import { useFolderCopy } from "../hooks/use-folder-copy";
import { FolderCopy } from "./FolderCopy";
import { OpenerCheck } from "./OpenerCheck";
import { ReplacedCopy } from "./ReplacedCopy";

interface SaveButtonProps {
  label: string;
  busyLabel: string;
  run: () => ReturnType<typeof vaultApi.saveCopy>;
  saved: (name: string, opener?: OpenerWrite) => string;
}

// A save-dialog action: canceled says nothing, success names the file, failure says why.
function SaveButton({ label, busyLabel, run, saved }: SaveButtonProps) {
  const action = useAction();
  const busy = action.busy;
  const [note, setNote] = useState({ text: "", error: false });

  function click() {
    setNote({ text: "", error: false });
    action.run(
      run,
      (result) => {
        if (!result.ok) setNote({ text: result.error, error: true });
        else if (!result.canceled) setNote({ text: saved(result.name ?? "the file", result.opener), error: false });
      },
      () => setNote({ text: "Could not save the file. Try again.", error: true }),
    );
  }

  return (
    <div className="space-y-2">
      <Button type="button" disabled={busy} onClick={click}>
        {busy ? busyLabel : label}
      </Button>
      {note.text && <p className={`text-[13px] ${note.error ? "text-danger" : "text-ok"}`}>{note.text}</p>}
    </div>
  );
}

const OPENER = "KAPEVault Opener.html";

// A saved copy says whether the Forever Opener landed beside it. A file of that name that is not an
// opener is never replaced, so the user is sent to Save Opener instead; one that claims a newer version
// was not checked, so the note never vouches for it.
function copySaved(name: string, opener?: OpenerWrite) {
  if (opener === "foreign") return `Saved ${name}. Another file there is already called ${OPENER}, so use Save Opener below.`;
  if (opener === "failed") return `Saved ${name}. The Opener could not be added - use Save Opener below.`;
  if (opener === "newer") return `Saved ${name}. The Opener already there says it is newer, so KAPEVault left it alone.`;
  return `Saved ${name}, with ${OPENER} beside it.`;
}

// Settings > Backup: R2, a copy kept in a folder, a local encrypted copy, the Forever Opener, the printable
// Emergency Kit, and restore from a file or of the vault the last restore replaced (replaced = its name,
// already picked).
export function BackupSection({ onRestoreFromFile }: { onRestoreFromFile: (replaced?: string) => void }) {
  const [includeKeys, setIncludeKeys] = useState(false);
  const folder = useFolderCopy();
  const sync = useSync();

  return (
    <>
      {noBackup(sync.status, folder.status) && (
        <p className="settle flex items-center gap-3 rounded-[12px] bg-field px-3.5 py-3 text-[12.5px] text-ink-3">
          <CloudSlash size={22} weight="duotone" className="shrink-0" />
          <span>
            <span className="block text-[13.5px] font-medium text-ink">No backup yet</span>
            Connect R2 or keep a copy in a folder, so a lost {DEVICE} does not take the vault with it.
          </span>
        </p>
      )}
      {/* CloudBackupSection draws its own divider for the old one-page layout; here it leads. */}
      <div className="[&>section]:mt-0 [&>section]:border-t-0 [&>section]:pt-0">
        <CloudBackupSection />
      </div>

      <FolderCopy copy={folder} />

      <Group title="Encrypted copy">
        <p className="-mt-2 text-[13px] text-ink-3">
          The vault file exactly as it is, saved where you choose. It opens with the same master password - keep it on a USB drive or another disk.
        </p>
        <SaveButton label="Save encrypted copy..." busyLabel="Saving..." run={() => vaultApi.saveCopy()} saved={copySaved} />
      </Group>

      <Group title="Forever Opener">
        <p className="-mt-2 text-[13px] text-ink-3">
          A page that opens your vault in any web browser, even without KAPEVault. Encrypted copies get one beside them.
        </p>
        <SaveButton label="Save Opener..." busyLabel="Saving..." run={() => vaultApi.saveOpener()} saved={(name) => `Saved ${name}. Keep it with your backups.`} />
        <OpenerCheck />
      </Group>

      <Group title="Emergency Kit">
        <p className="-mt-2 text-[13px] text-ink-3">
          A PDF to print and keep somewhere safe: where the vault lives, your R2 bucket, the steps to get back in, and a blank line to write your master password.
        </p>
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={includeKeys}
            onChange={(e) => setIncludeKeys(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-accent"
          />
          <span className="text-[13.5px] text-ink">
            Include the R2 keys
            <span className={`block text-[12.5px] ${includeKeys ? "text-danger" : "text-ink-3"}`}>
              {includeKeys
                ? "The PDF is not encrypted. Save it outside OneDrive or Drive, print it, then delete the file."
                : "Off by default. Anyone holding the keys can download your encrypted backups to try guessing the master password, or delete them. Only include them if the printout stays locked away."}
            </span>
          </span>
        </label>
        <SaveButton
          label="Save Emergency Kit..."
          busyLabel="Making the PDF..."
          run={() => vaultApi.emergencyKit(includeKeys)}
          saved={(name) => `Saved ${name}. It is open so you can print it.`}
        />
      </Group>

      <Group title="Restore">
        <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-3">
          <p className="min-w-[220px] flex-1 text-[13px] text-ink-3">
            Replace the vault on this {DEVICE} with a saved copy. Nothing changes unless that copy's master password opens it.
          </p>
          <Button type="button" className="shrink-0" onClick={() => onRestoreFromFile()}>
            Restore from a file...
          </Button>
        </div>
        <ReplacedCopy onRestore={onRestoreFromFile} />
      </Group>
    </>
  );
}
