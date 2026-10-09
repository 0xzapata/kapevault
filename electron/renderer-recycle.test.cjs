const test = require("node:test");
const assert = require("node:assert/strict");
const { recycleRenderer, BLANK } = require("./renderer-recycle.cjs");

// A web contents that logs what is asked of it. Loading the blank page moves the page to a new
// process (pid 2), as Chromium does for a different site; the old one (pid 1) exits `exitsAfter`
// polls later, or never.
function setup({ url = "app://kapevault/?theme=dark#quick", exitsAfter = 0, blankFails = false } = {}) {
  const log = [];
  let polls = 0;
  const pids = () => (exitsAfter !== null && polls++ >= exitsAfter ? [2] : [1, 2]);
  const kill = (pid) => log.push(`kill ${pid}`);
  const contents = {
    destroyed: false,
    isDestroyed: () => contents.destroyed,
    getURL: () => url,
    getOSProcessId: () => 1,
    loadURL: async (u) => {
      log.push(`load ${u}`);
      if (u === BLANK && blankFails) throw new Error("ERR_ABORTED");
    },
  };
  return { contents, log, options: { pids, kill, wait: async () => {}, graceMs: 1000 } };
}

test("the page moves to another process, waits for the old one to exit, then comes back", async () => {
  const { contents, log, options } = setup({ exitsAfter: 2 });
  await recycleRenderer(contents, options);
  assert.deepEqual(log, [`load ${BLANK}`, "load app://kapevault/?theme=dark#quick"]);
});

test("an old process that will not exit is killed before the page comes back", async () => {
  const { contents, log, options } = setup({ exitsAfter: null });
  await recycleRenderer(contents, options);
  assert.deepEqual(log, [`load ${BLANK}`, "kill 1", "load app://kapevault/?theme=dark#quick"]);
});

test("the page comes back in the theme chosen now", async () => {
  const { contents, log, options } = setup();
  await recycleRenderer(contents, { ...options, freshUrl: (u) => u.replace("theme=dark", "theme=classic") });
  assert.equal(log.at(-1), "load app://kapevault/?theme=classic#quick");
});

test("the page still comes back when the blank load fails", async () => {
  const { contents, log, options } = setup({ blankFails: true });
  await recycleRenderer(contents, options);
  assert.equal(log.at(-1), "load app://kapevault/?theme=dark#quick");
});

test("a closed window, or one that never loaded, is left alone", async () => {
  const closed = setup();
  closed.contents.destroyed = true;
  await recycleRenderer(closed.contents, closed.options);
  assert.deepEqual(closed.log, []);
  const unloaded = setup({ url: "" });
  await recycleRenderer(unloaded.contents, unloaded.options);
  assert.deepEqual(unloaded.log, []);
});

test("a window closed while its process was leaving gets no page", async () => {
  const { contents, log, options } = setup({ exitsAfter: 1 });
  options.wait = async () => {
    contents.destroyed = true;
  };
  await recycleRenderer(contents, options);
  assert.deepEqual(log, [`load ${BLANK}`]);
});

test("a window with no known process id is never waited on or killed (kill 0 would signal the app's own process group)", async () => {
  const { contents, log, options } = setup();
  contents.getOSProcessId = () => 0;
  options.pids = () => [0, 2];
  await recycleRenderer(contents, options);
  assert.deepEqual(log, [`load ${BLANK}`, "load app://kapevault/?theme=dark#quick"]);
});
