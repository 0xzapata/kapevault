import { copyCode, copyIn, copyUsername, linkOf, openEntry, openLabel, primaryAction, primaryCopy } from "../../vault/lib/entry-actions.ts";
import type { Entry } from "@/features/vault/types";

export type QuickActionId = "primary" | "secondary" | "totp" | "open" | "show";

export interface QuickAction {
  id: QuickActionId;
  label: string; // footer hint, e.g. "Copy password"
  opens: boolean; // opening something hides the window at once; a copy shows its confirmation first
}

// Every action that applies to this item, in footer priority order. The primary one is
// primaryAction's: a link opens; anything else copies its secret, then its username, then opens.
export function quickActions(entry: Entry): QuickAction[] {
  const actions: QuickAction[] = [];
  const first = primaryCopy(entry);
  if (first) actions.push({ id: "primary", label: first.label, opens: false });
  else if (linkOf(entry)) actions.push({ id: "primary", label: openLabel(entry), opens: true });
  const username = copyIn(entry, "username");
  if (username && first?.slot !== "username") actions.push({ id: "secondary", label: username.label, opens: false });
  const code = copyIn(entry, "totp");
  if (code) actions.push({ id: "totp", label: code.label, opens: false });
  if (linkOf(entry)) actions.push({ id: "open", label: openLabel(entry), opens: true });
  actions.push({ id: "show", label: "Show in KAPEVault", opens: true });
  return actions;
}

// The footer hints: when Enter already opens the link, the mod+O hint would only repeat it.
export const footerHints = (actions: QuickAction[]) => actions.filter((a) => a.id !== "open" || !(actions[0].id === "primary" && actions[0].opens));

// Runs one action through the shared entry actions (the main process clears copied secrets after
// 30s and records the use). Returns the confirmation text, or null when nothing applied.
export function runQuickAction(entry: Entry, id: Exclude<QuickActionId, "show">): Promise<string | null> {
  switch (id) {
    case "primary":
      return primaryAction(entry);
    case "secondary":
      return copyUsername(entry);
    case "totp":
      return copyCode(entry);
    case "open":
      return openEntry(entry);
  }
}
