// clipboard.cjs against a fake clipboard: a copy that completes while the previous secret's clear is
// still reading the clipboard must keep its own marker, so its 30 s clear still fires.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createClipboard } = require("./clipboard.cjs");

class FakeItem {
  constructor(items) {
    this.items = items;
  }
}

function setup() {
  const state = { text: "", cleared: 0, readGate: null };
  const clipboard = {
    write: async (items) => {
      state.text = items[0].items["text/plain"];
    },
    // Samples the clipboard now, resolves only when the test lets it (after a later write).
    readText: async () => {
      const seen = state.text;
      if (state.readGate) await state.readGate;
      return seen;
    },
    clear: () => {
      state.cleared++;
      state.text = "";
    },
  };
  const clip = createClipboard({ clipboard, ClipboardItem: FakeItem, isMac: true, clearMs: 20 });
  return { state, clip };
}

test("a copy that completes during the previous clear's readText still auto-clears", async () => {
  const { state, clip } = setup();
  await clip.copyWithAutoClear("dummy-first-1");
  let release;
  state.readGate = new Promise((r) => (release = r));
  const clearing = clip.clearCopiedPassword(); // reads "dummy-first-1", resolves late
  await clip.copyWithAutoClear("dummy-second-2"); // completes while that read is pending
  state.readGate = null;
  release();
  await clearing;
  await new Promise((r) => setTimeout(r, 80)); // the second copy's own timer
  assert.equal(state.text, "", "the second secret was cleared by its timer");
  assert.equal(state.cleared, 1);
});

test("a plain copy is cleared after clearMs and a newer user copy is left alone", async () => {
  const { state, clip } = setup();
  await clip.copyWithAutoClear("dummy-first-1");
  state.text = "user typed this";
  await clip.clearCopiedPassword();
  assert.equal(state.text, "user typed this");
  assert.equal(state.cleared, 0);
  await clip.copyWithAutoClear("dummy-third-3");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(state.text, "");
});
