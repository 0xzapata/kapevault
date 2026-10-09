// Run with `npm test` (Node strips the types). The line under the Unlock switch when it cannot be turned on.
import test from "node:test";
import assert from "node:assert/strict";
import { unsupportedNote } from "./biometric-note.ts";

test("a PC whose policy blocks Windows Hello says so instead of asking for setup", () => {
  assert.equal(unsupportedNote({ blockedByPolicy: true }, false), "This PC's policy blocks Windows Hello for KAPEVault.");
});

test("without a policy block, Windows asks to set Hello up and a Mac says Touch ID is missing", () => {
  assert.equal(unsupportedNote({}, false), "Set up Windows Hello first: Windows Settings > Accounts > Sign-in options.");
  assert.equal(unsupportedNote({ blockedByPolicy: false }, false), "Set up Windows Hello first: Windows Settings > Accounts > Sign-in options.");
  assert.equal(unsupportedNote({}, true), "Touch ID is not available on this Mac.");
});
