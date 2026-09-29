import { useId } from "react";
import { Label, TextInput } from "@/components/form";
import { Segmented } from "@/components/Segmented";
import type { Entry } from "@/features/vault/types";
import { ExpiresField } from "@/features/vault/components/ExpiresField";
import { GRAB_OPTIONS, roomsUsed } from "../lib/things";
import type { useThingForm } from "../hooks/use-thing-form";

// The thing part of the item form: where it is, and whether to grab it in a hurry.
export function ThingFields({ thing, entries }: { thing: ReturnType<typeof useThingForm>; entries: Entry[] }) {
  const { room, setRoom, spot, setSpot, grab, setGrab } = thing;
  const roomsId = useId();

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[170px_1fr]">
        {/* Rooms already used come up as suggestions, so "Bedroom" stays one room. */}
        <Label text="Room (optional)">
          <TextInput value={room} onChange={(e) => setRoom(e.target.value)} list={roomsId} placeholder="Bedroom" autoComplete="off" />
          <datalist id={roomsId}>
            {roomsUsed(entries).map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Label>
        <Label text="Where exactly">
          <TextInput value={spot} onChange={(e) => setSpot(e.target.value)} placeholder="Blue folder, top shelf of the cabinet" autoComplete="off" />
        </Label>
      </div>
      <div>
        <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">In a hurry</span>
        <Segmented label="In a hurry" options={GRAB_OPTIONS} value={grab} onChange={setGrab} className="grid-cols-3" />
      </div>
    </>
  );
}

// An ID's expiry (passport, license): optional, so it sits under the form's More options.
export function ThingExpires({ thing }: { thing: ReturnType<typeof useThingForm> }) {
  return <ExpiresField value={thing.expires} onChange={thing.setExpires} />;
}
