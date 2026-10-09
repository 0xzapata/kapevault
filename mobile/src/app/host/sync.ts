// The phone's sync over R2 (SYNC.md 3.5-3.9), the port of the PC's electron/sync.cjs. One run: list
// the bucket, download each other device's newest snapshot, open it with the session key, merge it in
// (core), and commit - or hold the merge for the user's review when it would change too much. The upload
// after it is the normal backup of the merged vault. The rules live in core/ (shared with the PC); this
// is the phone's host around them.
import { isConflictCopy, isNewerData, isNewerKey, isNewerVaultFile, isTrashed, logEntry, mergeRemotes, nameOf, newerProblem, pickSnapshots, readCopyTitle, snapshotStamp, readSnapshotKey, readSync, reviewReasons, reviewView, sharedState, syncChanges, withEntry } from "@core";
import { listSnapshots } from "./cloud";
import { syncAllowed } from "./pro";
import { sha256Hex } from "./sha256";
import { toBase64, type OpenVault, type VaultData } from "./vault-file";
import type { CloudConfig, R2Client, R2Object } from "./r2";
import type { ConflictCopy, Platform, Result, SyncDevice, SyncReview, SyncStatus } from "./types";

const SYNC_DELAY_MS = 3000; // after a save: a burst of edits syncs once

type Sync = ReturnType<typeof readSync>;
type Devices = Record<string, { name?: string; platform?: string; revokedAt?: unknown }>;
export type SyncData = VaultData & { sync: Sync };
type LogEntry = ReturnType<typeof logEntry>;
interface Remote {
  device: string;
  key: string;
  data: VaultData;
  salt: string;
  name?: string;
}
// What sync's commit writes: the merged vault, under another device's newer master password when rekey.
export interface SyncWrite {
  data: SyncData;
  rekey: OpenVault | null;
}
type Opened = null | { otherKey: true; behind: boolean } | { data: VaultData; salt: string };

// What the real host gives sync.
export interface SyncHost {
  installId(): string;
  device: { name: string; platform: Platform };
  model: string; // this phone, for its own row in the Sync sheet
  now(): number;
  base(): { generation: number; revision: number; data: SyncData } | null; // null while locked
  config(): CloudConfig | null;
  pro(): boolean; // KAPEVault Pro (pro.ts): without it this phone only backs up
  r2(config: CloudConfig): Pick<R2Client, "list" | "get">;
  // A snapshot opened with the SESSION key when its header salt is this vault's (no scrypt, no stored
  // password). otherKey: under another master password - behind when this vault had that one before.
  openSnapshot(text: string): Promise<Opened>;
  // A snapshot under a master password typed here, through the unlock throttle.
  openWithPassword(text: string, master: string): Promise<{ ok: true; opened: OpenVault } | { ok: false; error: string; damaged?: boolean; newer?: boolean }>;
  // On the change queue, so no save lands between the merge's read and its write: decide() sees the
  // vault as it is now and returns what to write (sync's own save: never stamped, never another sync),
  // or null for nothing. "stale": the vault locked or was opened again first, and decide() never ran.
  commit(generation: number, decide: (data: SyncData, revision: number) => SyncWrite | null): Promise<"written" | "kept" | "stale">;
  upload(): Promise<void>; // this vault as it is on disk, unless that exact file is already up
  backupError(): string; // the last backup's failure, "" when it went up: a phone that cannot sync shows this
  changed(): void; // the status changed
}

export type Syncer = ReturnType<typeof createSync>;

export function createSync(host: SyncHost, delayMs = SYNC_DELAY_MS) {
  let running: Promise<unknown> | null = null; // a run, or a typed master password, in flight
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A merge held for the user: { generation, revision, remotes, data, view, rekey }.
  let review: { generation: number; revision: number; remotes: Remote[]; data: SyncData; view: SyncReview; rekey: OpenVault | null } | null = null;
  let error = ""; // the last run's failure, in plain words
  let problems: string[] = []; // devices the last run could not merge, and why
  let newMaster: { device: string; key: string; name: string } | null = null; // a device under a master password this vault has not seen
  let objects: R2Object[] = []; // the last listing: the devices in the Sync sheet
  let merged = new Map<string, string>(); // device -> the snapshot key this session already has in it
  let unopened = new Set<string>(); // snapshotStamp()s that would not open: not downloaded again until the object changes
  let newer = new Set<string>(); // snapshotStamp()s a newer KAPEVault wrote: named on every run, downloaded once until the object changes
  let mergedIn = 0; // the session generation `merged` belongs to
  let print = { revision: -1, code: "" }; // the shared state's check code, worked out after each sync
  let merging: Remote[] = []; // what the commit in flight merges: counted as merged once it is written

  // Why sync cannot run at all. Automatic backup off is not one: Sync now still syncs.
  function offReason(): "locked" | "no-cloud" | "apart" | "removed" | "free" | null {
    const base = host.base();
    if (!base) return "locked";
    const config = host.config();
    if (!config) return "no-cloud";
    if (config.apart) return "apart"; // "Keep this phone's vault": the bucket holds another vault
    if (base.data.sync.devices[host.installId()]?.revokedAt) return "removed"; // another device removed this phone
    if (!syncAllowed(host.pro())) return "free"; // no Pro: Sync now only backs up
    return null;
  }

  // After unlock, saves and resume: only with automatic backup on, and not while another device's new
  // master password waits for Apply.
  const automatic = () => !offReason() && Boolean(host.config()?.auto) && !review?.rekey;

  function run(explicit: boolean): Promise<unknown> {
    clearTimeout(timer);
    timer = undefined;
    if (running || offReason() || (!explicit && !automatic())) return running ?? Promise.resolve();
    running = attempt(explicit).finally(() => {
      running = null;
      checkCode();
      host.changed();
    });
    host.changed();
    return running;
  }

  async function attempt(explicit: boolean) {
    const start = host.base();
    const config = host.config();
    if (!start || !config) return;
    const { generation } = start;
    const r2 = host.r2(config);
    try {
      objects = await listSnapshots(r2 as R2Client);
      const devices = start.data.sync.devices as Devices;
      const all = pickSnapshots(objects, { installId: host.installId(), devices, now: host.now(), failed: unopened });
      const stamps = new Map(objects.map((o) => [o.key, snapshotStamp(o)]));
      const picks = all.filter((p) => explicit || !p.dead);
      if (mergedIn !== generation) [merged, mergedIn] = [new Map(), generation];
      const remotes: Remote[] = [];
      const found: string[] = [];
      newMaster = null;
      for (const pick of picks) {
        if (merged.get(pick.device) === pick.keys[0]) continue; // nothing new from it since
        const name = nameOf(devices, pick.device);
        const got = await download(r2, pick.keys, name, Boolean(devices[pick.device]), stamps);
        if ("newKey" in got && got.newKey) newMaster ??= { device: pick.device, key: got.newKey, name };
        if ("problem" in got) found.push(got.problem);
        else if ("data" in got) remotes.push({ device: pick.device, key: got.key, data: got.data, salt: got.salt });
      }
      const upToDate = picks.filter((p) => merged.get(p.device) === p.keys[0]).map((p) => p.device);
      await settle(remotes, upToDate, found, generation);
      error = "";
    } catch (e) {
      if (!host.base()) return; // locked mid-run: nothing to say
      error = message(e);
      keepLog(host.base()?.data, { at: host.now(), error });
    }
  }

  // A device's newest snapshot that opens; an older one when the newest will not (every older snapshot
  // is a safe subset of a newer one - never read as an empty vault). newKey: under a master password this
  // vault has never had - the user types it once (adoptKey), and only a known device is asked for it: from
  // an unknown one it counts as unopenable. A newKey snapshot does not hide the device's older ones: anyone
  // holding the bucket keys can plant one (no vault key needed), so the next that opens is still merged, with
  // newKey beside it for the prompt. One that will not open is remembered (unopened), so the next run does
  // not download it again.
  async function download(r2: Pick<R2Client, "get">, keys: string[], name: string, known: boolean, stamps: Map<string, string>): Promise<{ key: string; data: VaultData; salt: string; newKey?: string } | { newKey: string } | { problem: string }> {
    let newKey: string | undefined;
    for (const key of keys) {
      // A device on a newer KAPEVault: its older snapshots are stale, so none of them is merged either.
      if (newer.has(stamps.get(key) ?? key)) return { problem: newerProblem(name) };
      const text = await r2.get(key);
      const opened = await host.openSnapshot(text);
      if ((!opened && isNewerVaultFile(text)) || (opened && "data" in opened && isNewerData(opened.data))) {
        newer.add(stamps.get(key) ?? key);
        return { problem: newerProblem(name) };
      }
      if (opened && "otherKey" in opened && known) {
        if (opened.behind) return newKey ? { newKey } : { problem: `${name} still uses the old master password. Unlock it there.` };
        newKey ??= key;
        continue;
      }
      if (opened && !("otherKey" in opened) && Array.isArray(opened.data.entries) && Array.isArray(opened.data.spaces)) return { key, data: opened.data, salt: opened.salt, newKey };
      unopened.add(stamps.get(key) ?? key);
    }
    return newKey ? { newKey } : { problem: `${name}'s newest backups cannot be opened.` };
  }

  // On the vault as it is when the change queue reaches it: a save made during the downloads is merged,
  // never overwritten. rekey: another device's newer master password, adopted with this merge - always
  // after a review. Sync turned off meanwhile (Pro refunded): nothing merged, nothing held.
  async function settle(remotes: Remote[], upToDate: string[], found: string[], generation: number, rekey: OpenVault | null = null) {
    const outcome = await host.commit(generation, (data, revision) => {
      merging = [];
      if (offReason()) {
        rekey?.raw.fill(0);
        return null;
      }
      const result = mergeAll(data, remotes);
      problems = [...found, ...result.problems];
      const changes = syncChanges(data, result.data);
      const reasons = reviewReasons(changes, data.entries.length, { epoch: result.epoch, key: Boolean(rekey) });
      const done = { remotes: result.merged, upToDate };
      dropReview();
      if (reasons.length) {
        review = { generation, revision, remotes: result.merged, data: result.data, rekey, view: reviewView(data, result, changes, reasons) };
        keepLog(data, logEntry(host.now(), done, { review: true }));
        return null;
      }
      return write(data, result.data, done, changes, rekey);
    });
    if (outcome === "stale") rekey?.raw.fill(0); // locked and opened again meanwhile: that unlock syncs
    else counted();
  }

  // SYNC.md 3.9: two devices that have synced show the same code; a difference means they diverged.
  // Worked out after a sync, not on every save: it hashes the whole vault, photos included.
  function checkCode() {
    const base = host.base();
    if (base && print.revision !== base.revision) print = { revision: base.revision, code: sha256Hex(sharedState(base.data)).slice(0, 8) };
  }

  // After a commit that wrote the merge, or had nothing to write: those snapshots are in this vault.
  function counted() {
    for (const remote of merging) merged.set(remote.device, remote.key);
    merging = [];
  }

  const mergeAll = (local: SyncData, remotes: Remote[]) => mergeRemotes(local, remotes, { installId: host.installId(), device: host.device, now: host.now(), sha256: sha256Hex });

  // What the commit writes. Nothing new: nothing written, nothing uploaded - the result only joins the
  // log in memory, and the devices count as merged.
  function write(data: SyncData, next: SyncData, done: { remotes: Remote[]; upToDate: string[] }, changes: ReturnType<typeof syncChanges>, rekey: OpenVault | null): SyncWrite | null {
    const entry = logEntry(host.now(), done, { added: changes.added.length, changed: changes.changed.length, deleted: changes.deleted.length, copies: changes.copies.length });
    merging = done.remotes;
    if (next === data && !rekey) {
      keepLog(data, entry);
      return null;
    }
    return { data: { ...next, syncLog: withEntry(data.syncLog, entry) }, rekey };
  }

  // A held review is replaced or dropped: a master password key it carried is wiped.
  function dropReview() {
    review?.rekey?.raw.fill(0);
    review = null;
  }

  // Sync results kept on this device (never merged). In memory until the next write carries them.
  function keepLog(data: SyncData | undefined, entry: LogEntry) {
    if (data) data.syncLog = withEntry(data.syncLog, entry);
  }

  // Apply on a held review. A save since then: the held snapshots are merged again into the vault as it
  // is now (the user said yes to them) - the save is kept, never overwritten.
  async function apply(): Promise<Result> {
    await running?.catch(() => {});
    const held = review;
    if (!held) return { ok: false, error: "Nothing waits for a review. Sync again." };
    review = null;
    try {
      const outcome = await host.commit(held.generation, (data, revision) => {
        merging = [];
        const next = revision === held.revision ? held.data : mergeAll(data, held.remotes).data;
        return write(data, next, { remotes: held.remotes, upToDate: [] }, syncChanges(data, next), held.rekey);
      });
      if (outcome === "stale") {
        held.rekey?.raw.fill(0);
        return { ok: false, error: "The vault was locked meanwhile. Sync again." };
      }
      counted();
      return { ok: true };
    } catch (e) {
      error = message(e);
      return { ok: false, error };
    } finally {
      checkCode();
      host.changed();
    }
  }

  // The master password another device set, typed here once (SYNC.md 3.6). It opens that device's
  // snapshot through the unlock throttle; the merge then waits for a review. When that device's change
  // is the later one, Apply writes this vault under its key too; otherwise (the change made here is the
  // later one) the merge keeps this vault's key and the other device adopts it instead.
  async function adoptKey(master: string): Promise<Result> {
    await running?.catch(() => {});
    const ask = newMaster;
    const config = host.config();
    const base = host.base();
    if (!ask || !config || !base || offReason() || running) return { ok: false, error: "Nothing to open. Sync again." };
    const adopting = (async (): Promise<Result> => {
      const opened = await host.openWithPassword(await host.r2(config).get(ask.key), master);
      if (!opened.ok) return { ok: false, error: opened.damaged || opened.newer ? opened.error : `That is not the master password set on ${ask.name}.` };
      const { data, salt } = opened.opened;
      let theirs: Sync;
      try {
        theirs = readSync(data, toBase64(salt));
      } catch (e) {
        opened.opened.raw.fill(0); // a newer app's vault: its key must not outlive the refusal
        throw e;
      }
      const rekey = isNewerKey(theirs, (host.base() ?? base).data.sync) ? opened.opened : (opened.opened.raw.fill(0), null);
      newMaster = null;
      await settle([{ device: ask.device, key: ask.key, data, salt: toBase64(salt) }], [], [], base.generation, rekey);
      return { ok: true };
    })();
    running = adopting;
    try {
      return await adopting;
    } catch (e) {
      return { ok: false, error: message(e) };
    } finally {
      running = null;
      checkCode();
      host.changed();
    }
  }

  // An explicit sync also reads devices silent for 180 days, then sends this vault up if the file on
  // disk is not up yet - with automatic backup off too (this is then the only way anything goes up).
  // Without Pro it only sends it up. A phone that cannot sync reports the backup's own outcome, which
  // automatic backups update too.
  async function syncNow(): Promise<Result> {
    const syncs = !offReason();
    await run(true);
    if (!host.base() || !host.config()) return { ok: false, error: "Cloud backup is not set up." };
    try {
      await host.upload();
    } catch (e) {
      if (syncs) error = message(e);
    }
    host.changed();
    const failure = syncs ? error : host.backupError();
    return failure ? { ok: false, error: failure } : { ok: true };
  }

  function status(): SyncStatus {
    const base = host.base();
    const config = host.config();
    if (!base || !config) return { state: "off", devices: [], conflicts: [], problems: [] };
    const { data, revision } = base;
    const devices = data.sync.devices as Devices;
    const last = ((data.syncLog ?? []) as LogEntry[]).find((e) => e.with?.length);
    const failure = offReason() ? host.backupError() : error;
    return {
      state: running ? "syncing" : failure ? "error" : "idle",
      apart: Boolean(config.apart),
      backupOnly: offReason() === "free",
      removed: offReason() === "removed",
      manual: !config.auto,
      lastAt: last?.at,
      peer: last ? deviceNames((last.with as string[]).map((id) => nameOf(devices, id))) : undefined,
      error: failure || undefined,
      problems,
      review: review?.view ?? null,
      newMaster: newMaster?.name,
      fingerprint: print.revision === revision ? print.code : undefined, // a save since the last sync: none until the next
      devices: devicesFrom(objects, { installId: host.installId(), model: host.model, known: devices }),
      conflicts: conflictsOf(data),
    };
  }

  return {
    status,
    apply,
    adoptKey,
    syncNow,
    afterUnlock: () => void run(false).catch(() => {}), // unlock never waits on sync
    resumed: () => void run(false).catch(() => {}),
    afterSave() {
      if (!automatic()) return;
      clearTimeout(timer);
      timer = setTimeout(() => void run(false).catch(() => {}), delayMs);
    },
    // A backup's listing: the devices in the Sync sheet stay current between runs.
    listed(next: R2Object[]) {
      objects = next;
      host.changed();
    },
    // Locked, or the R2 setup changed: nothing from the session before carries over. (A phone that only
    // backs up shows its last backup's outcome, which is the backups' own, until the next backup.)
    reset() {
      clearTimeout(timer);
      timer = undefined;
      dropReview();
      [error, problems, newMaster, objects, unopened, newer] = ["", [], null, [], new Set(), new Set()];
    },
  };
}

// "Mock PC", "Mock PC and Pixel 8", "A, B and C".
export function deviceNames(list: string[]): string {
  if (list.length < 2) return list[0] ?? "Another device";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// The PC names its platform as Node does (win32, darwin).
const PLATFORMS: Record<string, Platform> = { win32: "windows", windows: "windows", darwin: "mac", mac: "mac", android: "android", ios: "ios" };
const MODELS: Record<Platform, string> = { windows: "Windows PC", mac: "Mac", android: "Android phone", ios: "iPhone" };

// This phone first, then every other device: the ones in the vault's device list, by the name each gave
// itself, and any with snapshots in the bucket that has not registered yet. A removed device is left out,
// and so is another phone's backup-only snapshot (it syncs with nothing); this phone's own still dates its row.
function devicesFrom(objects: R2Object[], { installId, model, known }: { installId: string; model: string; known: Devices }): SyncDevice[] {
  const newest = new Map<string, number>();
  for (const o of objects) {
    const info = readSnapshotKey(o.key);
    if (!info?.owner || info.legacy || info.beforeRestore || (info.backupOnly && info.owner !== installId)) continue;
    newest.set(info.owner, Math.max(newest.get(info.owner) ?? 0, o.lastModified ?? info.time));
  }
  const ids = new Set([...Object.keys(known), ...newest.keys()]);
  const others = [...ids]
    .filter((id) => id !== installId && !known[id]?.revokedAt)
    .map((id): SyncDevice => {
      const platform = PLATFORMS[known[id]?.platform ?? ""] ?? "windows";
      return { id, name: nameOf(known, id), model: MODELS[platform], platform, thisDevice: false, lastSyncAt: newest.get(id) };
    });
  return [{ id: installId, name: "This phone", model, platform: "android", thisDevice: true, lastSyncAt: newest.get(installId) }, ...others];
}

// Conflict copies still waiting for a look: whose version each holds (the device named in its title),
// when that version was written (the losing change's clock, else the title's day), and the item it
// was copied from while one of that title is still there.
function conflictsOf(data: SyncData): ConflictCopy[] {
  return data.entries
    .filter((e) => isConflictCopy(e.title) && e.lifecycle?.state !== "gone" && !isTrashed(e))
    .map((e) => {
      const parts = readCopyTitle(e.title);
      const title = parts?.title ?? e.title;
      const stamps = Object.values((data.sync.meta[e.id]?.g ?? {}) as Record<string, { at: [number, number, string] }>).map((s) => s.at[0]);
      const original = data.entries.find((o) => o.id !== e.id && o.title === title && !isConflictCopy(o.title));
      return { id: e.id, originalId: original?.id, device: parts?.device ?? "another device", at: stamps.length ? Math.min(...stamps) : Date.parse(parts?.day ?? "") || 0 };
    });
}

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : "Sync did not finish.");
