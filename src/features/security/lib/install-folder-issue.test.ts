// Run with `npm test` (Node strips the types). The Security row for a shared install folder.
import test from "node:test";
import assert from "node:assert/strict";
import { installFolderIssue } from "./install-folder-issue.ts";

test("no other writers, no row", () => {
  assert.equal(installFolderIssue([]), null);
});

test("the row names who can write and what to do", () => {
  assert.equal(
    installFolderIssue(["Authenticated Users", "Users"])?.body,
    "Other accounts on this PC can change the KAPEVault folder (Authenticated Users, Users). Reinstall into a folder only you can write to.",
  );
});
