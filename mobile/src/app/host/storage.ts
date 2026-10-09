// The phone's files, in the app's private data folder: the vault, settings.json, the unlock throttle,
// the fingerprint dates. Every write goes through DurableFile (synced to flash, then one atomic rename),
// so a power cut leaves the old file or the new one, never half of either.
//
// "<name>.next" is what builds before this one left behind: they wrote it, read it back, deleted the
// target and renamed (ion-android-filesystem 1.1.0, no sync anywhere). A crash in that gap leaves only
// the ".next", and a power cut could leave an empty main file, so reading still falls back to it.

// The few operations the store needs; native.ts is the app's, the tests use Node's fs.
export interface RawFs {
  read(name: string): Promise<string | null>; // null: no such file
  replace(name: string, text: string): Promise<void>; // the old text or the new, whatever happens
  remove(name: string): Promise<void>; // a missing file is not an error
}

export interface Store {
  // valid: what a finished file looks like; a leftover ".next" that is not one is never swapped in.
  read(name: string, valid?: (text: string) => boolean): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export function createStore(fs: RawFs): Store {
  const next = (name: string) => `${name}.next`;
  // One file's reads and writes run one at a time: a read between a save's steps could see the file
  // half way through being replaced by the fallback below.
  const queues = new Map<string, Promise<unknown>>();
  const inTurn = <T>(name: string, job: () => Promise<T>): Promise<T> => {
    const run = (queues.get(name) ?? Promise.resolve()).then(job);
    queues.set(name, run.catch(() => {}));
    return run;
  };
  return {
    read: (name, valid = () => true) => inTurn(name, () => readFile(name, valid)),
    write: (name, text) => inTurn(name, () => fs.replace(name, text)),
    remove: (name) => inTurn(name, () => fs.remove(name)),
  };

  async function readFile(name: string, valid: (text: string) => boolean) {
    const text = await fs.read(name);
    if (text !== null && valid(text)) {
      // A leftover from an older build's swap that never finished: the file is whole, the copy is stale.
      await fs.remove(next(name)).catch(() => {});
      return text;
    }
    // Missing, empty or damaged: an older build's finished copy is better. It becomes the main file
    // first and is deleted only after that, so a failure in between never costs the only good copy.
    const pending = await fs.read(next(name));
    if (pending !== null && valid(pending)) {
      await fs.replace(name, pending);
      await fs.remove(next(name)).catch(() => {});
      return pending;
    }
    return text; // nothing better: the caller sees what is really there (null means no file)
  }
}
