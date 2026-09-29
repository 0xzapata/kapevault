// Run with `npm test` (Node strips the types). Which list a login belongs to while it is being closed.
import test from "node:test";
import assert from "node:assert/strict";
import type { Entry, Lifecycle } from "../../vault/types.ts";
import { followUpDue, isClosing, isGone } from "./lifecycle.ts";

const login = (lifecycle?: Lifecycle) => ({ kind: "login", lifecycle }) as Entry;
const TODAY = "2026-10-26";

test("in use, dormant, requested and gone land in the right list", () => {
  const cases: [Lifecycle | undefined, boolean, boolean][] = [
    [undefined, false, false],
    [{ state: "dormant" }, true, false],
    [{ state: "deletion-requested", requestedAt: "2026-09-26", followUpAt: TODAY }, true, false],
    [{ state: "gone", goneAt: TODAY }, false, true],
  ];
  for (const [lifecycle, closing, gone] of cases) {
    assert.equal(isClosing(login(lifecycle)), closing, lifecycle?.state ?? "in use");
    assert.equal(isGone(login(lifecycle)), gone, lifecycle?.state ?? "in use");
  }
  assert.equal(isClosing({ kind: "note" } as Entry), false);
});

test("a follow-up is due on its day and after, and only while deletion is requested", () => {
  const requested = (followUpAt: string) => login({ state: "deletion-requested", requestedAt: "2026-09-26", followUpAt });
  assert.equal(followUpDue(requested("2026-10-27"), TODAY), false);
  assert.equal(followUpDue(requested(TODAY), TODAY), true);
  assert.equal(followUpDue(requested("2026-10-01"), TODAY), true);
  assert.equal(followUpDue(login({ state: "dormant" }), TODAY), false);
  assert.equal(followUpDue(login({ state: "gone", requestedAt: "2026-09-01", goneAt: TODAY }), TODAY), false);
});
