import type { Entry } from "@/features/vault/types";

// Shrink Queue: a login being closed on purpose. No lifecycle = in use. Pure, so it runs under `node --test`.

// A closed account's tombstone: secrets wiped, kept only in the Closed list.
export const isGone = (e: Entry): boolean => e.kind === "login" && e.lifecycle?.state === "gone";

// Dormant or deletion requested: on its way out, listed under Closing.
export const isClosing = (e: Entry): boolean => e.kind === "login" && e.lifecycle !== undefined && e.lifecycle.state !== "gone";

// The company had its 30 days. today: local YYYY-MM-DD (dates compare as text).
export const followUpDue = (e: Entry, today: string) =>
  e.kind === "login" && e.lifecycle?.state === "deletion-requested" && e.lifecycle.followUpAt !== undefined && e.lifecycle.followUpAt <= today;
