// Run with `npm test` (Node strips the types). Where Is It: rooms, grab labels, the Evacuate order.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { evacuationOrder, grabLabel, roomsUsed } from "./things.ts";
import type { Entry, GrabPriority, ThingEntry } from "@/features/vault/types";

const require = createRequire(import.meta.url);
const main = require("../../../../electron/evacuation.cjs");

const thing = (title: string, room: string, grab: GrabPriority) =>
  ({ id: title, kind: "thing", title, room, spot: `${title} spot`, grab, spaceId: "s", tags: [], favorite: false, notes: "", updatedAt: "2026-09-26", issues: [] }) as ThingEntry;

const things = [
  thing("Mock Spare keys", "Kitchen", 2),
  thing("Mock PSA birth certificate", "Bedroom", 1),
  thing("Mock Passport", "bedroom", 1),
  thing("Mock Photo albums", "Sala", 3),
  thing("Mock YubiKey", "", 1),
  thing("Mock Land title", "Attic", 1),
  thing("Mock Backup drive", "Attic", 2),
];

test("Evacuate order: grab first, then room (none last, any case), then title", () => {
  assert.deepEqual(
    evacuationOrder(things).map((t) => t.title),
    ["Mock Land title", "Mock Passport", "Mock PSA birth certificate", "Mock YubiKey", "Mock Backup drive", "Mock Spare keys", "Mock Photo albums"],
  );
});

test("the printed grab list names each grab as the Evacuate view does", () => {
  for (const grab of [1, 2, 3] as GrabPriority[]) assert.equal(main.GRAB_NAMES[grab], grabLabel(grab), "same words on paper and on screen");
});

test("rooms already used: once each, any case, A-Z, blanks and other kinds left out", () => {
  const note = { id: "n", kind: "note", title: "Mock note", hasBody: false, spaceId: "s", tags: [], favorite: false, notes: "", updatedAt: "2026-09-26", issues: [] } as Entry;
  assert.deepEqual(roomsUsed([...things, note, thing("Mock Deed", " Kitchen ", 1)]), ["Attic", "Bedroom", "Kitchen", "Sala"]);
});
