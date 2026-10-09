import test from "node:test";
import assert from "node:assert/strict";
import { AIR_WALL_OTHER_COPY, airWallNotice } from "./air-wall-notice.ts";

test("the rule is for another copy of the app: one notice", () => {
  assert.equal(airWallNotice({ available: true, state: "other", program: "C:\\Mock\\old\\KAPEVault.exe" }), AIR_WALL_OTHER_COPY);
});

test("on, off, unenforced and unavailable: no notice", () => {
  assert.equal(airWallNotice({ available: true, state: "on" }), null);
  assert.equal(airWallNotice({ available: true, state: "off" }), null);
  assert.equal(airWallNotice({ available: true, state: "unenforced" }), null);
  assert.equal(airWallNotice({ available: false, reason: "unpacked" }), null);
  assert.equal(airWallNotice({ available: false, reason: "platform" }), null);
});
