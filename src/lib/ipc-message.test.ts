// Run with `npm test` (Node strips the types). Main's error text, without Electron's IPC wrapper.
import test from "node:test";
import assert from "node:assert/strict";
import { ipcMessage, isIpcError } from "./ipc-message.ts";

test("ipcMessage strips the wrapper and the error class", () => {
  assert.equal(ipcMessage(new Error("Error invoking remote method 'vault:save': Error: The vault is locked.")), "The vault is locked.");
  assert.equal(ipcMessage(new Error("Error invoking remote method 'vault:save': TypeError: bad input ")), "bad input");
  assert.equal(ipcMessage(new Error("Error invoking remote method 'vault:save': plain words")), "plain words");
});

test("ipcMessage leaves a page error or a thrown string as it is", () => {
  assert.equal(ipcMessage(new Error("Photo could not be read")), "Photo could not be read");
  assert.equal(ipcMessage("text"), "text");
});

test("isIpcError tells main's errors from the page's own", () => {
  assert.equal(isIpcError(new Error("Error invoking remote method 'device:readLabel': Error: busy")), true);
  assert.equal(isIpcError(new Error("That image is too big")), false);
  assert.equal(isIpcError("Error invoking remote method 'x': y"), false);
});
