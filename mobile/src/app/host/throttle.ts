// Wrong master passwords - unlock, change master password and restore - share one throttle, as on the
// PC (electron/unlock-throttle.cjs): one guess at a time, and after 5 misses in a row a growing pause
// (1 s, 2 s, 4 s ... 30 s). The rule is core's (core/unlock-throttle.js); this is the phone's queue and
// file around it. The count lives in a file, so closing the app does not reset it; a success deletes it.
import { nextThrottle, readThrottle, throttleWait } from "@core";
import type { Store } from "./storage";

const FILE = "unlock-throttle.json";

type Attempt = { ok: boolean; rule?: boolean; newer?: boolean };
type State = ReturnType<typeof readThrottle>;

export function createThrottle(store: Store, now: () => number, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  let state: State | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  async function load() {
    try {
      return readThrottle(await store.read(FILE));
    } catch {
      return readThrottle(null); // unreadable: none saved
    }
  }

  async function save(next: State) {
    state = next;
    try {
      if (next.failed === 0) await store.remove(FILE);
      else await store.write(FILE, JSON.stringify(next));
    } catch {
      // the count still holds in memory for this run
    }
  }

  // local: false for a password proven on another file (a backup, a snapshot under a new master
  // password): see core nextThrottle.
  return function throttled<T extends Attempt>(attempt: () => Promise<T>, { local = true }: { local?: boolean } = {}): Promise<T> {
    const run = queue.then(async () => {
      const current = (state ??= await load());
      const wait = throttleWait(current, now());
      if (wait > 0) await sleep(wait);
      const result = await attempt();
      const next = nextThrottle(current, result, { local, now: now() });
      if (next !== current) await save(next);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  };
}
