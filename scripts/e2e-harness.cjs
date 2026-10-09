// Shared launcher + checks for the end-to-end scripts (e2e.cjs, e2e-v2.cjs). Real Electron window,
// throwaway vault, shell stubbed so tests never open real Explorer / browser windows.
// Playwright comes through scripts/playwright.cjs (PLAYWRIGHT_PATH, else require("playwright")).
const { _electron: electron } = require("./playwright.cjs");
const path = require("node:path");

const APP = path.resolve(__dirname, "..");

function createHarness() {
  const results = [];

  function check(name, ok, detail = "") {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
  }

  // extraEnv: KAPEVAULT_DATA_DIR (required), KAPEVAULT_R2_ENDPOINT, KAPEVAULT_BIOMETRIC_FAKE, ...
  async function launch(extraEnv) {
    const app = await electron.launch({
      executablePath: require(`${APP}/node_modules/electron`),
      args: [APP],
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ELECTRON_RUN_AS_NODE")),
        KAPEVAULT_AUTO_LOCK_SECONDS: "86400", // synthetic input never resets the OS idle clock
        ...extraEnv,
      },
    });
    await app.evaluate(({ shell }) => {
      globalThis.__opened = [];
      shell.openExternal = async (u) => globalThis.__opened.push(["external", u]);
      shell.openPath = async (p) => { globalThis.__opened.push(["path", p]); return ""; };
      shell.showItemInFolder = (p) => globalThis.__opened.push(["reveal", p]);
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // An HTML preview opens with scripts off, and Chromium reports that intended block as a console
    // error. It is the lockdown working, not a page error.
    const expected = /^Blocked script execution in 'kapevault-file:/;
    page.on("console", (m) => m.type() === "error" && !expected.test(m.text()) && errors.push(m.text()));
    // A throwing IPC handler only reaches the page as a generic failure; its real message is on the
    // main process's stderr ("Error occurred in handler for 'x': TypeError: ..."). Surface programming
    // errors only - plain `Error:` rejections (a missing path, a blocked read) are what tests provoke.
    const bug = /Error occurred in handler for '[^']+': (TypeError|ReferenceError|SyntaxError|RangeError)|Uncaught/;
    app.process().stderr.on("data", (d) => {
      for (const line of String(d).split("\n")) if (bug.test(line)) errors.push(`main: ${line.trim()}`);
    });
    // firstWindow() can hand back the window while it is still on about:blank; an evaluate then dies
    // with "execution context was destroyed" when the real page navigates in (1 run in 3).
    await page.waitForURL((u) => u.protocol === "app:" || u.protocol === "http:", { waitUntil: "domcontentloaded" });
    lastPage = page;
    return { app, page, errors };
  }

  // A CRASH line alone says what timed out, not what the window showed: the last launched window is
  // saved as a picture, and its path printed, before the script exits.
  let lastPage = null;
  async function crashShot(name) {
    if (!lastPage || lastPage.isClosed()) return;
    const file = path.join(require("node:os").tmpdir(), `kapevault-${name}-crash.png`);
    await lastPage.screenshot({ path: file, timeout: 5000 }).then(() => console.log("CRASH screen:", file), () => {});
  }

  // Every lock moves each window to a new renderer (renderer-recycle.cjs): the page goes to a blank
  // page and loads again. A test locks through this: it runs `action` (a click, an in-page call, a
  // main-side lock), sees main start that lock's swap (a counter, so an earlier lock's finished swap is
  // not mistaken for it), waits for the swap, then for the page. An in-page call whose page is torn
  // down before it answers is expected - its result never comes back.
  async function lockedBy(app, page, action) {
    const before = await app.evaluate(() => globalThis.__kapevaultRecycles());
    await action().catch((e) => {
      if (!/Execution context was destroyed|Target page, context or browser has been closed/.test(String(e?.message))) throw e;
    });
    const began = await waitFor(() => app.evaluate(() => globalThis.__kapevaultRecycles()).then((n) => n > before), 10000);
    if (!began) throw new Error("the lock never started a renderer swap");
    await app.evaluate(() => globalThis.__kapevaultRecycled());
    await page.waitForURL((u) => u.protocol === "app:" || u.protocol === "http:", { waitUntil: "domcontentloaded" });
  }

  function report() {
    console.log(results.join("\n"));
    console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
    return results.every((r) => r.startsWith("PASS"));
  }

  return { results, check, launch, lockedBy, crashShot, report };
}

const shows = (loc, timeout = 4000) => loc.first().waitFor({ timeout }).then(() => true, () => false);
const gone = (loc) => loc.first().waitFor({ state: "hidden", timeout: 4000 }).then(() => true, () => false);
const clip = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const opened = (app) => app.evaluate(() => globalThis.__opened);
const waitFor = async (fn, ms = 4000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return true;
  return fn();
};

module.exports = { APP, createHarness, shows, gone, clip, opened, waitFor };
