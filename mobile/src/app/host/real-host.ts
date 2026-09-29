// The real vault host: VaultHost over core/ + WebCrypto, with the platform handed in (HostDeps), so the
// same code runs in the app (native.ts) and in Node tests. The PC's electron/vault-session.cjs, the
// unlock handler of electron/ipc/vault.cjs and lockVault in electron/main.cjs are the model; the page
// gets public views and one secret per call, and the key lives only while unlocked. This file wires the
// parts: session.ts (the open vault, its writes, lock), restore.ts, cloud-connect.ts, and
// sync.ts / cloud.ts.
import {
  addKey,
  addSpace,
  cleanText,
  clearHistory,
  confirmPayee,
  findEntry,
  keySaltMatches,
  masterProblem,
  newVaultData,
  removeEntries,
  secretOf,
  setRecoveryCodes,
  toggleFavorite,
  touchEntry,
  upsertEntry,
} from "@core";
import { createBiometric, type Keystore } from "./biometric";
import { createCloudConnect } from "./cloud-connect";
import { createBackups } from "./cloud";
import { listeners } from "./listeners";
import { cleanSettings, loadSettings, saveSettings } from "./phone-settings";
import { createR2Client, type CloudConfig, type Transport } from "./r2";
import { createRestore, type R2For } from "./restore";
import { VAULT, attempt, createSession, isVaultText, message, pause, type Open, type SessionData } from "./session";
import { parseSetupCode } from "./setup-code";
import { createStore, type RawFs } from "./storage";
import { createSync, type SyncHost } from "./sync";
import { createThrottle } from "./throttle";
import { totpCode } from "./totp";
import { MAX_VAULT_BYTES, createKey, decryptWithKey, openFile, openFileWithKey, parseVaultFile, toBase64 } from "./vault-file";
import type { LockReason, PhoneSettings, Result, SyncStatus, VaultHost, VaultState, VaultView } from "./types";

export interface Clipboard {
  copySecret(text: string): Promise<void>; // marked sensitive, cleared after 30 s (SecureClipboard)
  copyText(text: string): Promise<void>;
  clear(): Promise<void>; // on lock: a pending clear happens now
}

export interface HostDeps {
  fs: RawFs;
  transport: Transport;
  keystore: Keystore;
  clipboard: Clipboard;
  // The camera's QR text (QrScanner). Rejects with a code: canceled, denied, unavailable, failed.
  scanQr(purpose: "setup" | "totp"): Promise<string>;
  openUrl(url: string): void; // in the phone's browser
  model: string; // this phone, for the Sync sheet and the other devices' device lists: "Pixel 8"
  onResume?: (fn: () => void) => void; // the app came back to the screen: a sync, when one is due
  hideFromCapture?: (hidden: boolean) => Promise<void>; // FLAG_SECURE on or off (ScreenCapture plugin)
  now?: () => number;
  monotonic?: () => number; // for Lock after: a changed clock cannot stretch it
  backupDelayMs?: number;
  retryMs?: number;
  syncDelayMs?: number;
  maxVaultBytes?: number; // tests only: a smaller MAX_VAULT_BYTES, so every write path meets it without 64 MB of data
}

const WRONG = "Wrong master password. Try again.";
const DAMAGED = "The vault file is missing or damaged.";

// What "Open" opens (openTarget on the PC): a link's location, a device's admin page (bare address =
// http, as routers serve it), else the item's website (bare domain = https). Only http(s) ever opens.
function openTarget(entry: any): string {
  const raw = cleanText(entry.kind === "link" ? entry.location : entry.kind === "device" ? entry.adminUrl : entry.kind === "note" ? "" : entry.url);
  if (!raw) throw new Error("This item has no link");
  // A PC path, as path.win32.isAbsolute reads one: C:\ or C:/, \\share, or rooted \folder or /folder.
  if (entry.kind === "link" && /^([a-z]:[\\/]|[\\/])/i.test(raw)) throw new Error("That link is a folder or file on your PC");
  const url = new URL(/^[a-z][a-z0-9+.-]+:/i.test(raw) ? raw : `${entry.kind === "device" ? "http" : "https"}://${raw}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only web links open from KAPEVault");
  return url.href;
}

export function createRealHost(deps: HostDeps): VaultHost {
  const now = deps.now ?? Date.now;
  const store = createStore(deps.fs);
  const throttled = createThrottle(store, now);
  const bio = createBiometric({ keystore: deps.keystore, store, now });
  const r2For: R2For = (c) => createR2Client({ ...c, transport: deps.transport });

  let installId = "";
  let settings: PhoneSettings;
  // The window starts out hidden from capture (MainActivity); a phone that turned it off shows once read.
  const applyCapture = () => deps.hideFromCapture?.(settings.hideFromCapture);
  const ready = loadSettings(store, now).then(async (loaded) => {
    ({ installId, settings } = loaded);
    await applyCapture()?.catch(() => {});
  });

  const stateEvents = listeners<[VaultState, LockReason?]>();
  const changeEvents = listeners<[VaultView]>();
  const syncEvents = listeners<[SyncStatus]>();
  const emitSync = () => syncEvents.emit(syncer.status());
  let rekeyedOff = false; // the last adopted master password turned fingerprint unlock off

  const session = createSession({
    store,
    bio,
    now,
    monotonic: deps.monotonic ?? (() => performance.now()),
    maxVaultBytes: deps.maxVaultBytes ?? MAX_VAULT_BYTES,
    installId: () => installId,
    lockAfterHours: () => settings.lockAfterHours,
    clearClipboard: () => deps.clipboard.clear(),
    backups: () => backups,
    syncer: () => syncer,
    onState: stateEvents.emit,
    onChanged: changeEvents.emit,
    onSync: emitSync,
  });
  const { need, change } = session;

  const backups = createBackups({
    store,
    installId: () => installId,
    config: () => session.open?.data.cloud ?? null,
    snapshot() {
      const key = session.open?.key;
      return async () => {
        const text = await store.read(VAULT);
        const file = parseVaultFile(text);
        if (!key || !file || !(await decryptWithKey(key, file))) throw new Error("The vault file on this phone could not be read, so it was not backed up.");
        return text as string;
      };
    },
    r2For,
    delayMs: deps.backupDelayMs ?? 10_000,
    retryMs: deps.retryMs ?? 60_000,
    onListed: (objects) => syncer.listed(objects),
  });

  const restore = createRestore({ session, store, throttled, bio, backups, r2For, installId: () => installId, now, ready });

  // A snapshot opened with the session key: no scrypt, no password (SYNC.md 3.5). otherKey: written under
  // another master password - behind when this vault had that one before. null: not a KAPEVault file,
  // damaged, or made with another key on this salt.
  async function openSnapshot(text: string) {
    const s = session.open;
    const file = parseVaultFile(text);
    if (!s || !file) return null;
    if (file.kdf.salt !== toBase64(s.salt)) return { otherKey: true as const, behind: s.data.sync.keys.some((k: { salt: string }) => k.salt === file.kdf.salt) };
    const data = await decryptWithKey(s.key, file);
    return data ? { data, salt: file.kdf.salt } : null;
  }

  // Sync's commit, on the change queue, so no save lands between the merge's read and its write. A
  // merge that adopts another device's master password (rekey) is written under that key before the
  // session switches to it, as a master password change is (session.adoptKey).
  const syncCommit: SyncHost["commit"] = (gen, decide) =>
    session.queue(async () => {
      const s = session.open;
      if (!s || gen !== session.generation || session.expired()) return "stale" as const;
      const out = decide(s.data, session.revision);
      if (!out) return "kept" as const;
      if (!out.rekey) {
        s.data = out.data as SessionData;
        await session.persist(true, true);
      } else {
        const adopted = await session.adoptKey(out.rekey, out.data as SessionData, "Could not save the synced vault.");
        if (!adopted.ok) throw new Error(adopted.error);
        rekeyedOff = adopted.biometricOff;
      }
      if (session.open) changeEvents.emit(session.view(session.open.data));
      return "written" as const;
    });

  // Sync (SYNC.md, sync.ts): the loop is sync.ts's; the session, its key and its writes stay here.
  const syncer = createSync(
    {
      installId: () => installId,
      device: { name: deps.model, platform: "android" },
      model: deps.model,
      now,
      base: () => (session.open ? { generation: session.generation, revision: session.revision, data: session.open.data } : null),
      config: () => (session.open?.data.cloud as CloudConfig | undefined) ?? null,
      r2: r2For,
      openSnapshot,
      openWithPassword(text, master) {
        const file = parseVaultFile(text);
        return file ? restore.openThrottled(file, master, WRONG) : Promise.resolve({ ok: false as const, damaged: true, error: "That backup cannot be opened." });
      },
      commit: syncCommit,
      upload: () => backups.backupNow({ ifChanged: true }),
      changed: emitSync,
    },
    deps.syncDelayMs,
  );
  deps.onResume?.(() => session.open && syncer.resumed());

  const cloud = createCloudConnect({ session, restore, syncer, bio, r2For, installId: () => installId, now, onSync: emitSync });
  const used = (id: string) => change((data) => touchEntry(data, id), { backup: false, only: (touched) => touched }).catch(() => {});

  const host: VaultHost = {
    async state() {
      await ready;
      if (session.open) return "unlocked";
      return (await store.read(VAULT, isVaultText)) === null ? "first-run" : "locked";
    },
    onState: stateEvents.add,

    // A new vault on the phone, as the PC's first run makes one: core's shapes (the Personal space's id
    // names the vault), a fresh key, written through the store, then unlocked.
    async createVault(master) {
      await ready;
      if ((await store.read(VAULT, isVaultText)) !== null) return { ok: false, error: "A vault already exists." };
      const problem = masterProblem(master);
      if (problem) return { ok: false, error: problem };
      await pause();
      session.start({ ...(await createKey(master, pause)), data: newVaultData() });
      try {
        await session.persist(false);
      } catch (e) {
        session.wipe(); // not on disk, so not a vault
        return { ok: false, error: message(e, "Could not save the vault on this phone.") };
      }
      session.lastMasterAt = now();
      session.unlocked();
      return { ok: true };
    },

    // Closed says nothing. Every other failure points at what the page offers instead of the camera.
    async scanQr(purpose) {
      try {
        return { ok: true, text: await deps.scanQr(purpose) };
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === "canceled") return { ok: false, canceled: true, error: "" };
        const instead = purpose === "setup" ? "Type the keys instead" : "Paste the key instead";
        if (code === "denied") return { ok: false, error: `KAPEVault may not use the camera. ${instead}, or allow the camera for KAPEVault in Android Settings > Apps.` };
        if (code === "unavailable") return { ok: false, error: `This phone has no camera KAPEVault can use. ${instead}.` };
        return { ok: false, error: `The camera did not start. ${instead}.` };
      }
    },
    parseSetupCode,

    ...restore.calls,

    async unlock(master) {
      await ready;
      const result = await throttled(async () => {
        const file = await session.readVault();
        if (!file) return { ok: false as const, error: DAMAGED };
        await pause();
        const opened = await openFile(master, file, pause);
        if (!opened) return { ok: false as const, error: WRONG };
        const unmarked = !keySaltMatches(opened.data, file.kdf.salt);
        session.start(opened);
        // A vault from before keySalt gets it on disk now, so the next fingerprint unlock works.
        if (unmarked) await session.persist(false).catch(() => {});
        return { ok: true as const };
      });
      if (!result.ok) return result;
      session.lastMasterAt = now();
      const key = Uint8Array.from((session.open as Open).raw);
      session.unlocked();
      void bio.touchMaster(key).finally(() => key.fill(0));
      return { ok: true };
    },

    biometricStatus: async () => bio.status(),

    async unlockBiometric() {
      await ready;
      const file = await session.readVault();
      const unwrapped = await bio.unlock((key) => (file ? openFileWithKey(key, file) : Promise.resolve(null)));
      if (!unwrapped.ok) return unwrapped;
      // The key opens the data, but the header's salt may have been edited (the tag does not cover it):
      // saving would write a header the master password no longer opens (core/key-salt.js).
      if (!file || !keySaltMatches(unwrapped.opened.data, file.kdf.salt)) {
        unwrapped.opened.raw.fill(0);
        return { ok: false, code: "master-required", error: "Enter your master password to unlock this time." };
      }
      session.start(unwrapped.opened);
      session.lastMasterAt = unwrapped.masterAt;
      session.unlocked();
      return { ok: true };
    },

    async enableBiometric() {
      need();
      return bio.enable((session.open as Open).raw, session.lastMasterAt ?? 0);
    },

    async disableBiometric() {
      await bio.disable();
    },

    async lock(reason = "user") {
      session.lockNow(reason);
    },

    async changeMaster(current, next) {
      need();
      const problem = masterProblem(next);
      if (problem) return { ok: false, error: problem }; // refused before the current one is tried: not a guess
      const checked = await restore.proveMaster(session.readVault, current, "The current password is wrong.");
      if (!checked.ok) return checked;
      const fresh = await createKey(next, pause);
      // Through the change queue, so no save lands between the check and the re-key.
      return session.queue(async (): Promise<Result<{ biometricOff: boolean }>> => {
        let data: SessionData;
        try {
          data = need();
        } catch {
          fresh.raw.fill(0);
          return { ok: false, error: "The vault locked. Unlock it, then try again." };
        }
        const adopted = await session.adoptKey(fresh, { ...data, sync: addKey(data.sync, { salt: toBase64(fresh.salt), installId, now: now() }) }, "Could not save the new password.");
        if (adopted.ok && session.open) changeEvents.emit(session.view(session.open.data));
        return adopted;
      });
    },

    async view() {
      return session.view(need());
    },
    onChanged: changeEvents.add,

    async getSecret(id, field, index) {
      return secretOf(findEntry(need(), id), field, index);
    },
    saveEntry: (input) => attempt(async () => ({ id: await change((data) => upsertEntry(data, input) as string) }), "Could not save."),
    async deleteEntry(id) {
      await change((data) => removeEntries(data, new Set([id])));
    },
    async toggleFavorite(id) {
      await change((data) => toggleFavorite(data, id));
    },
    async confirmPayee(id, number) {
      await change((data) => confirmPayee(data, id, number));
    },
    async clearHistory(id) {
      await change((data) => clearHistory(data, id));
    },
    setRecoveryCodes: (id, codes) => attempt(async () => (await change((data) => setRecoveryCodes(data, id, codes)), {}), "Could not save the codes."),
    addSpace: (name) => attempt(async () => ({ id: await change((data) => addSpace(data, name) as string) }), "Could not add the client."),

    async copySecret(id, field, index) {
      if (field === "photo") throw new Error("A photo is not copied");
      await deps.clipboard.copySecret(secretOf(findEntry(need(), id), field, index));
      void used(id);
    },
    async copyText(text, id) {
      await deps.clipboard.copyText(text);
      if (id && session.open) void used(id);
    },
    async totp(id) {
      const entry = findEntry(need(), id);
      if (entry.kind !== "login" || !entry.totp) throw new Error("No 2FA code for this item");
      return totpCode(entry.totp);
    },
    async copyTotp(id) {
      await deps.clipboard.copySecret((await host.totp(id)).code);
      void used(id);
    },
    async openEntry(id) {
      deps.openUrl(openTarget(findEntry(need(), id)));
      void used(id);
    },

    syncStatus: async () => syncer.status(),
    onSync: syncEvents.add,
    async syncNow() {
      if (!need().cloud) return { ok: false, error: "Cloud backup is not set up." };
      return syncer.syncNow();
    },
    async applySync() {
      need();
      rekeyedOff = false;
      const result = await syncer.apply();
      return result.ok ? { ok: true, biometricOff: rekeyedOff } : result;
    },
    async adoptSyncKey(master) {
      need();
      return syncer.adoptKey(master);
    },

    ...cloud,

    async settings() {
      await ready;
      return { ...settings };
    },
    async setSettings(patch) {
      await ready;
      settings = cleanSettings(patch, settings);
      await saveSettings(store, installId, settings);
      await applyCapture();
      return { ...settings };
    },
  };
  return host;
}
