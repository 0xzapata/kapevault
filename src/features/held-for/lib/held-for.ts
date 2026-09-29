import type { Entry } from "@/features/vault/types";

// Held-For: items you keep for someone else (Mama, Papa, Lola). Pure, so it runs under `node --test`.

export interface Person {
  name: string;
  count: number;
}

// "Mama" and "mama " are one person.
export const personKey = (name: string | undefined) => (name ?? "").trim().toLowerCase();

// Everyone something is held for, A-Z, each named the way their first item spells it.
export function peopleHeldFor(entries: Entry[]): Person[] {
  const people = new Map<string, Person>();
  for (const e of entries) {
    const key = personKey(e.heldFor);
    if (!key) continue;
    const person = people.get(key);
    if (person) person.count += 1;
    else people.set(key, { name: e.heldFor!.trim(), count: 1 });
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}
