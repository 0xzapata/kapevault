// Settings > Cloud backup on an unlocked phone: connect a bucket, and when it already holds another
// vault, take that one (this phone's items come over as new items) or keep this one apart.
import { readSync } from "@core";
import type { createBiometric } from "./biometric";
import { carryOver } from "./carry-over";
import { backupsOf, listSnapshots } from "./cloud";
import type { CloudConfig } from "./r2";
import { R2_URL, cloudFrom, keysToCloud, sharedOnly, type R2For, type Restore } from "./restore";
import { attempt, message, type Open, type Session } from "./session";
import type { Syncer } from "./sync";
import { decryptWithKey, parseVaultFile, toBase64, type VaultData } from "./vault-file";
import type { CloudStatus, VaultHost } from "./types";

interface CloudConnectDeps {
  session: Session;
  restore: Restore;
  syncer: Syncer;
  bio: ReturnType<typeof createBiometric>;
  r2For: R2For;
  installId: () => string;
  now: () => number;
  onSync: () => void; // the sync status may have changed
}

type CloudCalls = Pick<VaultHost, "cloudStatus" | "setCloudAuto" | "connectCloud" | "useCloudVault" | "keepThisVault">;

export function createCloudConnect({ session, restore, syncer, bio, r2For, installId, now, onSync }: CloudConnectDeps): CloudCalls {
  function cloudStatus(): CloudStatus {
    const c = session.open?.data.cloud as CloudConfig | undefined;
    return c ? { connected: true, url: `${c.endpoint}/${c.bucket}`, accessKeyId: c.accessKeyId, auto: c.auto, apart: Boolean(c.apart) } : { connected: false, url: "", accessKeyId: "", auto: false, apart: false };
  }

  // Whether a backup in the bucket is this vault: opened with the session key when it has this vault's
  // salt, else known by a salt from this vault's key history (a password changed elsewhere). Without
  // either, it is another vault - its id is inside the encryption, and only its own password opens it.
  async function isThisVault(cloud: CloudConfig, backupKey: string): Promise<boolean> {
    const s = session.open as Open;
    const file = parseVaultFile(await r2For(cloud).get(backupKey));
    if (!file) return false;
    if (file.kdf.salt === toBase64(s.salt) && file.kdf.N === s.kdf.N) {
      const data = await decryptWithKey(s.key, file);
      return Boolean(data) && readSync(data as VaultData, file.kdf.salt).vaultId === s.data.sync.vaultId;
    }
    return s.data.sync.keys.some((k: { salt: string }) => k.salt === file.kdf.salt);
  }

  // The R2 setup saved in the vault (device-local, never synced), backed up from now on.
  async function saveCloud(cloud: CloudConfig) {
    await session.change((data) => {
      data.cloud = cloud;
    });
    syncer.reset();
    onSync();
  }

  return {
    cloudStatus: async () => cloudStatus(),
    async setCloudAuto(auto) {
      await session.change((data) => {
        if (!data.cloud) throw new Error("Cloud backup is not set up.");
        data.cloud = { ...data.cloud, auto: Boolean(auto) };
      });
      return cloudStatus();
    },

    // The newest backup another device made decides: none, or this very vault, connects; another vault
    // is named for the page to ask about, and nothing is saved yet.
    async connectCloud(keys) {
      session.need();
      const typed = keysToCloud(keys);
      if (!typed.ok) return typed;
      const { cloud } = typed;
      return attempt(async () => {
        const other = backupsOf(await listSnapshots(r2For(cloud)), installId()).find((b) => b.device !== "This phone");
        if (other && !(await isThisVault(cloud, other.key))) return { other };
        await saveCloud(cloud);
        void syncer.syncNow(); // the first backup now, not in 10 s
        return {};
      }, "Could not reach that bucket.");
    },

    async useCloudVault(keys, backupKey, master) {
      session.need();
      const cloud = cloudFrom(keys);
      if (!cloud) return { ok: false, error: R2_URL };
      const tried = await restore.openBackup(cloud, backupKey, master);
      if (!tried.ok) return tried;
      const { opened } = tried;
      const mine = session.open;
      if (!mine) {
        opened.raw.fill(0);
        return { ok: false, error: "The vault locked. Unlock it, then try again." };
      }
      // It turned out to be this vault after all (its password was changed elsewhere): just connect.
      if (readSync(opened.data, toBase64(opened.salt)).vaultId === mine.data.sync.vaultId) {
        opened.raw.fill(0);
        return attempt(async () => (await saveCloud(cloud), void syncer.syncNow(), { carried: 0 }), "Could not connect.");
      }
      const items = { spaces: mine.data.spaces, entries: mine.data.entries };
      try {
        // This phone's vault as it was is kept in the slot, if the slot is free (a taken slot stays as it
        // is: this vault's items come over anyway).
        const { keepReplaced } = await restore.readSlot();
        const data = sharedOnly(opened, cloud);
        await session.writeVault(opened, data, keepReplaced);
        opened.data = data;
      } catch (e) {
        opened.raw.fill(0);
        return { ok: false, error: message(e, "Could not save the vault on this phone.") };
      }
      await bio.disable(); // the fingerprint wrap held the replaced vault's key
      session.start(opened);
      session.lastMasterAt = now();
      // Saved as this phone's change: the carried items are stamped with its id, so they sync out.
      const carried = await session.change((data) => carryOver(data, items));
      session.unlocked();
      return { ok: true, carried };
    },

    async keepThisVault(keys) {
      session.need();
      const cloud = cloudFrom(keys);
      if (!cloud) return { ok: false, error: R2_URL };
      return attempt(async () => (await saveCloud({ ...cloud, apart: true }), void syncer.syncNow(), {}), "Could not connect.");
    },
  };
}
