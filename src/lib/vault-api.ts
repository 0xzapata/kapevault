import type { DeviceType, EntryInput, VaultView } from "@/features/vault/types";

export interface FolderItem {
  name: string;
  kind: "dir" | "file";
  size: number;
  modified: number;
  path: string;
}

export interface FolderListing {
  dir: string;
  total: number;
  items: FolderItem[];
}

export { previewUrl } from "./preview-url.ts";

type Result = { ok: true; vault: VaultView } | { ok: false; error: string };
type BiometricResult = Result | { ok: false; error: string; code: BiometricErrorCode };
export type BiometricErrorCode = "unsupported" | "not-enabled" | "canceled" | "master-required" | "locked-out" | "changed" | "failed";

// Cloudflare R2 backup. The secret goes in once and never comes back to the page.
export interface CloudInput {
  url: string; // the bucket's S3 API URL
  accessKeyId: string;
  secretAccessKey: string; // blank = keep the saved one
}

export interface CloudStatus {
  settings: { url: string; accessKeyId: string; auto: boolean; olderBackups: boolean } | null;
  last: { state: "idle" | "ok" | "error"; at?: number; error?: string };
  openerReplaced: boolean; // the Opener in the bucket had been changed and was put back
}

export interface Snapshot {
  key: string;
  size: number;
  at: number;
  otherDevice: boolean; // made by another PC sharing this bucket
}

// Sync with the other devices on the same bucket (electron/sync.cjs). Main pushes every change.
export interface SyncStatus {
  state: "off" | "idle" | "running" | "review";
  // no-cloud: backup not set up; no-id: settings unreadable this run; restored: paused after a restore
  // until the user answers (syncAnswerRestore); removed: another device removed this one from sync
  off: null | "locked" | "no-cloud" | "no-id" | "restored" | "removed";
  manual: boolean; // automatic backup is off: nothing syncs by itself, Sync now still does
  error: string; // the last run failed, in plain words
  problems: string[]; // devices the last run could not merge, and why
  newMaster: string | null; // a device that set a master password this vault has not seen: its name
  thisDevice: string;
  lastSync: { at: number; with: string[] } | null; // device names
  // ref: how the page names a device to syncRevoke; lastSeen: its newest backup, by R2's clock
  devices: { ref: string; name: string; platform: string; lastSeen: number | null }[];
  needsLook: { id: string; title: string }[]; // conflict copies
  review: SyncReview | null; // a merge held until Apply
  fingerprint: string; // 8 hex of the shared state: the same on every device that has synced
}

export interface SyncReview {
  from: string[];
  reasons: ("deletes" | "secrets" | "epoch" | "key")[];
  added: string[]; // titles
  changed: string[];
  deleted: string[];
  copies: string[];
  secretItems: number;
}

// Add a phone: the R2 keys as a QR code - dark modules as one SVG path in module units, `size` modules
// a side - shown for `seconds`.
export interface PhoneCode {
  size: number;
  path: string;
  seconds: number;
}

export interface BiometricStatus {
  name: string; // "Windows Hello" | "Touch ID"
  supported: boolean;
  enabled: boolean;
  needsMaster: boolean;
  stale: boolean; // unlocked only: it was set up for this vault's old key (a restore or a password change), so turn it on again
}

// Air Wall: the Windows Firewall rule that blocks KAPEVault itself from the internet.
export type AirWallStatus =
  | { available: false; reason: "platform" | "unpacked" }
  | { available: true; state: "on" | "off" | "unenforced" } // unenforced: the rule is there, Windows Firewall is off
  | { available: true; state: "other"; program: string }; // the rule blocks another copy of the app
export type AirWallTest = "blocked" | "open" | "offline";

export type ThemeChoice = "system" | "classic" | "dark" | "colorblind" | "contrast";

export type SessionLimitHours = 0 | 1 | 2 | 4 | 8 | 12 | 24; // 0 = off
export type LockReason = "session-limit";

export interface AppSettings {
  quickSearch: boolean;
  startWithWindows: boolean;
  trayHintShown: boolean;
  theme: ThemeChoice;
  hotkey: string;
  hotkeyOk: boolean;
  canStartWithOs: boolean;
  sessionLimitHours: SessionLimitHours; // locks this long after an unlock, even in use
  sessionLimitOptions: number[];
  hideFromCapture: boolean; // off: screenshots, recordings and screen sharing see the windows
  oldCopy: { path: string; modifiedAt: number } | null; // BOVault's vault, still in its old folder
  oldInstall: string | null; // BOVault.exe still installed (it holds the quick search hotkey); its path
}

export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
  path: string;
  replacedCopy: { at: number; size: number } | null; // the vault the last restore replaced, kept beside this one: when and how big, never where
}

// What a finished restore did with the vault it replaced. keptCopy: kept on this device (Settings can
// bring it back); keptCloud: this device's cloud backup setup stayed, and the replaced vault went to it.
export interface RestoreKept {
  keptCopy?: boolean;
  keptCloud?: boolean;
}

// A restore that did not happen. needsConfirm / needsMaster: see restoreFromFile.
export interface RestoreRefused {
  ok: false;
  error: string;
  needsConfirm?: true;
  needsMaster?: true;
}

export interface TotpCode {
  code: string;
  period: number;
  expiresAt: number;
}

// code / answer: a backup code / security answer at index; photo: a device's label photo or an ID's
// photo (never copied)
export type SecretField = "password" | "body" | "secret" | "history" | "code" | "answer" | "adminPassword" | "wifiPassword" | "photo" | "idNumber";

// What "Scan a label" read off a sticker: suggestions for the form, never saved until the user saves.
export interface LabelFound {
  type?: DeviceType;
  title?: string;
  model?: string;
  serial?: string;
  imei?: string;
  mac?: string;
  adminUrl?: string;
  adminUser?: string;
  adminPassword?: string;
  ssid?: string;
  wifiPassword?: string;
  notes?: string;
}

type Attempt<T> = ({ ok: true } & T) | { ok: false; error: string };
type Canceled = { canceled?: true; name?: string };
// What happened to the Forever Opener beside a saved copy: "foreign" = a file of that name that is not
// one, "newer" = an opener that says it is from a newer version (left alone, not checked).
export type OpenerWrite = "written" | "current" | "newer" | "foreign" | "failed";

interface KAPEVaultBridge {
  platform: string;
  status(): Promise<VaultStatus>;
  view(): Promise<VaultView | null>;
  create(master: string): Promise<Result>;
  unlock(master: string): Promise<Result>;
  unlockBiometric(): Promise<BiometricResult>;
  lock(): Promise<void>;
  saveEntry(input: EntryInput): Promise<{ vault: VaultView; id: string }>;
  deleteEntry(id: string): Promise<VaultView>;
  toggleFavorite(id: string): Promise<VaultView>;
  confirmPayee(id: string, number: string): Promise<VaultView>; // today, by main's clock; number = the one called
  recoveryCodes(id: string): Promise<{ code: string; used: boolean }[]>; // the whole grid, on reveal only
  setRecoveryCodes(id: string, codes: string[]): Promise<VaultView>; // new or replacement set
  markRecoveryCode(id: string, index: number, used: boolean): Promise<VaultView>;
  addPaperCopy(id: string, where: string, printedAt: string): Promise<VaultView>; // "" = today
  removePaperCopy(id: string, index: number): Promise<VaultView>;
  setLifecycle(id: string, state: "dormant" | "deletion-requested" | null): Promise<VaultView>; // null = back in use
  confirmGone(id: string, clearNotes: boolean): Promise<VaultView>; // wipes every secret, keeps a tombstone
  moveEntry(id: string, spaceId: string): Promise<VaultView>;
  addSpace(name: string): Promise<{ vault: VaultView; id: string }>;
  renameSpace(id: string, name: string): Promise<VaultView>;
  deleteSpace(id: string, moveToId: string | null): Promise<VaultView>;
  clearHistory(id: string): Promise<VaultView>;
  getPassword(id: string): Promise<string>;
  copyPassword(id: string): Promise<void>;
  getSecret(id: string, field: SecretField, index?: number): Promise<string>;
  copySecret(id: string, field: SecretField, index?: number): Promise<void>;
  totp(id: string): Promise<TotpCode>;
  copyTotp(id: string): Promise<string>;
  parseTotp(input: string): Promise<Attempt<{ uri: string; issuer: string; account: string }>>;
  scanQr(): Promise<Attempt<{ uri: string; issuer: string; account: string }>>;
  ratePassword(password: string): Promise<{ score: number; label: string }>;
  copyText(text: string, id?: string): Promise<void>;
  openEntry(id: string): Promise<void>; // opens the item's own website or link, looked up in main
  changeMaster(current: string, next: string): Promise<{ ok: boolean; error?: string; biometricOff?: boolean }>;
  revealFile(): Promise<void>;
  importFile(): Promise<{ ok: true; added: number; skipped: number; vault: VaultView; deleted: boolean; name: string } | { ok: false; canceled?: boolean; error?: string }>;
  biometricStatus(): Promise<BiometricStatus>;
  biometricEnable(): Promise<Attempt<{ status: BiometricStatus }>>;
  biometricDisable(): Promise<BiometricStatus>;
  airWallStatus(): Promise<Attempt<{ status: AirWallStatus }>>;
  airWallSet(on: boolean): Promise<Attempt<{ status: AirWallStatus }>>; // one UAC prompt
  airWallTest(): Promise<Attempt<{ result: AirWallTest }>>; // one outbound connection, on click only
  saveCopy(): Promise<Attempt<Canceled & { opener?: OpenerWrite }>>;
  saveOpener(): Promise<Attempt<Canceled>>;
  openerHash(): Promise<string>; // SHA-256 of this version's Opener page, hex
  emergencyKit(includeKeys: boolean): Promise<Attempt<Canceled>>;
  handBack(person: string, withSecrets: boolean): Promise<Attempt<Canceled>>; // PDF of what is held for them
  evacuationPdf(): Promise<Attempt<Canceled>>; // the Evacuate grab list as a PDF
  readLabel(image: string): Promise<Attempt<{ reader: "ok" | "unavailable"; found: LabelFound }>>; // offline OCR of a label photo
  pickRestoreFile(): Promise<{ ok: true; name: string } | { ok: false; canceled?: boolean; error?: string }>;
  // needsConfirm: the backup opened, but the vault here could not be kept (a local copy failed, or a
  // replaced vault already holds the slot, which stays as it is) - ask before replacing it with no
  // copy kept. confirmed = that second click. needsMaster: the vault here is locked, so that click also
  // needs its own master password (current). The same for cloudRestore.
  restoreFromFile(master: string, confirmed?: boolean, current?: string): Promise<({ ok: true; vault: VaultView } & RestoreKept) | RestoreRefused>;
  pickReplacedCopy(): Promise<{ ok: true; name: string } | { ok: false; error: string }>; // then restoreFromFile with its own password
  deleteReplacedCopy(master: string): Promise<Attempt<{ status: VaultStatus }>>; // unlocked, and the replaced vault's own master password
  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  removeOldCopy(master: string): Promise<Attempt<{ settings: AppSettings }>>; // unlocked, and the old vault's own master password
  quickHide(): Promise<void>;
  quickShowInMain(id: string): Promise<void>;
  listFolder(root: string, rel: string): Promise<FolderListing>;
  openFile(path: string): Promise<"opened" | "revealed">;
  revealPath(path: string): Promise<void>;
  readText(path: string): Promise<{ text: string; truncated: boolean }>;
  cloudStatus(): Promise<CloudStatus>;
  cloudConnect(input: CloudInput): Promise<Attempt<{ status: CloudStatus }>>;
  cloudSetAuto(auto: boolean): Promise<CloudStatus>;
  cloudDisconnect(): Promise<CloudStatus>;
  cloudBackupNow(): Promise<Attempt<{ status: CloudStatus }>>;
  cloudForgetOlder(): Promise<Attempt<{ deleted: number; status: CloudStatus }>>;
  // input = keys typed on the lock screen; without it the vault's saved keys are used
  cloudList(input?: CloudInput): Promise<Attempt<{ snapshots: Snapshot[] }>>;
  cloudRestore(key: string, input: CloudInput | undefined, master: string, confirmed?: boolean, current?: string): Promise<({ ok: true; vault: VaultView } & RestoreKept) | RestoreRefused>;
  syncStatus(): Promise<SyncStatus>;
  syncNow(): Promise<SyncStatus>; // also sends a waiting backup up
  syncApply(): Promise<SyncStatus>; // commits the merge held for review
  syncAdoptKey(master: string): Promise<{ ok: boolean; error?: string; status: SyncStatus }>; // the master password set on status.newMaster; a review follows
  syncAnswerRestore(everywhere: boolean): Promise<SyncStatus>; // after a restore: true = this vault on all devices, false = merge it in
  syncRevoke(ref: string): Promise<SyncStatus>; // remove another device from sync
  cloudPhoneCode(): Promise<Attempt<PhoneCode>>; // unlocked and connected only
  onSyncStatus(callback: (status: SyncStatus) => void): () => void;
  onLocked(callback: (reason?: LockReason) => void): () => void;
  onUnlocked(callback: (vault: VaultView) => void): () => void;
  onChanged(callback: (vault: VaultView) => void): () => void;
  onReveal(callback: (id: string) => void): () => void;
  onQuickShown(callback: () => void): () => void;
  onQuickHidden(callback: () => void): () => void; // the quick window just hid
  onWindowState(callback: (state: { maximized: boolean; fullScreen: boolean }) => void): () => void;
  onTheme(callback: (theme: Exclude<ThemeChoice, "system">) => void): () => void;
  folderStatus(): Promise<FolderCopyStatus>;
  chooseFolder(): Promise<Attempt<Canceled & { status?: FolderCopyStatus }>>; // unlocked only, main's own folder dialog
  stopFolder(): Promise<Attempt<{ status: FolderCopyStatus }>>; // unlocked only; the copy already in the folder stays
  onFolderStatus(callback: (status: FolderCopyStatus) => void): () => void;
}

// Keep a copy in a folder: the folder ("" = off), when the last copy was written, and why the last one failed.
export interface FolderCopyStatus {
  folder: string;
  at: number | null;
  error: string;
  opener: OpenerWrite | null; // the Forever Opener beside the copy
}

declare global {
  interface Window {
    kapevault?: KAPEVaultBridge;
  }
}

// Set by electron/preload.cjs. Missing means the page was opened in a plain browser; App checks
// hasBridge before rendering anything that calls vaultApi.
export const hasBridge = window.kapevault !== undefined;
export const vaultApi = window.kapevault as KAPEVaultBridge;
export const isMac = window.kapevault?.platform === "darwin";
