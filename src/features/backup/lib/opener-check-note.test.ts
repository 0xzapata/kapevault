// Run with `npm test` (Node strips the types). The words "Check my Opener" answers with.
import test from "node:test";
import assert from "node:assert/strict";
import { openerCheckNote } from "./opener-check-note.ts";

test("a genuine Opener says so with the version", () => {
  assert.deepEqual(openerCheckNote("genuine", "1.2.3"), { text: "This Opener is genuine (KAPEVault 1.2.3).", ok: true });
});

test("a changed Opener says it was replaced", () => {
  assert.deepEqual(openerCheckNote("replaced", "1.2.3"), { text: "The file there was not the real Opener - KAPEVault put the real one back (any other file is kept, renamed with .txt).", ok: false });
});

test("a missing Opener, a foreign file, no folder and a failure each get their own line", () => {
  const texts = (["missing", "foreign", "no-folder", "failed"] as const).map((r) => openerCheckNote(r, "1.2.3"));
  assert.ok(texts.every((n) => !n.ok));
  assert.equal(new Set(texts.map((n) => n.text)).size, 4);
  assert.match(texts[0].text, /not found/);
});
