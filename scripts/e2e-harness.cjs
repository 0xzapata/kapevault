// Shared launcher + checks for the end-to-end scripts (e2e.cjs, e2e-v2.cjs). Real Electron window,
// throwaway vault, shell stubbed so tests never open real Explorer / browser windows.
// Playwright comes through scripts/playwright.cjs (PLAYWRIGHT_PATH, else require("playwright")).
const { _electron: electron } = require("./playwright.cjs");
const path = require("path");

const APP = path.resolve(__dirname, "..");

function createHarness() {
  const results = [];

  function check(name, ok, detail = "") {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  }

  // extraEnv: KAPEVAULT_DATA_DIR (required), KAPEVAULT_R2_ENDPOINT, KAPEVAULT_BIOMETRIC_FAKE, ...
  async function launch(extraEnv) {
    const app = await electron.launch({
      executablePath: require(APP + "/node_modules/electron"),
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
    await page.waitForURL((u) => u.protocol === "file:" || u.protocol === "http:", { waitUntil: "domcontentloaded" });
    return { app, page, errors };
  }

  function report() {
    console.log(results.join("\n"));
    console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
    return results.every((r) => r.startsWith("PASS"));
  }

  return { results, check, launch, report };
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
