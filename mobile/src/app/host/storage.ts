// The phone's files, in the app's private data folder: the vault, settings.json, the unlock throttle,
// the fingerprint dates. Every write is write-new-then-swap, so a crash never leaves half a file.
//
// @capacitor/filesystem's rename deletes the target before renameTo (ion-android-filesystem 1.1.0,
// IONFILELocalFilesHelper.renameFile), so the swap has a gap: a crash inside it leaves only
// "<name>.next". That file was read back whole before the swap began, so reading finishes the swap.

// The few operations the store needs; capacitor-fs.ts is the app's, the tests use Node's fs.
export interface RawFs {
  read(name: string): Promise<string | null>; // null: no such file
  write(name: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>; // replaces `to`
  remove(name: string): Promise<void>; // a missing file is not an error
}

export interface Store {
  // valid: what a finished file looks like; a leftover ".next" that is not one is never swapped in.
  read(name: string, valid?: (text: string) => boolean): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

const SAVE_FAILED = "The phone did not save the file. Try again.";

export function createStore(fs: RawFs): Store {
  const next = (name: string) => `${name}.next`;
  return {
    async read(name, valid = () => true) {
      const text = await fs.read(name);
      if (text !== null) {
        // A swap that never started: the file is as it was, and the half-made copy is dropped.
        await fs.remove(next(name)).catch(() => {});
        return text;
      }
      const pending = await fs.read(next(name));
      if (pending === null || !valid(pending)) return null;
      await fs.rename(next(name), name);
      return pending;
    },
    async write(name, text) {
      await fs.write(next(name), text);
      if ((await fs.read(next(name))) !== text) {
        await fs.remove(next(name)).catch(() => {});
        throw new Error(SAVE_FAILED);
      }
      await fs.rename(next(name), name);
    },
    remove: (name) => fs.remove(name),
  };
}
