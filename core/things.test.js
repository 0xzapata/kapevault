import test from "node:test";
import assert from "node:assert/strict";
import { evacuationOrder } from "./things.js";

const things = [
  { title: "Mock Spare keys", room: "Kitchen", spot: "hook by the back door", grab: 2 },
  { title: "Mock PSA birth certificate", room: "Bedroom", spot: "blue folder, top shelf of the bedroom cabinet", grab: 1 },
  { title: "Mock Passport", room: "bedroom", spot: "same blue folder", grab: 1 },
  { title: "Mock Photo albums", room: "Sala", spot: "bottom shelf", grab: 3 },
  { title: "Mock YubiKey", room: "", spot: "on my key ring", grab: 1 },
  { title: "Mock Land title", room: "Attic", spot: "tin box", grab: 1 },
  { title: "Mock Old ID", spot: "no room saved", grab: 1 },
];

test("grab first, then room (none last, any case), then title", () => {
  assert.deepEqual(
    evacuationOrder(things).map((t) => t.title),
    ["Mock Land title", "Mock Passport", "Mock PSA birth certificate", "Mock Old ID", "Mock YubiKey", "Mock Spare keys", "Mock Photo albums"],
  );
  assert.equal(things[0].title, "Mock Spare keys", "the input is not reordered");
});
