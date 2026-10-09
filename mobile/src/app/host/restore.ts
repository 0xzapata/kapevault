// Restores: a backup from R2 or a picked file, opened with its own master password, then written over
// the vault here, keeping the vault it replaces in the one slot (the PC's restore.cjs rules). Plus the
// password proofs the host shares: a master password typed for another file, or for this vault's own.
import { NewerVaultError, SHARED_FIELDS, carryLockOut, checkReader, isNewerVaultFile, readSync, withKeySalt } from "@core";
import type { createBiometric } from "./biometric";
import { backupsOf, listSnapshots, readSnapshotKey, type Backups } from "./cloud";
import { parseR2Url, type CloudConfig, type R2Client, type R2Object } from "./r2";
import { VAULT, attempt, message, pause, type Session } from "./session";
import type { Store } from "./storage";
import type { createThrottle } from "./throttle";
import { MAX_VAULT_BYTES, openFile, parseVaultFile, toBase64, type OpenVault, type VaultData, type VaultFile } from "./vault-file";
import type { R2Keys, RestoreResult, Result, VaultHost } from "./types";

export type R2For = (c: Pick<CloudConfig, "endpoint" | "bucket" | "accessKeyId" | "secretAccessKey">) => R2Client;

const REPLACED = "replaced.kapevault"; // the vault a restore replaced: one slot, as on the PC
export const R2_URL = "Paste the bucket's S3 API URL, like https://<account-id>.r2.cloudflarestorage.com/<bucket>.";
const WRONG_BACKUP = "Wrong master password for that backup.";
const NOT_A_BACKUP = "That file is not a KAPEVault backup. Pick the .kapevault file.";
const FILE_TOO_BIG = "That file is too big to be a KAPEVault backup.";
// A backup a newer KAPEVault saved is neither a wrong password nor damaged: the throttle does not count it.
// The question before a restore from before a newer master password (SYNC.md 3.6). Unlocked, a restore
// whose key a lock-out retired keeps this phone's current key (carryLockOut), so "behind" is then only
// possible, not certain: whether the current key is as new as the other device's is not known here.
export function olderKeyQuestion(newer: string, keepsKey: boolean): string {
  const head = `This backup is from before the master password was changed on ${newer}.`;
  if (keepsKey) return `${head} The restore keeps this phone's current master password. If that one is older than the one on ${newer}, your other devices will see this phone as behind until you type the newer master password here. Restore it anyway?`;
  return `${head} Your other devices will see this phone as behind and not sync with it until you type that newer master password here. Restore it anyway?`;
}

export const newerResult = () => ({ ok: false as const, newer: true as const, error: new NewerVaultError().message });
const SLOT_TAKEN = "This phone already keeps a vault from an earlier restore, and it stays as it is. Replace the vault here without keeping a copy?";

// A picked backup file, before any key derivation: no bigger than any vault is saved, and a vault file.
function readBackupFile(text: string): { ok: true; file: VaultFile } | { ok: false; error: string } {
  if (text.length > MAX_VAULT_BYTES) return { ok: false, error: FILE_TOO_BIG }; // base64 in JSON: one byte a char
  const file = parseVaultFile(text);
  if (file) return { ok: true, file };
  return isNewerVaultFile(text) ? newerResult() : { ok: false, error: NOT_A_BACKUP };
}

// A backup's vault as this phone keeps it (a restore, or the bucket's vault): only what syncs comes over -
// every other top-level field (cloud, olderBackupsPending) was the backing-up device's own (SYNC.md 3.8) -
// with `cloud` as this phone's R2 setup. keySalt: the backup's password opened it, so its salt is proven
// (core/key-salt.js); without it the next fingerprint unlock asked for the master password once.
export function sharedOnly(opened: OpenVault, cloud: CloudConfig | undefined): VaultData {
  const shared = Object.fromEntries(SHARED_FIELDS.filter((f: string) => f in opened.data).map((f: string) => [f, opened.data[f]]));
  return withKeySalt({ spaces: [], entries: [], ...shared, cloud }, toBase64(opened.salt)) as VaultData;
}

export const cloudFrom = (keys: R2Keys): CloudConfig | null => {
  const target = parseR2Url(keys.url);
  return target && { ...target, accessKeyId: keys.accessKeyId.trim(), secretAccessKey: keys.secretAccessKey.trim(), auto: true };
};

// Typed or scanned keys as this phone's R2 setup, or what is wrong with them.
export function keysToCloud(keys: R2Keys): { ok: true; cloud: CloudConfig } | { ok: false; error: string } {
  const cloud = cloudFrom(keys);
  if (!cloud) return { ok: false, error: R2_URL };
  if (!cloud.accessKeyId || !cloud.secretAccessKey) return { ok: false, error: "Enter the access key ID and secret access key." };
  return { ok: true, cloud };
}

interface RestoreDeps {
  session: Session;
  store: Store;
  throttled: ReturnType<typeof createThrottle>;
  bio: ReturnType<typeof createBiometric>;
  backups: Backups;
  r2For: R2For;
  installId: () => string;
  now: () => number;
  ready: Promise<void>;
}

export type Restore = ReturnType<typeof createRestore>;

export function createRestore({ session, store, throttled, bio, backups, r2For, installId, now, ready }: RestoreDeps) {
  // A master password typed for a file other than this vault (a backup, a snapshot), through the throttle
  // as such: a miss counts, a success never clears the count.
  const openThrottled = (file: VaultFile, master: string, wrong: string) =>
    throttled(
      async () => {
        await pause();
        const opened = await openFile(master, file, pause);
        if (!opened) return { ok: false as const, error: wrong };
        // Its data can be a newer app's under a header this app reads: a restore would write it, then refuse to start it.
        try {
          checkReader(opened.data);
        } catch (e) {
          opened.raw.fill(0);
          if (e instanceof NewerVaultError) return newerResult();
          throw e;
        }
        return { ok: true as const, opened };
      },
      { local: false },
    );

  // A master password proven on this vault's file, read when its turn comes; the key is wiped at once.
  const proveMaster = (read: () => Promise<VaultFile | null>, master: string, wrong: string) =>
    throttled(async () => {
      const file = await read();
      const opened = file && (await openFile(master, file, pause));
      opened?.raw.fill(0);
      return opened ? { ok: true as const } : { ok: false as const, error: wrong };
    });

  // The vault on disk now, the one slot beside it, and keepReplaced: the vault goes to the slot when
  // the slot is free (a taken slot stays as it is) - passed to writeVault, so a write refused for its
  // size (or failing to encrypt) keeps no copy.
  async function readSlot() {
    const current = await store.read(VAULT);
    const kept = current === null ? null : await store.read(REPLACED);
    const keepReplaced = async () => {
      if (current !== null && kept === null) await store.write(REPLACED, current);
    };
    return { current, kept, keepReplaced };
  }

  // A backup downloaded and opened with its own master password.
  async function openBackup(cloud: CloudConfig, backupKey: string, master: string): Promise<Result<{ opened: OpenVault }>> {
    if (!readSnapshotKey(backupKey)) return { ok: false, error: "Unknown backup." };
    let text;
    try {
      text = await r2For(cloud).get(backupKey);
    } catch (e) {
      return { ok: false, error: message(e, "Could not download that backup.") };
    }
    const file = parseVaultFile(text);
    if (!file) return isNewerVaultFile(text) ? newerResult() : { ok: false, error: "That backup is not a KAPEVault file." };
    return openThrottled(file, master, WRONG_BACKUP);
  }

  // What a restore keeps of the open vault it replaces (SYNC.md 3.7, core carryLockOut, the PC's
  // restoreCarry): its device removals, and its key when the backup is under a master password a lock-out
  // retired - the restore is then written under the open vault's key (a copy of its raw bytes, wiped on
  // failure; a lock meanwhile wipes the session's own). Locked, there is nothing readable to keep.
  function restoreCarry(opened: OpenVault): { sync: ReturnType<typeof readSync>; key: OpenVault | null } | null {
    const open = session.open;
    if (!open) return null;
    const salt = toBase64(opened.salt);
    const { sync, keepKey } = carryLockOut(open.data.sync, toBase64(open.salt), readSync(opened.data, salt), salt);
    return { sync, key: keepKey ? { raw: open.raw.slice(), key: open.key, kdf: open.kdf, salt: open.salt.slice(), data: opened.data } : null };
  }

  // The restore's last half, for a backup from R2 or a picked file: keep the vault it replaces (one slot;
  // holding another vault, ask first - needsConfirm - and `replace` goes ahead without a copy, the PC's
  // restore.cjs rule), write the backup with `cloud` as this phone's R2 setup, then unlock it - with the
  // removals (and after a lock-out the key) of the vault it replaces (restoreCarry, read before any await).
  async function replaceWith(backup: OpenVault, cloud: CloudConfig | undefined, replace?: { current?: string }): Promise<RestoreResult> {
    const carry = restoreCarry(backup);
    if (carry?.key) backup.raw.fill(0);
    const opened = carry?.key ?? backup;
    try {
      const { current, kept, keepReplaced } = await readSlot();
      if (kept !== null && kept !== current) {
        // Locked, a confirm alone would let anyone holding the phone replace the vault with a backup
        // of their own, so it also needs the current vault's master password, proven by opening the
        // file through the throttle (key wiped at once). Unlocked, the open session is that proof.
        const needsMaster = !session.open;
        const ask = (error: string) => {
          opened.raw.fill(0);
          return { ok: false as const, needsConfirm: true as const, ...(needsMaster && { needsMaster: true as const }), error };
        };
        if (!replace || (needsMaster && !replace.current)) return ask(SLOT_TAKEN);
        if (needsMaster) {
          const proof = await proveMaster(async () => parseVaultFile(current), String(replace.current), "Wrong master password for the vault on this phone.");
          if (!proof.ok) return ask(proof.error);
        }
      }
      const data = sharedOnly(opened, cloud);
      if (carry) data.sync = carry.sync;
      await session.writeVault(opened, data, keepReplaced);
      opened.data = data;
    } catch (e) {
      opened.raw.fill(0);
      return { ok: false, error: message(e, "Could not save the vault on this phone.") };
    }
    await bio.disable(); // any fingerprint wrap held the replaced vault's key
    session.start(opened);
    session.lastMasterAt = now();
    session.unlocked();
    backups.schedule(); // this phone's first snapshot, so the other devices can see it
    return { ok: true };
  }

  // The device whose master password is newer than a backup's (SYNC.md 3.6), or null: the newest
  // snapshot of a device the backup knows (the one that made it, or one in its device list) is under a
  // salt the backup's key history does not hold - a master password set after it was made. Headers only:
  // a salt is plain text. Devices the backup never met are not asked, so another vault sharing the
  // bucket never raises it. A snapshot that cannot be read raises nothing.
  async function newerKeyThan(cloud: CloudConfig, backupKey: string, opened: OpenVault): Promise<string | null> {
    const salt = toBase64(opened.salt);
    const theirs = readSync(opened.data, salt);
    const known = new Set([salt, ...theirs.keys.map((k: { salt: string }) => k.salt)]);
    const maker = readSnapshotKey(backupKey)?.owner;
    const r2 = r2For(cloud);
    const newest = new Map<string, R2Object>();
    for (const o of await listSnapshots(r2)) {
      const owner = readSnapshotKey(o.key)?.owner;
      if (!owner || (owner !== maker && !theirs.devices[owner]) || readSnapshotKey(o.key)?.beforeRestore) continue;
      const had = newest.get(owner);
      if (!had || (o.lastModified ?? 0) > (had.lastModified ?? 0)) newest.set(owner, o);
    }
    for (const [owner, o] of newest) {
      if (o.key === backupKey) continue;
      const file = parseVaultFile(await r2.get(o.key).catch(() => null));
      if (file && !known.has(file.kdf.salt)) return theirs.devices[owner]?.name ?? "the device that made this backup";
    }
    return null;
  }

  // The host's restore calls.
  const calls: Pick<VaultHost, "listBackups" | "restore" | "checkBackupFile" | "restoreFile"> = {
    async listBackups(keys) {
      await ready;
      const typed = keysToCloud(keys);
      if (!typed.ok) return typed;
      return attempt(async () => ({ backups: backupsOf(await listSnapshots(r2For(typed.cloud)), installId(), await backups.sentKeys()) }), "Could not list the backups.");
    },

    // Download, open with the backup's own master password, then replaceWith() - with the keys typed or
    // scanned as this phone's R2 setup. A wrong password or a bad file changes nothing here.
    async restore(keys, backupKey, master, replace, acceptOlder) {
      await ready;
      const cloud = cloudFrom(keys);
      if (!cloud) return { ok: false, error: R2_URL };
      const tried = await openBackup(cloud, backupKey, master);
      if (!tried.ok) return tried;
      const { opened } = tried;
      const newer = acceptOlder ? null : await newerKeyThan(cloud, backupKey, opened).catch(() => null);
      if (newer) {
        const open = session.open;
        const keepsKey = Boolean(open && carryLockOut(open.data.sync, toBase64(open.salt), readSync(opened.data, toBase64(opened.salt)), toBase64(opened.salt)).keepKey);
        opened.raw.fill(0);
        return { ok: false, olderKey: true, error: olderKeyQuestion(newer, keepsKey) };
      }
      return replaceWith(opened, cloud, replace);
    },

    checkBackupFile(text) {
      const read = readBackupFile(text);
      return read.ok ? { ok: true } : read;
    },

    // A vault file picked on the phone (Drive, Files, USB): checked before any key derivation (the KDF
    // settings come from the file), opened with its own master password, then replaceWith(). A phone with
    // its own R2 setup keeps it; otherwise (no R2 on the phone, or locked - a lock while the picker was
    // open too) the backup's own comes with it - it opened with that vault's password - so the phone backs
    // up and syncs again with no keys typed.
    async restoreFile(text, master, replace) {
      await ready;
      const read = readBackupFile(text);
      if (!read.ok) return read;
      const tried = await openThrottled(read.file, master, WRONG_BACKUP);
      if (!tried.ok) return tried;
      const theirs = tried.opened.data.cloud;
      const carried = theirs && cloudFrom({ url: `${theirs.endpoint}/${theirs.bucket}`, accessKeyId: String(theirs.accessKeyId ?? ""), secretAccessKey: String(theirs.secretAccessKey ?? "") });
      return replaceWith(tried.opened, (session.open?.data.cloud as CloudConfig | undefined) ?? carried ?? undefined, replace);
    },
  };

  return { calls, openThrottled, proveMaster, readSlot, openBackup };
}
