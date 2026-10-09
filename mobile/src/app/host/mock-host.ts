// The mock vault host: the real host's contract over core/, in memory. No storage, no R2, no
// fingerprint, no camera - each answers the way the real one would, after a believable wait.
// Dev switches in the URL: ?firstrun starts at first run, ?nofingerprint turns fingerprint unlock off,
// ?free starts without KAPEVault Pro, and store=unavailable|pending|cancel|owned is what Google Play does.
import { clearGenerated, clearHistory, findIssues, masterProblem, newVaultData, publicView, deleteForever, emptyTrash, restoreEntry, trashEntry, generatedValue, generatedView, recordGenerated, secretOf, setRecoveryCodes, today, toggleFavorite, touchEntry, upsertEntry, addSpace, findEntry } from "@core";
import { listeners } from "./listeners";
import { CONFLICT_ID, MOCK_MASTER, NOTE_ID, mockVault } from "./mock-data";
import { CLIENTS_ARE_PRO, canAddClient, canPlaceIn, createPro } from "./pro";
import { parseSetupCode } from "./setup-code";
import { MAX_VAULT_BYTES } from "./vault-file";
import { totpCode } from "./totp";
import type { BiometricStatus, CloudStatus, LockReason, PhoneSettings, ProStatus, SecretField, SyncStatus, VaultHost, VaultState, VaultView } from "./types";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MIN = 60_000;
const WRONG = "Wrong master password. Try again.";

// Not a real hash: findIssues only compares them. The real host passes SHA-256.
function mockHash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

export function createMockHost(): VaultHost {
  const params = new URLSearchParams(window.location.search);
  let state: VaultState = params.has("firstrun") ? "first-run" : "locked";
  let data: { spaces: any[]; entries: any[] } = mockVault();
  let master = MOCK_MASTER;
  const bio: BiometricStatus = { available: true, enabled: !params.has("nofingerprint") && state !== "first-run", needsMaster: false };
  let settings: PhoneSettings = { lockGrace: 30, lockAfterHours: 8, theme: "system", hideFromCapture: true };
  const MOCK_CLOUD: CloudStatus = { connected: true, url: "https://4f2a.r2.cloudflarestorage.com/kapevault", accessKeyId: "a1b2c3d4e5", auto: true, apart: false };
  // A first run starts with no R2: it is connected later in Settings.
  let cloud: CloudStatus = state === "first-run" ? { connected: false, url: "", accessKeyId: "", auto: false, apart: false } : MOCK_CLOUD;
  let sync: SyncStatus = {
    state: "idle",
    lastAt: Date.now() - 2 * MIN,
    peer: "DESKTOP-4F2A",
    devices: [
      { id: "phone", name: "This phone", model: "Pixel 8", platform: "android", thisDevice: true, lastSyncAt: Date.now() - 2 * MIN },
      { id: "pc", name: "DESKTOP-4F2A", model: "Windows PC", platform: "windows", thisDevice: false, lastSyncAt: Date.now() - 2 * MIN },
    ],
    conflicts: [],
    problems: [],
    fingerprint: "3fa94c1e",
    // ?review / ?newmaster: the sync line with a merge waiting, or another device's new master password.
    review: params.has("review") ? { from: ["DESKTOP-4F2A"], reasons: ["deletes"], added: [], changed: [], deleted: ["Old router", "Gym locker", "Water bill", "Spare key", "Wi-Fi guest", "Netflix"], copies: [], secretItems: 0 } : null,
    newMaster: params.has("newmaster") ? "DESKTOP-4F2A" : undefined,
  };
  // Without Pro the phone has only backed up: no peer; the other devices' rows stay, as on the real host.
  const synced = sync;
  const backupOnly = (): Partial<SyncStatus> => ({ backupOnly: true, lastAt: undefined, peer: undefined, fingerprint: undefined });
  if (params.has("free")) sync = { ...sync, ...backupOnly() };
  // Google Play as the mock plays it (play: its record of this account); pro.ts keeps the state, as on
  // the phone, with pro.json in memory. ?free&store=owned: bought before a reinstall (pro.json empty, Play
  // owns it), so opening the Pro sheet or Restore purchase brings Pro back.
  const playMode = params.get("store");
  let play = { owned: !params.has("free") || playMode === "owned", pending: false };
  let kept = params.has("free") ? null : JSON.stringify(play);
  const refuse = (code: string) => Promise.reject(Object.assign(new Error(code), { code }));
  const pro = createPro({
    store: { read: async () => kept, write: async (_name, text) => void (kept = text), remove: async () => {} },
    billing: {
      async status() {
        await wait(700);
        return playMode === "unavailable" ? refuse("unavailable") : { ...play, price: "US$9.99" };
      },
      async buy() {
        await wait(900);
        if (playMode === "unavailable" || playMode === "cancel") return refuse(playMode === "cancel" ? "canceled" : "unavailable");
        play = { owned: playMode !== "pending", pending: playMode === "pending" };
        return play;
      },
    },
    onChange(flipped) {
      proEvents.emit(pro.status());
      if (flipped) setSync(pro.owned ? { ...synced, backupOnly: false, lastAt: Date.now() } : backupOnly());
    },
  });
  void pro.load();
  let sessionTimer: ReturnType<typeof setTimeout> | undefined;

  const stateEvents = listeners<[VaultState, LockReason?]>();
  const changeEvents = listeners<[VaultView]>();
  const syncEvents = listeners<[SyncStatus]>();
  const proEvents = listeners<[ProStatus]>();

  const view = (): VaultView => publicView(data, findIssues(data.entries, today(), mockHash)) as VaultView;
  const conflicts = () => {
    const ids = new Set(data.entries.map((e) => e.id));
    const at = new Date(Date.now() - 24 * 60 * MIN).setHours(15, 12, 0, 0);
    return ids.has(CONFLICT_ID) ? [{ id: CONFLICT_ID, originalId: ids.has(NOTE_ID) ? NOTE_ID : undefined, device: "Pixel 8", at }] : [];
  };
  const setSync = (patch: Partial<SyncStatus>) => {
    sync = { ...sync, ...patch, conflicts: conflicts() };
    syncEvents.emit(sync);
  };
  function changed() {
    changeEvents.emit(view());
    setSync({});
  }
  function unlocked() {
    state = "unlocked";
    clearTimeout(sessionTimer);
    if (settings.lockAfterHours) sessionTimer = setTimeout(() => void host.lock("session-limit"), settings.lockAfterHours * 60 * MIN);
    stateEvents.emit(state);
  }
  function need() {
    if (state !== "unlocked") throw new Error("The vault is locked");
  }
  // A copy is cleared after 30 s (the real host marks it sensitive, and Android clears it natively).
  async function clip(text: string, sensitive: boolean) {
    await navigator.clipboard?.writeText(text).catch(() => {});
    if (sensitive) setTimeout(() => void navigator.clipboard?.writeText("").catch(() => {}), 30_000);
  }
  function used(id: string) {
    if (touchEntry(data, id)) changeEvents.emit(view());
  }

  const host: VaultHost = {
    state: async () => state,
    onState: stateEvents.add,

    async createVault(typed) {
      await wait(900);
      const problem = masterProblem(typed);
      if (problem) return { ok: false, error: problem };
      master = typed;
      data = newVaultData();
      setSync({ state: "off", devices: [] });
      unlocked();
      return { ok: true };
    },

    async scanQr(purpose) {
      await wait(900);
      if (purpose === "totp") return { ok: true, text: "otpauth://totp/Example:sam.reyes%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY&issuer=Example" };
      return { ok: true, text: JSON.stringify({ kapevault: "r2", v: 1, url: cloud.url, accessKeyId: cloud.accessKeyId, secretAccessKey: "mock-secret-access-key" }) };
    },
    parseSetupCode,
    async listBackups(keys) {
      await wait(700);
      if (!keys.url.startsWith("https://")) return { ok: false, error: "Could not reach that bucket. Check the S3 API URL." };
      const at = (daysAgo: number, h: number, m: number) => new Date(Date.now() - daysAgo * 24 * 60 * MIN).setHours(h, m, 0, 0);
      // ?backups=N: a bucket with N backups (the list must scroll, its button stay on screen).
      const times = params.has("backups") ? Array.from({ length: Number(params.get("backups")) || 30 }, (_, i) => at(i, 9, 12)) : [at(0, 9, 12), at(1, 18, 40), at(3, 20, 5)];
      const backups = times.map((t, i) => ({ key: `devices/pc/${i}.kv`, device: "DESKTOP-4F2A", platform: "windows" as const, at: t }));
      return { ok: true, backups };
    },
    async restore(_keys, _backupKey, typed, _replace, acceptOlder) {
      await wait(900);
      if (typed !== master) return { ok: false, error: WRONG };
      // ?olderkey: the backup predates a master password change on the PC.
      if (params.has("olderkey") && !acceptOlder) return { ok: false, olderKey: true, error: "This backup is from before the master password was changed on DESKTOP-4F2A. Your other devices will see this phone as behind and not sync with it until you type that newer master password here. Restore it anyway?" };
      data = mockVault();
      unlocked();
      return { ok: true };
    },

    async unlock(typed) {
      await wait(600);
      if (typed !== master) return { ok: false, error: WRONG };
      unlocked();
      return { ok: true };
    },
    biometricStatus: async () => ({ ...bio }),
    async unlockBiometric() {
      if (!bio.enabled) return { ok: false, code: "not-enabled", error: "Fingerprint unlock is off." };
      await wait(700);
      unlocked();
      return { ok: true };
    },
    async enableBiometric() {
      await wait(500);
      bio.enabled = true;
      return { ok: true };
    },
    async disableBiometric() {
      bio.enabled = false;
    },
    async lock(reason = "user") {
      if (state !== "unlocked") return;
      clearTimeout(sessionTimer);
      state = "locked";
      stateEvents.emit(state, reason);
    },
    async changeMaster(current, next) {
      need();
      await wait(600);
      if (current !== master) return { ok: false, error: "The current password is wrong." };
      const problem = masterProblem(next);
      if (problem) return { ok: false, error: problem };
      master = next;
      const biometricOff = bio.enabled;
      bio.enabled = false;
      return { ok: true, biometricOff };
    },

    async view() {
      need();
      return view();
    },
    onChanged: changeEvents.add,
    async getSecret(id, field: SecretField, index) {
      need();
      return secretOf(findEntry(data, id), field, index);
    },
    async saveEntry(input) {
      need();
      await wait(250);
      try {
        if (!canPlaceIn(pro.owned, data, input)) throw new Error(CLIENTS_ARE_PRO);
        const id = upsertEntry(data, input);
        changed();
        return { ok: true, id };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
      }
    },
    async deleteEntry(id) {
      need();
      trashEntry(data, id);
      changed();
    },
    async restoreEntry(id) {
      need();
      restoreEntry(data, id);
      changed();
    },
    async deleteForever(id) {
      need();
      deleteForever(data, id);
      changed();
    },
    async emptyTrash() {
      need();
      emptyTrash(data);
      changed();
    },
    async toggleFavorite(id) {
      need();
      toggleFavorite(data, id);
      changed();
    },
    async clearHistory(id) {
      need();
      clearHistory(data, id);
      changed();
    },
    // Generated passwords: the same core rules as the real host, in memory.
    async recordGenerated(value) {
      need();
      recordGenerated(data, value);
      changed();
      return generatedView(data);
    },
    async generatedList() {
      need();
      return generatedView(data);
    },
    async getGenerated(index) {
      need();
      return generatedValue(data, index);
    },
    async copyGenerated(index) {
      need();
      const value = generatedValue(data, index);
      if (!value) throw new Error("Nothing to copy");
      await clip(value, true);
    },
    async clearGenerated() {
      need();
      clearGenerated(data);
      changed();
      return generatedView(data);
    },
    async setRecoveryCodes(id, codes) {
      need();
      try {
        setRecoveryCodes(data, id, codes);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Could not save the codes." };
      }
      changed();
      return { ok: true };
    },
    async addSpace(name) {
      need();
      try {
        if (!canAddClient(pro.owned)) throw new Error(CLIENTS_ARE_PRO);
        const id = addSpace(data, name);
        changed();
        return { ok: true, id };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Could not add the client." };
      }
    },

    async copySecret(id, field, index) {
      need();
      if (field === "photo") throw new Error("A photo is not copied");
      await clip(secretOf(findEntry(data, id), field, index), true);
      used(id);
    },
    async copyText(text, id) {
      await clip(text, false);
      if (id) used(id);
    },
    async totp(id) {
      need();
      return totpCode(findEntry(data, id).totp);
    },
    async copyTotp(id) {
      need();
      await clip((await totpCode(findEntry(data, id).totp)).code, false);
      used(id);
    },
    async openEntry(id) {
      need();
      const e = findEntry(data, id);
      const link = e.kind === "link" ? e.location : e.kind === "device" ? e.adminUrl : e.url;
      if (link) window.open(/^https?:\/\//.test(link) ? link : `https://${link}`, "_blank", "noopener");
      used(id);
    },

    syncStatus: async () => ({ ...sync, conflicts: conflicts() }),
    onSync: syncEvents.add,
    async syncNow() {
      need();
      setSync({ state: "syncing" });
      await wait(1300);
      const now = Date.now();
      setSync({ state: "idle", lastAt: pro.owned ? now : undefined, devices: sync.devices.map((d) => ({ ...d, lastSyncAt: d.thisDevice ? now : d.lastSyncAt })) });
      return { ok: true };
    },
    async applySync() {
      need();
      await wait(700);
      const reasons = sync.review?.reasons ?? [];
      setSync({ review: null, lastAt: Date.now() });
      if (reasons.includes("key")) bio.enabled = false;
      return { ok: true, biometricOff: reasons.includes("key") };
    },
    async adoptSyncKey(typed) {
      need();
      await wait(900);
      if (typed !== MOCK_MASTER) return { ok: false, error: "That is not the master password set on DESKTOP-4F2A." };
      setSync({ newMaster: undefined, review: { from: ["DESKTOP-4F2A"], reasons: ["key"], added: [], changed: [], deleted: [], copies: [], secretItems: 0 } });
      return { ok: true };
    },
    cloudStatus: async () => ({ ...cloud }),
    async setCloudAuto(auto) {
      cloud = { ...cloud, auto };
      return { ...cloud };
    },
    // Any bucket holds the PC's vault here, so the page's question can be seen.
    async connectCloud(keys) {
      need();
      await wait(800);
      if (!keys.url.startsWith("https://")) return { ok: false, error: "Could not reach that bucket. Check the S3 API URL." };
      return { ok: true, other: { key: "devices/pc/0.kv", device: "PC", platform: "windows", at: Date.now() - 90 * MIN } };
    },
    async useCloudVault(_keys, _backupKey, typed) {
      need();
      await wait(900);
      if (typed !== MOCK_MASTER) return { ok: false, error: "Wrong master password for that backup." };
      const carried = data.entries.length;
      data = { ...mockVault(), entries: [...mockVault().entries, ...data.entries.map((e) => ({ ...e, id: crypto.randomUUID(), spaceId: mockVault().spaces[0].id }))] };
      master = MOCK_MASTER;
      cloud = MOCK_CLOUD;
      changed();
      setSync({ state: "idle", apart: false, lastAt: Date.now() });
      return { ok: true, carried };
    },
    async keepThisVault() {
      need();
      await wait(600);
      cloud = { ...MOCK_CLOUD, apart: true };
      setSync({ state: "idle", apart: true, lastAt: Date.now(), devices: sync.devices.filter((d) => d.thisDevice) });
      return { ok: true };
    },

    settings: async () => ({ ...settings }),
    async setSettings(patch) {
      settings = { ...settings, ...patch };
      return { ...settings };
    },

    proStatus: async () => pro.status(),
    onPro: proEvents.add,
    restorePro: () => pro.ask(),
    buyPro: () => pro.buy(),

    // Any file whose header says kapevault stands for a backup (under the real size cap); it opens with
    // the mock master password.
    checkBackupFile(text) {
      if (text.length > MAX_VAULT_BYTES) return { ok: false, error: "That file is too big to be a KAPEVault backup." };
      return /"format"\s*:\s*"kapevault"/.test(text) ? { ok: true } : { ok: false, error: "That file is not a KAPEVault backup. Pick the .kapevault file." };
    },
    async restoreFile(text, typed) {
      await wait(900);
      const check = host.checkBackupFile(text);
      if (!check.ok) return check;
      if (typed !== master) return { ok: false, error: "Wrong master password for that backup." };
      data = mockVault();
      unlocked();
      return { ok: true };
    },
  };
  return host;
}
