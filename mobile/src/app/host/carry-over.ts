// "Use the vault from <device>": the phone's own items join that vault as NEW items with new ids, so
// nothing typed on the phone is lost, and the next save stamps them as this phone's changes, so they
// sync to the other devices. The phone's Personal space maps to the vault's; a client joins the one of
// the same name, or comes over as a new client. Top-level fields are replaced, never edited in place.
import type { VaultData } from "./vault-file";

export function carryOver(data: VaultData, mine: VaultData): number {
  const personal = data.spaces.find((s) => s.kind === "personal")?.id;
  if (!personal) throw new Error("That vault has no Personal space.");
  const spaces = [...data.spaces];
  const spaceIds = new Map<string, string>();
  for (const s of mine.spaces) {
    const same = s.kind === "personal" ? spaces.find((t) => t.id === personal) : spaces.find((t) => t.kind === "client" && t.name.toLowerCase() === String(s.name).toLowerCase());
    if (same) spaceIds.set(s.id, same.id);
    else {
      const id = crypto.randomUUID();
      spaces.push({ ...s, id });
      spaceIds.set(s.id, id);
    }
  }
  const ids = new Map(mine.entries.map((e) => [e.id, crypto.randomUUID()]));
  const entries = mine.entries.map((e) => ({
    ...e,
    id: ids.get(e.id),
    spaceId: spaceIds.get(e.spaceId) ?? personal,
    ...(e.viaEntryId !== undefined && { viaEntryId: ids.get(e.viaEntryId) }), // a sign-in through another carried item
  }));
  data.spaces = spaces;
  data.entries = [...data.entries, ...entries];
  return entries.length;
}
