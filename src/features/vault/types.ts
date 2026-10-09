export type SpaceKind = "personal" | "client";

export interface Space {
  id: string;
  name: string;
  kind: SpaceKind;
}

// Password health, worked out in the main process (it holds the passwords).
export type Issue =
  | { type: "reused"; count: number }
  | { type: "weak" }
  | { type: "old"; days: number }
  | { type: "expired"; days: number }
  | { type: "expiring"; days: number }
  | { type: "codes"; left: number }; // backup codes: 2 or fewer unused

interface EntryBase {
  id: string;
  spaceId: string;
  title: string;
  tags: string[];
  favorite: boolean;
  notes: string;
  updatedAt: string;
  lastUsedAt?: number; // ms; set when a secret is copied or the item is opened
  brand?: string; // undefined = auto-detect logo, "none" = no logo, else a brand slug
  heldFor?: string; // the person this is kept for ("Mama"); undefined = your own
  issues: Issue[];
  trashedAt?: string; // UTC timestamp; only on the items in VaultView.trash
  daysLeft?: number; // whole days before the Trash lets go; only on the items in VaultView.trash
}

// The page never holds a stored secret - only whether one exists. Reveal/copy fetch it on demand.
export interface LoginEntry extends EntryBase {
  kind: "login";
  username: string;
  hasPassword: boolean;
  hasTotp: boolean;
  history: { changedAt: string }[]; // old passwords, newest first; values fetched one at a time
  recoveryCodes?: RecoveryCodesView; // backup codes: counts only, the codes stay in main
  questions: SecurityQuestion[]; // answers stay in main; fetched one at a time
  lifecycle?: Lifecycle; // being closed on purpose; undefined = in use
  signIn: SignInMethod; // how you log in; not every account has a password
  viaEntryId?: string; // for OAuth: the saved account item you sign in through (e.g. your Gmail login)
  url: string;
}

export interface PaperCopy {
  where: string; // "Desk drawer"
  printedAt: string; // YYYY-MM-DD
  outdatedAt?: string; // set when a new set replaced the codes printed on it
}

// Shrink Queue. A "gone" login is a tombstone: every secret wiped, only title, site and username kept.
export type LifecycleState = "dormant" | "deletion-requested" | "gone";
export interface Lifecycle {
  state: LifecycleState;
  requestedAt?: string; // YYYY-MM-DD, the erasure request was sent
  followUpAt?: string; // YYYY-MM-DD, 30 days on
  goneAt?: string; // YYYY-MM-DD, confirmed deleted
}

// A security question as the page sees it: the answer (often made up on purpose) stays in main.
export interface SecurityQuestion {
  question: string;
  hasAnswer: boolean;
}

// What the form sends per question. answer undefined = keep the stored answer of question `from`.
export interface QuestionInput {
  question: string;
  answer?: string;
  from?: number;
}

export interface RecoveryCodesView {
  total: number;
  left: number; // not ticked off as used
  setAt: string; // YYYY-MM-DD
  paper: PaperCopy[];
}

export type SignInMethod = "password" | "google" | "microsoft" | "apple" | "github" | "facebook" | "email-link" | "sso";

export type LinkType = "web" | "drive" | "folder" | "doc";

export interface LinkEntry extends EntryBase {
  kind: "link";
  linkType: LinkType;
  location: string;
}

// Recovery codes, Wi-Fi, anything private that is not a login. The body stays in main.
export interface NoteEntry extends EntryBase {
  kind: "note";
  hasBody: boolean;
}

// API keys and tokens: the ID is shown, the secret is not.
export interface KeyEntry extends EntryBase {
  kind: "key";
  keyId: string;
  hasSecret: boolean;
  url: string;
  expires?: string; // YYYY-MM-DD
}

// Where Is It: a physical thing (passport, land title, YubiKey) and where it is kept. Not secret.
export type GrabPriority = 1 | 2 | 3; // 1 grab first, 2 if there is time, 3 leave it
export interface ThingEntry extends EntryBase {
  kind: "thing";
  room: string; // "Bedroom"; "" = not said
  spot: string; // the exact place: "blue folder, top shelf of the bedroom cabinet"
  grab: GrabPriority;
  expires?: string; // YYYY-MM-DD: an ID's expiry (passport, license), flagged like a key's
}

// Sticker Capture: a router, CCTV box, phone or laptop and what its label says. The admin and Wi-Fi
// passwords and the label photo stay in main; the page gets has-flags and fetches one on demand.
export type DeviceType = "router" | "cctv" | "phone" | "laptop" | "other";
export interface DeviceEntry extends EntryBase {
  kind: "device";
  type: DeviceType;
  model: string;
  serial: string;
  imei: string; // 15 digits, Luhn-checked in main
  mac: string; // AA:BB:CC:DD:EE:FF
  adminUrl: string; // "192.168.1.1" opens over http
  adminUser: string;
  ssid: string; // the Wi-Fi name
  hasAdminPassword: boolean;
  hasWifiPassword: boolean;
  hasPhoto: boolean;
}

// An identity card: its type is a name from ID_TYPES or one typed under Other. The number and the photo
// stay in main.
export interface IdEntry extends EntryBase {
  kind: "id";
  idType: string;
  hasNumber: boolean;
  hasPhoto: boolean;
}

export type Entry = LoginEntry | LinkEntry | NoteEntry | KeyEntry | ThingEntry | DeviceEntry | IdEntry;
export type EntryKind = Entry["kind"];

export type ViewFilter = "all" | "favorites" | "login" | "totp" | "note" | "key" | "link" | "thing" | "device" | "security" | "closing" | "closed" | "id" | "trash";

export type SortOrder = "recent" | "title" | "edited";

export interface VaultView {
  spaces: Space[];
  entries: Entry[]; // never the Trash: every list, search and count reads this
  trash: Entry[]; // moved to the Trash less than 30 days ago
  masterWeak?: boolean; // the last master-password unlock found the master easy to guess (main keeps only this flag)
}

// What the form sends. A secret left undefined keeps the stored one.
export interface EntryInput {
  id?: string;
  kind: EntryKind;
  spaceId: string;
  title: string;
  tags: string[];
  favorite: boolean;
  notes: string;
  brand?: string;
  heldFor?: string; // "" = your own
  username?: string;
  password?: string;
  totp?: string; // "" removes 2FA
  questions?: QuestionInput[];
  signIn?: SignInMethod;
  viaEntryId?: string;
  url?: string;
  linkType?: LinkType;
  location?: string;
  body?: string;
  keyId?: string;
  secret?: string;
  expires?: string;
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
  photo?: string; // a JPEG data URL; "" removes it
  idType?: string;
  idNumber?: string;
}
