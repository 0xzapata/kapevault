// A revealed password, a half-typed master password and the vault list all sit in the page's heap,
// and garbage collection does not say when they go. A new renderer process takes the whole old heap
// with it (main keeps no page state: the page asks main for everything).
//
// forcefullyCrashRenderer + reload would do it, but a debugger attached to the page (the e2e runs)
// reads that as a crash and aborts. Loading a page of another site moves the window to a new process
// the ordinary way (Chromium gives a data: page its own process; measured with Electron 44, and
// about:blank does NOT move: it stays in the same process), and the old one exits. The pid is checked, not assumed: an old process that is still
// there after the grace period is killed, so the page never comes back into it.

const BLANK = "data:text/html,";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// pids: the processes the app has right now (app.getAppMetrics). freshUrl: the address to load again,
// from the current one. graceMs: how long the old process may take to exit by itself. kill and wait
// are replaceable for tests.
/**
 * @param {Electron.WebContents} contents
 * @param {{ pids: () => number[], freshUrl?: (url: string) => string, kill?: (pid: number) => void, wait?: (ms: number) => Promise<void>, graceMs?: number }} options
 */
async function recycleRenderer(contents, { freshUrl = (url) => url, pids, kill = (pid) => process.kill(pid), wait = sleep, graceMs = 3000 }) {
  const url = contents.isDestroyed() ? "" : contents.getURL();
  if (!url) return; // closed, or nothing loaded yet: nothing in a heap to clear
  const old = contents.getOSProcessId();
  try {
    await contents.loadURL(BLANK);
  } catch {
    // an interrupted load: the page still comes back below
  }
  for (let waited = 0; old > 0 && pids().includes(old); waited += 50) {
    if (waited >= graceMs) {
      kill(old);
      break;
    }
    await wait(50);
  }
  if (contents.isDestroyed()) return;
  await contents.loadURL(freshUrl(url)).catch(() => {});
}

module.exports = { recycleRenderer, BLANK };
