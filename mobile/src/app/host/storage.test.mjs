// The phone's file store must survive a power cut. durableFs is a phone's flash with a page cache in front:
// a write is visible at once but reaches flash only when replace() syncs it (what DurableFile does), and
// crash() throws away everything that never reached flash.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStore } from "./storage.ts";

function durableFs({ flashed = {}, faults = {} } = {}) {
  const flash = new Map(Object.entries(flashed));
  let cache = new Map(flash);
  return {
    read: async (name) => cache.get(name) ?? null,
    // DurableFile.replace: write "<name>.tmp", sync it, atomic rename. A power cut before the sync leaves
    // the old file and a half tmp; after it, the new file.
    replace: async (name, text) => {
      if (faults.beforeSync?.(name)) throw new Error("power cut before the sync");
      flash.set(name, text);
      cache.set(name, text);
    },
    remove: async (name) => (flash.delete(name), cache.delete(name), undefined),
    // What a phone that was never synced would hold: the bytes are in the cache only.
    putUnflushed: (name, text) => cache.set(name, text),
    crash: () => (cache = new Map(flash)),
    flash,
  };
}

test("a power cut during a save leaves the old vault whole, and the next save works", async () => {
  const fs = durableFs({ flashed: { "vault.kapevault": "old" }, faults: { beforeSync: () => true } });
  const store = createStore(fs);
  await assert.rejects(store.write("vault.kapevault", "new"), /power cut/);
  fs.crash();
  assert.equal(await createStore(fs).read("vault.kapevault"), "old");
  fs.crash();
  const again = createStore(durableFs({ flashed: Object.fromEntries(fs.flash) }));
  await again.write("vault.kapevault", "new");
  assert.equal(await again.read("vault.kapevault"), "new");
});

test("a finished save is on flash: a power cut right after it keeps the new vault", async () => {
  const fs = durableFs({ flashed: { "vault.kapevault": "old" } });
  await createStore(fs).write("vault.kapevault", "new");
  fs.crash();
  assert.equal(await createStore(fs).read("vault.kapevault"), "new");
});

test("a save never leaves a second copy behind", async () => {
  const fs = durableFs();
  const store = createStore(fs);
  await store.write("vault.kapevault", "one");
  await store.write("vault.kapevault", "two");
  assert.deepEqual([...fs.flash.keys()], ["vault.kapevault"]);
});

test("an empty main file is not trusted: a valid .next takes its place and is kept until it has", async () => {
  const fs = durableFs({ flashed: { "vault.kapevault": "", "vault.kapevault.next": "{full}" } });
  const store = createStore(fs);
  assert.equal(await store.read("vault.kapevault", (t) => t.startsWith("{")), "{full}");
  assert.equal(fs.flash.get("vault.kapevault"), "{full}", "the good copy is the main file now");
  assert.ok(!fs.flash.has("vault.kapevault.next"));
});

test("a .next that is the only valid copy survives a failed promotion", async () => {
  const fs = durableFs({ flashed: { "vault.kapevault": "", "vault.kapevault.next": "{full}" }, faults: { beforeSync: () => true } });
  const store = createStore(fs);
  await assert.rejects(store.read("vault.kapevault", (t) => t.startsWith("{")), /power cut/);
  assert.equal(fs.flash.get("vault.kapevault.next"), "{full}");
});

test("a main file that is not valid and has no valid .next is returned as it is, not hidden as 'no vault'", async () => {
  const fs = durableFs({ flashed: { "vault.kapevault": "", "vault.kapevault.next": "{half" } });
  const store = createStore(fs);
  assert.equal(await store.read("vault.kapevault", (t) => t.startsWith("{") && t.endsWith("}")), "");
  assert.equal(fs.flash.get("vault.kapevault.next"), "{half", "nothing is deleted when nothing better exists");
});

test("a valid main file wins over a leftover .next, which is dropped", async () => {
  const fs = durableFs({ flashed: { "vault.kapevault": "{main}", "vault.kapevault.next": "{older}" } });
  assert.equal(await createStore(fs).read("vault.kapevault", (t) => t.startsWith("{")), "{main}");
  assert.ok(!fs.flash.has("vault.kapevault.next"));
});

test("only a .next exists (an old build crashed inside its delete-then-rename): reading finishes the swap", async () => {
  const fs = durableFs({ flashed: { "vault.kapevault.next": "{full}" } });
  assert.equal(await createStore(fs).read("vault.kapevault", (t) => t.startsWith("{")), "{full}");
  assert.equal(fs.flash.get("vault.kapevault"), "{full}");
});

test("no files at all reads as null", async () => {
  assert.equal(await createStore(durableFs()).read("vault.kapevault"), null);
});

test("a read waits for a save already running on the same file, and a read of another file does not", async () => {
  const fs = durableFs({ flashed: { "vault.kapevault": "old", "settings.json": "mock" } });
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const store = createStore({ ...fs, replace: async (name, text) => (await gate, fs.replace(name, text)) });
  const saving = store.write("vault.kapevault", "new");
  const reading = store.read("vault.kapevault");
  assert.equal(await store.read("settings.json"), "mock", "another file is not held up");
  release();
  await saving;
  assert.equal(await reading, "new", "the read ran after the save, not between its steps");
});

test("the app's saves go through DurableFile, never Filesystem's writeFile or rename", () => {
  const source = readFileSync(new URL("./native.ts", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.match(source, /replace: \(name, text\) => DurableFile\.replace\(\{ name, text \}\)/);
  assert.doesNotMatch(source, /Filesystem\.(writeFile|appendFile|rename|copy)/);
});
