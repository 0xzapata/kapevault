// useLockOnLeave's wiring: which events leave and come back, and that an unmounted or inactive hook listens
// to none. createLockOnLeave's clock is tested in host/lock-on-leave.test.mjs; this is the part around it,
// run outside a renderer by handing React the three hooks it uses (the phone has no DOM to mount into).
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { useLockOnLeave } from "./use-lock-on-leave.ts";

const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
const START = 1_000_000;

const clock = (t) => t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: START });

function mount(t, { active = true, grace = 30, hidden = false } = {}) {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: hidden ? "hidden" : "visible" });
  Object.assign(globalThis, { window, document });
  t.after(() => {
    delete globalThis.window;
    delete globalThis.document;
  });
  const state = { covered: false, locks: 0 };
  const effects = [];
  internals.H = { useState: () => [state.covered, (covered) => (state.covered = covered)], useRef: (current) => ({ current }), useEffect: (effect) => effects.push(effect) };
  try {
    useLockOnLeave(active, grace, () => state.locks++);
  } finally {
    internals.H = null;
  }
  const cleanup = effects[0]();
  return { state, window, document, cleanup };
}
const fire = (target, type) => target.dispatchEvent(new Event(type));
function setVisibility(m, state) {
  m.document.visibilityState = state;
  fire(m.document, "visibilitychange");
}
const hide = (m) => setVisibility(m, "hidden");
const show = (m) => setVisibility(m, "visible");

test("the shell's background event covers the vault, and its resume event uncovers it within the grace period", (t) => {
  clock(t);
  const m = mount(t);
  fire(m.window, "kapevault:background");
  assert.equal(m.state.covered, true);
  t.mock.timers.tick(10_000);
  fire(m.window, "kapevault:resume");
  assert.equal(m.state.covered, false);
  assert.equal(m.state.locks, 0);
});

test("the page going hidden leaves, and going visible again comes back", (t) => {
  clock(t);
  const m = mount(t);
  hide(m);
  assert.equal(m.state.covered, true);
  show(m);
  assert.equal(m.state.covered, false);
  assert.equal(m.state.locks, 0);
});

test("away for the grace period locks, whichever event left", (t) => {
  clock(t);
  const viaShell = mount(t);
  fire(viaShell.window, "kapevault:background");
  t.mock.timers.tick(30_000);
  assert.equal(viaShell.state.locks, 1);
  const viaPage = mount(t);
  hide(viaPage);
  t.mock.timers.tick(30_000);
  assert.equal(viaPage.state.locks, 1);
});

test("a hook that is not active, or was unmounted, listens to nothing", (t) => {
  clock(t);
  const idle = mount(t, { active: false });
  assert.equal(idle.cleanup, undefined);
  fire(idle.window, "kapevault:background");
  hide(idle);
  assert.equal(idle.state.covered, false);

  const gone = mount(t);
  gone.cleanup();
  fire(gone.window, "kapevault:background");
  hide(gone);
  t.mock.timers.tick(60_000);
  assert.equal(gone.state.covered, false);
  assert.equal(gone.state.locks, 0);
});

test("unmounting while away lifts the cover and cancels the pending lock", (t) => {
  clock(t);
  const m = mount(t);
  fire(m.window, "kapevault:background");
  assert.equal(m.state.covered, true);
  m.cleanup();
  assert.equal(m.state.covered, false);
  t.mock.timers.tick(60_000);
  assert.equal(m.state.locks, 0);
});

test("an unlock that finishes while the app is hidden arms the grace period, and coming back past it locks", (t) => {
  clock(t);
  const m = mount(t, { hidden: true });
  assert.equal(m.state.covered, true);
  t.mock.timers.tick(30_000);
  assert.equal(m.state.locks, 1);
  const back = mount(t, { hidden: true });
  t.mock.timers.tick(120_000);
  back.document.visibilityState = "visible";
  fire(back.window, "kapevault:resume");
  assert.equal(back.state.locks >= 1, true, "a frozen timer is caught on the way back");
});

test("hidden at mount with At once locks right away; hidden then back inside the grace period does not", (t) => {
  clock(t);
  assert.equal(mount(t, { hidden: true, grace: 0 }).state.locks, 1);
  const quick = mount(t, { hidden: true });
  t.mock.timers.tick(5_000);
  show(quick);
  assert.equal(quick.state.covered, false);
  assert.equal(quick.state.locks, 0);
});
