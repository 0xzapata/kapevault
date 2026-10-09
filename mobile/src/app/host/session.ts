// The open vault's session: its key and data, the one change queue, every write of the vault file, and
// lock / unlock. real-host.ts wires it; restore.ts and cloud-connect.ts act on it. The PC's
// electron/vault-session.cjs is the model: the key lives only while unlocked.
import { NewerVaultError, findIssues, hasExpiredTrash, isNewerVaultFile, openedVault, publicView, purgeGenerated, purgeTrash, stamp, today, withKeySalt } from "@core";
import type { createBiometric } from "./biometric";
import type { Backups } from "./cloud";
import { sha256Hex } from "./sha256";
import type { Store } from "./storage";
import type { SyncData, Syncer } from "./sync";
import { encryptWithKey, parseVaultFile, toBase64, type OpenVault, type VaultData } from "./vault-file";
import type { LockReason, Result, VaultState, VaultView } from "./types";

// An open session's data always carries its sync object (start() reads or makes it).
export type SessionData = SyncData;
export type Open = OpenVault & { data: SessionData };
export type Session = ReturnType<typeof createSession>;

export const VAULT = "vault.kapevault";
const LOCKED = "The vault is locked";
const TOO_BIG = "The vault would be too big to back up (over 64 MB), so this was not saved. Remove some photos or long notes first.";
const SESSION_CHECK_MS = 15_000;
const HOUR_MS = 3600_000;

// A finished vault file: one this app reads, or one a newer KAPEVault wrote (never taken for a half-made file).
export const isVaultText = (text: string) => parseVaultFile(text) !== null || isNewerVaultFile(text);
// scrypt runs on the page's thread: a pause now and then lets "Unlocking..." paint.
export const pause = () => new Promise((r) => setTimeout(r, 0));
export const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
export async function attempt<T extends object>(apply: () => Promise<T> | T, fallback: string): Promise<Result<T>> {
  try {
    return { ok: true, ...(await apply()) };
  } catch (e) {
    return { ok: false, error: message(e, fallback) };
  }
}

interface SessionDeps {
  store: Store;
  bio: ReturnType<typeof createBiometric>;
  now: () => number;
  monotonic: () => number;
  maxVaultBytes: number;
  installId: () => string;
  lockAfterHours: () => number;
  clearClipboard: () => Promise<void>;
  // Made after the session, since they read it: looked up when needed.
  backups: () => Backups;
  syncer: () => Syncer;
  onState: (state: VaultState, reason?: LockReason) => void;
  onChanged: (view: VaultView) => void;
  onSync: () => void; // the sync status may have changed
}

export function createSession(d: SessionDeps) {
  let open: Open | null = null;
  let saved: SessionData | null = null; // the data as last read or written: a failed save goes back to it
  let generation = 0; // bumped by every start() and lock, so work begun on one session never lands in another
  let revision = 0; // bumped by every start() and save: a merge read at one revision is written only at it
  let lastMasterAt: number | null = null;
  // The last master-password unlock found the master easy to guess: only this boolean, never the password or
  // its score. wipe() resets it, so a fingerprint unlock, a restore and a master change start it false.
  let masterWeak = false;
  let unlockedAt: { mono: number; wall: number } | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let changes: Promise<unknown> = Promise.resolve(); // one change at a time, each saved before the next

  const stampContext = () => ({ installId: d.installId(), now: d.now(), sha256: sha256Hex });
  const view = (data: VaultData): VaultView => ({ ...(publicView(data, findIssues(data.entries, today(), sha256Hex), d.now()) as VaultView), masterWeak });

  // Every session starts from a file just read or written; any previous key is wiped first. Every caller
  // proved the key belongs to the header's salt (a master password derived it, or unlockBiometric
  // checked keySalt first): openedVault (core) marks it, opens due dates as notes and reads and repairs
  // the sync object. A vault a newer KAPEVault saved throws NewerVaultError, and its key goes with it.
  function start(opened: OpenVault) {
    wipe();
    let data: SessionData;
    try {
      data = openedVault(opened.data, toBase64(opened.salt), stampContext()) as SessionData;
    } catch (e) {
      opened.raw.fill(0);
      throw e;
    }
    open = { ...opened, data };
    saved = { ...data };
    revision++;
  }

  function wipe() {
    open?.raw.fill(0);
    open = null;
    saved = null;
    masterWeak = false;
    generation++;
  }

  function expired() {
    const limit = d.lockAfterHours() * HOUR_MS;
    // Both clocks: the monotonic one cannot be set back, the wall one keeps counting while asleep.
    return limit > 0 && unlockedAt !== null && (d.monotonic() - unlockedAt.mono >= limit || d.now() - unlockedAt.wall >= limit);
  }

  function need(): SessionData {
    if (open && expired()) lockNow("session-limit");
    if (!open) throw new Error(LOCKED);
    return open.data;
  }

  // Nothing between start() and this may throw: the page would show an error over an open vault.
  function unlocked() {
    unlockedAt = { mono: d.monotonic(), wall: d.now() };
    clearInterval(timer);
    timer = setInterval(() => open && expired() && lockNow("session-limit"), SESSION_CHECK_MS);
    d.syncer().reset();
    d.onState("unlocked");
    void d.backups().onUnlocked();
    d.syncer().afterUnlock();
    sweepTrash();
  }

  // On unlock, what has been 30 days in the Trash goes now rather than at the next edit. A refused write
  // only means it goes with the next save (persist purges too).
  function sweepTrash() {
    if (!open || !hasExpiredTrash(open.data, d.now())) return;
    void change(() => {}).catch(() => {});
  }

  // Synchronous, so nothing can run between the decision and the wipe.
  function lockNow(reason: LockReason) {
    if (!open) return;
    d.backups().flush(); // a waiting backup still needs the R2 keys the lock is about to wipe
    d.backups().stop();
    d.syncer().reset();
    wipe();
    unlockedAt = null;
    clearInterval(timer);
    void d.clearClipboard().catch(() => {});
    d.onState("locked", reason);
  }

  // The vault file, or null when it is missing or not a vault. Throws NewerVaultError for one a newer KAPEVault saved.
  async function readVault() {
    const text = await d.store.read(VAULT, isVaultText);
    if (isNewerVaultFile(text)) throw new NewerVaultError();
    return parseVaultFile(text);
  }

  // The one way a vault reaches the disk: encrypted, and never over MAX_VAULT_BYTES - refused, nothing
  // is written, `before` (a restore keeping the vault it replaces) included.
  async function writeVault(v: Pick<OpenVault, "key" | "kdf" | "salt">, data: VaultData, before?: () => Promise<void>) {
    const text = JSON.stringify(await encryptWithKey(v.key, v.kdf, v.salt, data));
    if (text.length > d.maxVaultBytes) throw new Error(TOO_BIG); // base64 in JSON: one byte a char
    await before?.();
    await d.store.write(VAULT, text);
  }

  // Write to a new file, then swap it in, stamping what changed since the last save - here and nowhere
  // else, so no change reaches the disk unstamped. A failed save puts the data back as last saved.
  // bySync: sync's own save writes the merged vault as it is - merge never stamps, and restamping it as
  // this phone's edit would win conflicts it never took part in; it never starts another sync either.
  async function persist(backup = true, bySync = false) {
    const s = open as Open;
    try {
      // Items 30 days in the Trash go with any save of ours, so stamp() sees the delete and sync carries it.
      // Not on sync's own save: a merge never edits what it writes.
      if (!bySync) purgeTrash(s.data, d.now());
      if (!bySync) purgeGenerated(s.data, d.now()); // as the PC's persist(): nothing past 90 days is written
      if (!bySync) s.data.sync = stamp(saved as SessionData, s.data, stampContext());
      await writeVault(s, s.data);
    } catch (e) {
      if (open === s) s.data = { ...(saved as SessionData) };
      throw e;
    }
    if (open !== s) return;
    saved = { ...s.data };
    revision++;
    if (backup) d.backups().schedule();
    if (backup && !bySync) d.syncer().afterSave();
  }

  // The change queue: one at a time, so no save lands between another's read and its write.
  function queue<T>(run: () => Promise<T>): Promise<T> {
    const next = changes.then(run);
    changes = next.catch(() => {});
    return next;
  }

  // One change core makes to the open vault, saved, then the page's new view. Changes replace top-level
  // fields and never edit them in place (core's rule), so the shallow `saved` is the whole rollback.
  function change<T>(apply: (data: SessionData) => T, { backup = true, only }: { backup?: boolean; only?: (result: T) => boolean } = {}): Promise<T> {
    return queue(async () => {
      const data = need();
      let result: T;
      try {
        result = apply(data);
      } catch (e) {
        (open as Open).data = { ...(saved as SessionData) };
        throw e;
      }
      if (only && !only(result)) return result;
      await persist(backup);
      if (open) d.onChanged(view(open.data));
      d.onSync(); // conflict copies come and go with the items
      return result;
    });
  }

  // A vault re-keyed under a new master password (changed here, or another device's adopted by sync):
  // written under the new key before the session switches to it. Older R2 snapshots still open with the
  // old one (flagged in the written copy only), and fingerprint unlock turns off - its wrap holds the old
  // key. biometricOff: it was on. fallback: the error when the failed write says nothing itself.
  async function adoptKey(fresh: Omit<OpenVault, "data">, data: SessionData, fallback: string): Promise<Result<{ biometricOff: boolean }>> {
    const rekeyed = withKeySalt(data.cloud ? { ...data, olderBackupsPending: true } : data, toBase64(fresh.salt)) as SessionData;
    try {
      await writeVault(fresh, rekeyed);
    } catch (e) {
      fresh.raw.fill(0);
      return { ok: false, error: message(e, fallback) };
    }
    start({ ...fresh, data: rekeyed });
    lastMasterAt = d.now(); // typed on this phone
    const biometricOff = (await d.bio.status()).enabled;
    if (biometricOff) await d.bio.disable();
    d.backups().schedule();
    return { ok: true, biometricOff };
  }

  return {
    get open() {
      return open;
    },
    get generation() {
      return generation;
    },
    get revision() {
      return revision;
    },
    get lastMasterAt() {
      return lastMasterAt;
    },
    set lastMasterAt(at: number | null) {
      lastMasterAt = at;
    },
    set masterWeak(weak: boolean) {
      masterWeak = weak;
    },
    view,
    start,
    wipe,
    expired,
    need,
    unlocked,
    lockNow,
    readVault,
    writeVault,
    persist,
    queue,
    change,
    adoptKey,
  };
}
