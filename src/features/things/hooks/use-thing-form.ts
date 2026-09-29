import { useState } from "react";
import type { EntryInput, GrabPriority, ThingEntry } from "@/features/vault/types";

// The thing part of the item form: the room, the exact spot (required), how soon to grab it, and an
// ID's expiry ("" = none).
export function useThingForm(entry: ThingEntry | null) {
  const [room, setRoom] = useState(entry?.room ?? "");
  const [spot, setSpot] = useState(entry?.spot ?? "");
  const [grab, setGrab] = useState<GrabPriority>(entry?.grab ?? 2);
  const [expires, setExpires] = useState(entry?.expires ?? "");

  const problem = () => (spot.trim() ? "" : "Say where it is kept.");
  const input = (): Partial<EntryInput> => ({ room, spot, grab, expires });

  return { room, setRoom, spot, setSpot, grab, setGrab, expires, setExpires, problem, input };
}
