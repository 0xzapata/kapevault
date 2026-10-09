import { plural } from "../../../lib/local-date.ts";
import type { FolderCopyStatus, SyncReview, SyncStatus } from "@/lib/vault-api";

export type SyncLineText = { text: string; tone: "quiet" | "warn" } | null;

// Unlocked with no R2 connection and no copy folder: "No backup yet" in Settings > Backup and in place
// of the sync line. Nowhere outside the unlocked window (Blind Reminders).
export const noBackup = (status: SyncStatus | null, folder: FolderCopyStatus | null) => status?.off === "no-cloud" && folder?.folder === "";

// "Mock PC", "Mock PC and Pixel 8", "A, B and C".
export function deviceNames(list: string[]): string {
  if (list.length < 2) return list[0] ?? "Another device";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

const items = (n: number) => plural(n, "item");

// The line under the item count, most urgent first. null: nothing to say (no cloud backup, locked).
// ago: the page's relative time ("2 min ago"). manual: automatic backup is off, so nothing syncs by itself.
export function syncLine(status: SyncStatus, ago: (ms: number) => string): SyncLineText {
  if (status.off === "locked" || status.off === "no-cloud") return null;
  if (status.off === "no-id") return { text: "Sync is off: KAPEVault could not read its settings file", tone: "warn" };
  if (status.off === "restored") return { text: "Sync is paused after the restore", tone: "warn" };
  if (status.off === "removed") return { text: "This device was removed from sync", tone: "warn" };
  if (status.state === "running") return { text: "Syncing...", tone: "quiet" };
  if (status.review) return { text: `Changes from ${deviceNames(status.review.from)} wait for you`, tone: "warn" };
  if (status.newMaster) return { text: `${status.newMaster} has a new master password`, tone: "warn" };
  if (status.lockOut.length) return { text: `Finish locking out ${deviceNames(status.lockOut.map((d) => d.name))}`, tone: "warn" };
  if (status.error) return { text: `Not synced: ${status.error}`, tone: "warn" };
  if (status.problems.length) return { text: status.problems[0], tone: "warn" };
  const manual = status.manual ? " · only on Sync now" : "";
  if (status.lastSync) return { text: `Synced with ${deviceNames(status.lastSync.with)} · ${ago(status.lastSync.at)}${manual}`, tone: "quiet" };
  return { text: `Not synced yet${manual}`, tone: "quiet" };
}

// Why a sync waits for the user, one sentence per reason.
export function reviewSentences(review: SyncReview): string[] {
  const who = deviceNames(review.from);
  return review.reasons.map((reason) => {
    if (reason === "deletes") return `${who} wants to delete ${items(review.deleted.length)}.`;
    if (reason === "secrets") return `${who} changed passwords or other secrets on ${items(review.secretItems)}.`;
    if (reason === "epoch") return `${who} restored a backup and made it the vault on all devices.`;
    return `${who} set a new master password. After Apply it unlocks this vault too.`;
  });
}
