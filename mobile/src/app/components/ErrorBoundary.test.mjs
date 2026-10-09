// The root ErrorBoundary: a render error becomes a plain recovery screen that holds none of the error's
// text (it could carry a secret) and a button that reloads the page.
import test from "node:test";
import assert from "node:assert/strict";
import { ErrorBoundary, RECOVERY_TEXT, RECOVERY_BUTTON } from "./ErrorBoundary.ts";

const kids = (node) => [node?.props?.children].flat().filter((c) => c != null && typeof c !== "boolean");
const textOf = (node) => (node == null || typeof node === "boolean" ? "" : typeof node === "string" ? node : kids(node).map(textOf).join(" "));
const findButton = (node) => (node?.type === "button" ? node : kids(node).map((c) => (typeof c === "object" ? findButton(c) : null)).find(Boolean));

test("a healthy tree renders its children untouched", () => {
  const boundary = new ErrorBoundary({ children: "the vault" });
  assert.equal(boundary.render(), "the vault");
});

test("an error keeps only the fact of a failure, never its text", () => {
  const state = ErrorBoundary.getDerivedStateFromError(new Error("bad value hunter2-master-password"));
  assert.deepEqual(state, { failed: true });
});

test("the recovery screen says the one line, shows no error text and reloads on the button", (t) => {
  const boundary = new ErrorBoundary({ children: "the vault" });
  boundary.state = ErrorBoundary.getDerivedStateFromError(new Error("hunter2-master-password"));
  const screen = boundary.render();
  const shown = textOf(screen);
  assert.ok(shown.includes(RECOVERY_TEXT));
  assert.ok(!shown.includes("hunter2"));
  assert.ok(!shown.includes("the vault"));
  let reloads = 0;
  globalThis.window = { location: { reload: () => reloads++ } };
  t.after(() => delete globalThis.window);
  const button = findButton(screen);
  assert.equal(textOf(button), RECOVERY_BUTTON);
  button.props.onClick();
  assert.equal(reloads, 1);
});
