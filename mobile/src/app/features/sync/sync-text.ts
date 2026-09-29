import type { SyncReview, SyncStatus } from "../../host/types";

// The words of the sync line and the review, the PC's (src/features/sync/lib/sync-line.ts) at phone
// size: quiet when nothing needs the user, and no nag when R2 is not connected (it is optional).

type SyncLineText = { text: string; tone: "quiet" | "warn" | "ok" };

// "DESKTOP-4F2A", "DESKTOP-4F2A and Pixel 8", "A, B and C".
export function deviceNames(list: string[]): string {
  if (list.length < 2) return list[0] ?? "Another device";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

// The line under the item count, most urgent first. ago: the page's relative time ("2 min ago").
export function syncLineText(status: SyncStatus, ago: (ms: number) => string): SyncLineText {
  if (status.state === "off") return { text: "No backup yet", tone: "quiet" };
  if (status.apart) return { text: "Backup only · the bucket holds another vault", tone: "quiet" };
  if (status.removed) return { text: "This phone was removed from sync", tone: "warn" };
  if (status.review) return { text: `Changes from ${deviceNames(status.review.from)} wait for you`, tone: "warn" };
  if (status.newMaster) return { text: `${status.newMaster} has a new master password`, tone: "warn" };
  if (status.state === "error") return { text: "Sync did not finish · tap to see why", tone: "warn" };
  if (status.problems.length) return { text: status.problems[0], tone: "warn" };
  const manual = status.manual ? " · only on Sync now" : "";
  if (status.lastAt) return { text: `Synced with ${status.peer ?? "your devices"} · ${ago(status.lastAt)}${manual}`, tone: "ok" };
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
