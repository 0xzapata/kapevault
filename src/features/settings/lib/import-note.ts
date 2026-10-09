// What the import screen says after a file was read. Run with `npm test` (Node strips the types).
import { plural } from "../../../lib/local-date.ts";

type Imported = { added: number; skipped: number; kept: number; deleted: boolean; name: string; source: string; notes: string[]; unreadable: { reason: string; count: number }[] };

export function importLines(result: Imported): string[] {
  const lines = [`Added ${plural(result.added, "item")} from ${result.source}.`];
  if (result.skipped) lines.push(`${plural(result.skipped, "item")} skipped, already in the vault.`);
  for (const { reason, count } of result.unreadable) lines.push(`${plural(count, "row")} skipped: ${reason}.`);
  lines.push(...result.notes);
  if (result.kept) lines.push(`Kept the file: ${plural(result.kept, "item")} could not be imported. It holds every password in plain text, delete it yourself once you are done.`);
  else if (result.deleted) lines.push("The file was deleted. It held every password in plain text.");
  else lines.push(`Could not delete ${result.name}. Delete it yourself, it holds every password in plain text.`);
  return lines;
}
