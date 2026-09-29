import type { RestoreKept } from "@/lib/vault-api";
import { DEVICE } from "@/lib/platform";

// What a finished restore did with the vault it replaced, in one line for the toast. Neither = there
// was no vault here to keep (a new PC), or the user chose to replace it with no copy kept.
export function restoredNote({ keptCopy, keptCloud }: RestoreKept): string {
  if (keptCopy) return `Backup restored. The vault it replaced is kept on this ${DEVICE} - Settings, Backup can bring it back.`;
  if (keptCloud) return "Backup restored. The vault it replaced is in your cloud backups, and cloud backup is still set up.";
  return "Backup restored";
}
