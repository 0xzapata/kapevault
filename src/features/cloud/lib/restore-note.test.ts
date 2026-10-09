// Run with `npm test` (Node strips the types). The toast after a restore.
import test from "node:test";
import assert from "node:assert/strict";
import { restoredNote } from "./restore-note.ts";

test("the note says what happened to the vault the restore replaced", () => {
  assert.equal(restoredNote({}, "PC"), "Backup restored");
  assert.match(restoredNote({ keptCopy: true }, "PC"), /^Backup restored\. The vault it replaced is kept on this PC - Settings/);
  assert.equal(restoredNote({ keptCloud: true }, "PC"), "Backup restored. The vault it replaced is in your cloud backups, and cloud backup is still set up.");
});

test("a restore that kept the current master password says so in one plain line, whatever else it kept", () => {
  const line = "The vault keeps your current master password.";
  assert.equal(restoredNote({ keptKey: true }, "PC"), `Backup restored. ${line}`);
  assert.ok(restoredNote({ keptCopy: true, keptKey: true }, "PC").endsWith(` ${line}`));
  assert.ok(restoredNote({ keptCloud: true, keptKey: true }, "PC").endsWith(` ${line}`));
  assert.ok(!restoredNote({ keptCopy: true }, "PC").includes("master password"));
});
