import type { RestoreKept } from "../../../lib/vault-api.ts";

// What a finished restore did with the vault it replaced, in one line for the toast. Neither = there
// was no vault here to keep (a new PC), or the user chose to replace it with no copy kept. keptKey adds
// that the vault stays under the master password it had (a lock-out had retired the backup's, SYNC.md 3.7).
export function restoredNote({ keptCopy, keptCloud, keptKey }: RestoreKept, device: string): string {
  const key = keptKey ? " The vault keeps your current master password." : "";
  if (keptCopy) return `Backup restored. The vault it replaced is kept on this ${device} - Settings, Backup can bring it back.${key}`;
  if (keptCloud) return `Backup restored. The vault it replaced is in your cloud backups, and cloud backup is still set up.${key}`;
  return keptKey ? `Backup restored.${key}` : "Backup restored";
}
