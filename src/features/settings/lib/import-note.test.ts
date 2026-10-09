import test from "node:test";
import assert from "node:assert/strict";
import { importLines } from "./import-note.ts";

const base = { added: 2, skipped: 0, kept: 0, deleted: true, name: "mock.csv", source: "Chrome / Edge / Brave (CSV)", notes: [], unreadable: [] };

test("every branch that leaves the file on disk says it holds passwords in plain text", () => {
  const kept = importLines({ ...base, kept: 1, deleted: false }).join("\n");
  const stuck = importLines({ ...base, deleted: false }).join("\n");
  assert.match(kept, /Kept the file: 1 item could not be imported\./);
  assert.match(kept, /every password in plain text/);
  assert.match(stuck, /every password in plain text/);
});

test("a deleted file says it held the passwords in plain text", () => {
  assert.match(importLines(base).join("\n"), /The file was deleted\. It held every password in plain text\./);
});
