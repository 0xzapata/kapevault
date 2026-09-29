// What the phone UI needs from the vault. UI-agnostic and async: the real host implements it over
// core/ + WebCrypto + Capacitor Filesystem + the VaultKeystore and SecureClipboard plugins; the mock
// host (mock-host.ts) implements it over core/ in memory. The page never holds a stored secret for
// longer than one reveal: the view carries has-flags, getSecret fetches ONE value on demand.

type Unsubscribe = () => void;

// Attempts that can fail in words the user reads. Thrown errors are for broken invariants only.
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// --- The vault as the page sees it (core/public-view.js) ------------------------------------------

type SpaceKind = "personal" | "client";
export interface Space {
  id: string;
  name: string;
  kind: SpaceKind;
}

export type Issue =
  | { type: "reused"; count: number }
  | { type: "weak" }
  | { type: "old"; days: number }
  | { type: "expired"; days: number }
  | { type: "expiring"; days: number }
  | { type: "codes"; left: number };

interface EntryBase {
  id: string;
  spaceId: string;
  title: string;
  tags: string[];
  favorite: boolean;
  notes: string;
  updatedAt: string; // YYYY-MM-DD
  lastUsedAt?: number; // ms
  brand?: string; // undefined = detect, "none" = no logo, else a brand slug
  heldFor?: string;
  issues: Issue[];
}

export type SignInMethod = "password" | "google" | "microsoft" | "apple" | "github" | "facebook" | "email-link" | "sso";
type LifecycleState = "dormant" | "deletion-requested" | "gone";

interface RecoveryCodesView {
  total: number;
  left: number;
  setAt: string;
  paper: { where: string; printedAt: string; outdatedAt?: string }[];
}

export interface LoginEntry extends EntryBase {
  kind: "login";
  username: string;
  url: string;
  signIn: SignInMethod;
  viaEntryId?: string;
  hasPassword: boolean;
  hasTotp: boolean;
  history: { changedAt: string }[]; // newest first; values through getSecret("history", i)
  recoveryCodes?: RecoveryCodesView;
  questions: { question: string; hasAnswer: boolean }[];
  lifecycle?: { state: LifecycleState; requestedAt?: string; followUpAt?: string; goneAt?: string };
}
export type LinkType = "web" | "drive" | "folder" | "doc";
export interface LinkEntry extends EntryBase {
  kind: "link";
  linkType: LinkType;
  location: string;
}
export interface NoteEntry extends EntryBase {
  kind: "note";
  hasBody: boolean;
}
export interface KeyEntry extends EntryBase {
  kind: "key";
  keyId: string;
  url: string;
  expires?: string;
  hasSecret: boolean;
}
export interface PayeeEntry extends EntryBase {
  kind: "payee";
  who: string;
  relation: string;
  provider: string;
  number: string;
  accountName: string;
  confirmedAt?: string;
}
export type GrabPriority = 1 | 2 | 3;
export interface ThingEntry extends EntryBase {
  kind: "thing";
  room: string;
  spot: string;
  grab: GrabPriority;
  expires?: string;
}
export type DeviceType = "router" | "cctv" | "phone" | "laptop" | "other";
export interface DeviceEntry extends EntryBase {
  kind: "device";
  type: DeviceType;
  model: string;
  serial: string;
  imei: string;
  mac: string;
  adminUrl: string;
  adminUser: string;
  ssid: string;
  hasAdminPassword: boolean;
  hasWifiPassword: boolean;
  hasPhoto: boolean;
}

// An identity card: a name from ID_TYPES or one typed under Other. The number and the photo are secrets.
export interface IdEntry extends EntryBase {
  kind: "id";
  idType: string;
  hasNumber: boolean;
  hasPhoto: boolean;
}

export type Entry = LoginEntry | LinkEntry | NoteEntry | KeyEntry | PayeeEntry | ThingEntry | DeviceEntry | IdEntry;
export type EntryKind = Entry["kind"];

export interface VaultView {
  spaces: Space[];
  entries: Entry[];
}

// What a save sends (core upsertEntry). A secret left undefined keeps the stored one.
export interface EntryInput {
  id?: string;
  kind: EntryKind;
  spaceId: string;
  title: string;
  tags: string[];
  favorite: boolean;
  notes: string;
  brand?: string;
  heldFor?: string;
  username?: string;
  password?: string;
  totp?: string; // "" removes 2FA
  signIn?: SignInMethod;
  viaEntryId?: string;
  url?: string;
  linkType?: LinkType;
  location?: string;
  body?: string;
  keyId?: string;
  secret?: string;
  expires?: string;
  who?: string;
  relation?: string;
  provider?: string;
  number?: string;
  accountName?: string;
  room?: string;
  spot?: string;
  grab?: GrabPriority;
  type?: DeviceType;
  model?: string;
  serial?: string;
  imei?: string;
  mac?: string;
  adminUrl?: string;
  adminUser?: string;
  adminPassword?: string;
  ssid?: string;
  wifiPassword?: string;
  idType?: string;
  idNumber?: string;
  photo?: string; // an ID's photo, a JPEG data URL; "" removes it
}

// core secretOf: history / code / answer take an index. photo (an ID's, a JPEG data URL) is never copied.
export type SecretField = "password" | "body" | "secret" | "history" | "code" | "answer" | "adminPassword" | "wifiPassword" | "idNumber" | "photo";

export interface TotpCode {
  code: string; // digits, ungrouped
  period: number; // s
  expiresAt: number; // ms
}

// --- Lock state and unlock ---------------------------------------------------------------------------

export type VaultState = "first-run" | "locked" | "unlocked";
// Why the host locked it: the user, Lock after (session limit), or leaving the app.
export type LockReason = "user" | "session-limit" | "background";

// The desktop's codes (VaultKeystore rejects with the same ones).
// master-required: the fingerprint still fits, but this unlock needs the master password (core/key-salt.js).
export type BiometricErrorCode = "not-enabled" | "canceled" | "locked-out" | "changed" | "unsupported" | "failed" | "master-required";
export type BiometricResult = { ok: true } | { ok: false; code: BiometricErrorCode; error: string };

export interface BiometricStatus {
  available: boolean; // the phone has a sensor with a fingerprint enrolled
  enabled: boolean; // fingerprint unlock is on for this vault
  needsMaster: boolean; // 14 days since the master password was last typed: it is asked for once
}

// --- First run: R2 connection and backups ---------------------------------------------------------

export interface R2Keys {
  url: string; // the bucket's S3 API URL
  accessKeyId: string;
  secretAccessKey: string;
}

// A restore keeps the vault it replaces in one slot on the phone. When that slot already holds another
// vault, nothing is replaced and the page asks (needsConfirm, the PC's rule): "Replace without a copy"
// repeats the restore with `replace`. Locked, that also needs the CURRENT vault's own master password
// (needsMaster), so a confirm alone cannot wipe the vault with someone else's backup.
// olderKey: the backup was made before a master password change another device made since (the
// newest password in the bucket is not one it knows). Restored, the other devices would see this phone
// as behind; the page says so and repeats the restore with acceptOlder when the user goes ahead.
export type RestoreResult = Result | { ok: false; error: string; needsConfirm: true; needsMaster?: true } | { ok: false; error: string; olderKey: true };

export type Platform = "windows" | "mac" | "android" | "ios";

export interface Backup {
  key: string; // the R2 object key
  device: string; // "DESKTOP-4F2A"
  platform: Platform;
  at: number; // R2 LastModified, ms
}

// --- Sync ----------------------------------------------------------------------------------------------

export interface SyncDevice {
  id: string; // install id
  name: string; // "DESKTOP-4F2A", "This phone"
  model: string; // "Windows PC", "Pixel 8"
  platform: Platform;
  thisDevice: boolean;
  lastSyncAt?: number; // ms; its newest snapshot seen
}

// An item a merge made because both devices changed the same thing (SYNC.md 3.3).
export interface ConflictCopy {
  id: string; // the copy's entry id
  originalId?: string; // the item it was copied from, while it still exists
  device: string; // whose version the copy holds: "Pixel 8"
  at: number; // when that version was written, ms
}

// A merge that waits for the user before it is applied (core/sync/review.js, SYNC.md 3.9): it deletes
// many items, changes secrets on many, adopts a restore made the vault on all devices (epoch), or moves
// this vault to another device's newer master password (key). Titles only, never a secret.
export interface SyncReview {
  from: string[]; // device names
  reasons: ("deletes" | "secrets" | "epoch" | "key")[];
  added: string[];
  changed: string[];
  deleted: string[];
  copies: string[];
  secretItems: number;
}

export interface SyncStatus {
  state: "off" | "idle" | "syncing" | "error"; // off: no R2 connection
  apart?: boolean; // "Keep this phone's vault": backing up to a bucket that holds another vault, no sync
  removed?: boolean; // another device removed this phone from sync: it never merges again
  manual?: boolean; // automatic backup is off: nothing syncs by itself, only on Sync now
  lastAt?: number; // the last good sync, ms
  peer?: string; // the device(s) it last met: "DESKTOP-4F2A"
  error?: string;
  problems: string[]; // devices the last run could not merge, and why
  review?: SyncReview | null; // a merge waiting for Apply
  newMaster?: string; // a device whose newer master password must be typed here once to keep syncing
  fingerprint?: string; // the check code: the same on every device once all have synced
  devices: SyncDevice[];
  conflicts: ConflictCopy[];
}

export interface CloudStatus {
  connected: boolean;
  url: string; // the bucket's S3 API URL ("" when not connected)
  accessKeyId: string;
  auto: boolean; // back up a few seconds after each change
  apart: boolean; // backup only: the bucket holds another vault ("Keep this phone's vault")
}

// --- Settings (this phone only; never synced) -----------------------------------------------------

export type ThemeChoice = "system" | "classic" | "dark" | "colorblind" | "contrast";
export type LockGrace = 0 | 30 | 60; // s after the app leaves the screen
export type LockAfterHours = 0 | 1 | 2 | 4 | 8 | 12 | 24; // 0 = off; locks this long after an unlock

export interface PhoneSettings {
  lockGrace: LockGrace;
  lockAfterHours: LockAfterHours;
  theme: ThemeChoice;
  hideFromCapture: boolean; // FLAG_SECURE; off: screenshots, recordings and screen sharing see the app
}

// --- The host -----------------------------------------------------------------------------------------

export interface VaultHost {
  state(): Promise<VaultState>;
  onState(listener: (state: VaultState, reason?: LockReason) => void): Unsubscribe;

  // First run makes a new vault on the phone (the PC's first run), unlocked on success. R2 is optional.
  createVault(master: string): Promise<Result>;

  // Restore from backup (a link on the first-run and lock screens): connect to R2 (a QR from the PC, or
  // the three values typed), pick a backup, unlock it.
  // The camera: the PC's "Add a phone" code (setup) or a site's 2FA code (totp). canceled = closed.
  scanQr(purpose: "setup" | "totp"): Promise<Result<{ text: string }> | { ok: false; canceled: true; error: string }>;
  parseSetupCode(text: string): Result<{ keys: R2Keys }>; // the "Add a phone" payload
  listBackups(keys: R2Keys): Promise<Result<{ backups: Backup[] }>>; // newest first
  restore(keys: R2Keys, backupKey: string, master: string, replace?: { current?: string }, acceptOlder?: boolean): Promise<RestoreResult>; // unlocks on success

  // Unlock. The fingerprint prompt opens only when unlockBiometric is called (on a tap).
  unlock(master: string): Promise<Result>;
  biometricStatus(): Promise<BiometricStatus>;
  unlockBiometric(): Promise<BiometricResult>;
  enableBiometric(): Promise<BiometricResult>; // unlocked only
  disableBiometric(): Promise<void>;
  lock(reason?: LockReason): Promise<void>;
  changeMaster(current: string, next: string): Promise<Result<{ biometricOff: boolean }>>;

  // The vault, unlocked only. Every change pushes a new view to onChanged.
  view(): Promise<VaultView>;
  onChanged(listener: (view: VaultView) => void): Unsubscribe;
  getSecret(id: string, field: SecretField, index?: number): Promise<string>; // reveal: one value
  saveEntry(input: EntryInput): Promise<Result<{ id: string }>>;
  deleteEntry(id: string): Promise<void>;
  toggleFavorite(id: string): Promise<void>;
  confirmPayee(id: string, number: string): Promise<void>; // today, by the host's clock
  clearHistory(id: string): Promise<void>;
  setRecoveryCodes(id: string, codes: string[]): Promise<Result>;
  addSpace(name: string): Promise<Result<{ id: string }>>;

  // Copying: a secret is marked sensitive and cleared from the clipboard after 30 s (SecureClipboard).
  // id marks the item used (Recently used).
  copySecret(id: string, field: SecretField, index?: number): Promise<void>;
  copyText(text: string, id?: string): Promise<void>; // not secret: a username, a number
  totp(id: string): Promise<TotpCode>;
  copyTotp(id: string): Promise<void>;
  openEntry(id: string): Promise<void>; // its website or link, in the phone's browser

  // Sync over R2: on unlock, after a save, and on Sync now.
  syncStatus(): Promise<SyncStatus>;
  onSync(listener: (status: SyncStatus) => void): Unsubscribe;
  syncNow(): Promise<Result>;
  applySync(): Promise<Result<{ biometricOff: boolean }>>; // the held review's merge; biometricOff: it adopted a new master password
  adoptSyncKey(master: string): Promise<Result>; // SyncStatus.newMaster's password, typed once; a review follows
  cloudStatus(): Promise<CloudStatus>;
  setCloudAuto(auto: boolean): Promise<CloudStatus>;
  // Settings > Backup and sync > Connect to R2, unlocked. A bucket with no other vault in it connects
  // and this vault starts backing up. A bucket holding ANOTHER vault (other device's, a different vault
  // id: sync would refuse it) connects nothing yet and names that backup; the page then asks:
  connectCloud(keys: R2Keys): Promise<Result<{ other?: Backup }>>;
  // "Use the vault from <device>": that backup, opened with its master password, becomes this phone's
  // vault, and this phone's items join it as new items (nothing typed here is lost); the vault it
  // replaces is kept in the replaced slot when that is free. Unlocks it.
  useCloudVault(keys: R2Keys, backupKey: string, master: string): Promise<Result<{ carried: number }>>;
  // "Keep this phone's vault": this vault backs up to the bucket, but does not sync (CloudStatus.apart).
  keepThisVault(keys: R2Keys): Promise<Result>;

  settings(): Promise<PhoneSettings>;
  setSettings(patch: Partial<PhoneSettings>): Promise<PhoneSettings>;

  // Restore from a file picked on the phone (Drive, Files, USB). checkBackupFile says at once whether the
  // text is a vault file (the same checks as before any key derivation); restoreFile then works as
  // restore() does, with the backup's own master password. Unlocks on success.
  checkBackupFile(text: string): Result;
  restoreFile(text: string, master: string, replace?: { current?: string }): Promise<RestoreResult>;
}
