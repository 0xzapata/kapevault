import type { Entry, GrabPriority, ThingEntry } from "@/features/vault/types";
import { evacuationOrder } from "../../../../core/index.js";

// Where Is It: physical things and where they are kept. Pure, so it runs under `node --test`.

export const GRAB_OPTIONS: { value: GrabPriority; label: string }[] = [
  { value: 1, label: "Grab first" },
  { value: 2, label: "If there is time" },
  { value: 3, label: "Leave it" },
];

export const grabLabel = (grab: GrabPriority) => GRAB_OPTIONS.find((o) => o.value === grab)?.label ?? "";

// Suggested in the title field; anything else can be typed.
export const COMMON_THINGS = [
  "Passport",
  "PSA birth certificate",
  "PSA marriage certificate",
  "Land title",
  "Car OR/CR",
  "Insurance policy",
  "SSS card",
  "PhilHealth card",
  "UMID card",
  "Driver's license",
  "YubiKey",
  "Printed Emergency Kit",
  "Backup drive",
  "Spare keys",
];

export const isThing = (e: Entry): e is ThingEntry => e.kind === "thing";

// Rooms already used, A-Z, each spelled the way it was first typed ("Bedroom" and "bedroom" are one).
export function roomsUsed(entries: Entry[]): string[] {
  const rooms = new Map<string, string>();
  for (const e of entries) {
    const room = isThing(e) ? e.room.trim() : "";
    if (room && !rooms.has(room.toLowerCase())) rooms.set(room.toLowerCase(), room);
  }
  return [...rooms.values()].sort((a, b) => a.localeCompare(b));
}

// Grab first, then by room (things with no room last), then by title: core's rule, which the printed
// grab list (electron/evacuation.cjs) sorts with too.
export { evacuationOrder };
