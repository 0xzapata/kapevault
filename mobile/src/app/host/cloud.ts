// Cloud backup to the user's own R2 bucket, the PC's way (electron/cloud-backup.cjs): the vault file
// exactly as it sits on disk goes up as a new snapshot under this install's id, a few seconds after a
// change; each install thins out only its own snapshots. Never plaintext, never a key.
import { MAX_VAULT_BYTES, SNAPSHOT_PREFIXES, readSnapshotKey, snapshotKey, snapshotsToPrune } from "@core";
import { snapshotNote } from "./pro";
import { sha256Hex } from "./sha256";
import type { Backup } from "./types";
import type { CloudConfig, R2Client, R2Object } from "./r2";
import type { Store } from "./storage";

// core/sync/snapshots.js names a snapshot, reads its key (who made it - null before install ids -, its
// name time, whether it is a restore's undo copy, a backup-only one (a phone without Pro) or from before
// the rename; null for anything else, like the Forever Opener page) and decides which to thin out, the
// same way on the PC.
export { readSnapshotKey, snapshotKey, snapshotsToPrune };

const PENDING = "backup-pending"; // a backup still owed, noted on disk so a killed app does not forget it
// The snapshot keys this phone put in the bucket (the PC's sent-snapshots.json): anyone with the R2 keys
// can name objects under this phone's id, and only what it sent is ever pruned against or called its own.
const SENT = "sent-snapshots.json";

// Every object under both snapshot folders (the current name and the pre-rename one).
export async function listSnapshots(r2: R2Client) {
  const lists: R2Object[] = [];
  for (const prefix of SNAPSHOT_PREFIXES) lists.push(...(await r2.list(prefix)));
  return lists;
}

// The backups first run offers, newest first by R2's clock. A snapshot's key names only the install
// that made it, so before one is opened the phone can tell only "this phone" from "the PC". sent: the
// keys this phone put there (null: none kept yet) - one under its id that it never sent is not its own.
// An object bigger than any vault is left out: the phone would read it whole.
export function backupsOf(objects: R2Object[], installId: string, sent: Set<string> | null = null): Backup[] {
  return objects
    .flatMap((o) => {
      const info = readSnapshotKey(o.key);
      if (!info || o.size > MAX_VAULT_BYTES) return [];
      const mine = Boolean(installId) && info.owner === installId && (!sent || sent.has(o.key));
      return [{ key: o.key, device: mine ? "This phone" : "PC", platform: mine ? ("android" as const) : ("windows" as const), at: o.lastModified ?? info.time }];
    })
    .sort((a, b) => b.at - a.at);
}

export interface BackupDeps {
  store: Store;
  installId: () => string;
  config: () => CloudConfig | null; // this phone's R2 setup, null while locked or not set up
  pro: () => boolean; // KAPEVault Pro: without it every snapshot is backup-only (pro.ts)
  // The vault file as it is on disk, checked to open with the session key (SYNC.md 3.5: never upload a
  // file this device cannot read). Called synchronously first, so a lock right after cannot strand it.
  snapshot: () => () => Promise<string>;
  r2For: (config: CloudConfig) => R2Client;
  delayMs: number;
  retryMs: number;
  onListed: (objects: R2Object[]) => void; // every listing, for the devices in the Sync sheet
  onSettled: () => void; // a backup went up or failed: status() changed
}

export type Backups = ReturnType<typeof createBackups>;

export function createBackups({ store, installId, config, pro, snapshot, r2For, delayMs, retryMs, onListed, onSettled }: BackupDeps) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let last: { state: "idle" | "ok" | "error"; error?: string } = { state: "idle" };
  let owed: boolean | null = null; // null: not read from disk yet
  let lastSent = ""; // the note and hash of the file this run last uploaded
  let sent: Set<string> | null | undefined; // undefined: not read yet; null: none kept (an older install)
  let lastKey = ""; // the snapshot the last upload made

  async function sentKeys() {
    if (sent === undefined) {
      try {
        const keys = JSON.parse((await store.read(SENT)) ?? "null");
        sent = Array.isArray(keys) ? new Set(keys.filter((k): k is string => typeof k === "string")) : null;
      } catch {
        sent = null;
      }
    }
    return sent;
  }

  async function keepSent(keys: string[]) {
    sent = new Set(keys);
    try {
      await store.write(SENT, JSON.stringify(keys));
    } catch {
      // kept in memory for this run
    }
  }

  async function setOwed(on: boolean) {
    if (on === owed) return;
    try {
      if (on) await store.write(PENDING, "1");
      else await store.remove(PENDING);
      owed = on;
    } catch {
      // tried again on the next change
    }
  }

  // The note is part of "already up": once Pro is bought, the same file goes up again as a snapshot
  // the other devices merge.
  const sentAs = (note: string, bytes: string) => `${note}:${sha256Hex(bytes)}`;

  // The note is read once: a purchase landing during the PUT leaves lastSent naming what went up, so the
  // next upload still sends the file again under the new name.
  async function upload(target: CloudConfig, bytes: string) {
    const r2 = r2For(target);
    const me = installId();
    const note = snapshotNote(pro());
    const key = snapshotKey(new Date(), me, note);
    lastKey = key;
    const known = await sentKeys();
    if (known) await keepSent([...known, key]); // before the PUT: a listing meanwhile may show it
    await r2.put(key, bytes);
    lastSent = sentAs(note, bytes);
    // Thinning is housekeeping: a failed delete leaves an extra snapshot, never a missing one. Only
    // what this phone sent counts, so objects planted under its id never push real ones out.
    try {
      const objects = await listSnapshots(r2);
      const mine = objects.map((o) => o.key).filter((k) => readSnapshotKey(k)?.owner === me && (!sent || sent.has(k)));
      const gone = new Set(snapshotsToPrune(mine, Date.now()));
      for (const key of gone) await r2.del(key);
      await keepSent(mine.filter((k) => !gone.has(k)));
      onListed(objects.filter((o) => !gone.has(o.key)));
    } catch {
      // the next backup lists again
    }
  }

  // Uploads now. Config and the file read are taken before the first await. ifChanged: not when this
  // run already uploaded that exact file (Sync now: a sync with nothing new sends nothing).
  function backupNow({ ifChanged = false } = {}): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    const target = config();
    if (!target) return Promise.reject(new Error("Cloud backup is not set up."));
    const read = snapshot();
    const run = queue.then(async () => {
      const bytes = await read();
      if (!ifChanged || sentAs(snapshotNote(pro()), bytes) !== lastSent) await upload(target, bytes);
    });
    const done = run.then(
      () => {
        last = { state: "ok" };
        onSettled();
        if (queue === done && !timer) void setOwed(false);
      },
      async (e: unknown) => {
        last = { state: "error", error: (e instanceof Error && e.message) || "The backup did not finish." };
        onSettled();
        await setOwed(true);
      },
    );
    queue = done;
    return run;
  }

  // After a master password change, older snapshots still open with the OLD password (the PC's forgetOlder):
  // a fresh one goes up under the new password, then every snapshot of this phone's that is older than it
  // goes - its own, and ones from before install ids. Other devices' snapshots are left alone. A Bucket
  // Lock may refuse a delete: that one is skipped and counted, so one locked object never keeps the rest.
  async function forgetOlder() {
    const target = config();
    if (!target) throw new Error("Cloud backup is not set up.");
    await backupNow();
    const cutoff = readSnapshotKey(lastKey)?.time;
    if (cutoff === undefined) throw new Error("The fresh backup did not finish.");
    const r2 = r2For(target);
    const me = installId();
    const older = (await listSnapshots(r2)).map((o) => o.key).filter((k) => {
      const info = readSnapshotKey(k);
      return info !== null && info.time < cutoff && (info.owner === me || info.owner === null);
    });
    const gone = new Set<string>();
    for (const key of older) {
      try {
        await r2.del(key);
        gone.add(key);
      } catch {
        // refused by the bucket's lock
      }
    }
    const known = await sentKeys();
    if (known) await keepSent([...known].filter((k) => !gone.has(k)));
    return { deleted: gone.size, refused: older.length - gone.size };
  }

  // After every save: bursts of edits become one upload; a failed one retries while unlocked.
  // Auto backup off cancels a waiting one too.
  function schedule(delay = delayMs) {
    clearTimeout(timer);
    timer = undefined;
    if (!config()?.auto) {
      if (config()) void setOwed(false);
      return;
    }
    void setOwed(true);
    timer = setTimeout(() => backupNow().catch(() => schedule(retryMs)), delay);
  }

  return {
    schedule,
    backupNow,
    forgetOlder,
    // After every unlock: a backup owed from before (failed, or the app was killed first) goes up.
    async onUnlocked() {
      if (owed === null) owed = (await store.read(PENDING)) !== null;
      if (owed || last.state === "error") schedule();
    },
    // Before a lock wipes the keys: a waiting backup starts now and finishes on its own.
    flush() {
      if (timer) backupNow().catch(() => {});
      return queue;
    },
    // Locked: the retry timer must not outlive the session that owns the keys.
    stop() {
      clearTimeout(timer);
      timer = undefined;
    },
    status: () => last,
    sentKeys,
  };
}
