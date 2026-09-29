// The item lists the phone's forms offer: core's values, with the phone's words.
import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../../../../../core/index.js";
import { DEVICE_TYPES, GRAB, KINDS, LINK_TYPES } from "../../lib/entries.ts";

test("the kind picker offers every kind core saves, in the phone's own order", () => {
  assert.deepEqual(KINDS.map((k) => k.value).sort(), [...core.KINDS].sort());
});

test("every link type, device type and grab choice core has comes with a label in the phone's list", () => {
  for (const [list, values] of [[LINK_TYPES, core.LINK_TYPES], [DEVICE_TYPES, core.DEVICE_TYPES], [GRAB, core.GRAB]]) {
    for (const value of values) {
      const label = list.find((o) => o.value === value)?.label;
      assert.ok(typeof label === "string" && label, `${JSON.stringify(value)} has no label`);
    }
  }
});
