// Test fixtures, imported only by *.test.ts: one item of each kind, with overrides. Mock data only.
import type { DeviceEntry, IdEntry, KeyEntry, LinkEntry, LoginEntry, NoteEntry, PayeeEntry, Space, ThingEntry } from "../types";

const base = (id: string, title: string) => ({ id, spaceId: "mine", title, tags: [], favorite: false, notes: "", updatedAt: "2026-01-01T00:00:00.000Z", issues: [] });

export const SPACES: Space[] = [
  { id: "mine", name: "Personal", kind: "personal" },
  { id: "northwind", name: "Northwind Studio", kind: "client" },
];

export const login = (o: Partial<LoginEntry> = {}): LoginEntry => ({
  ...base("login-1", "Example Mail"),
  kind: "login",
  username: "mock.user@example.com",
  hasPassword: true,
  hasTotp: false,
  history: [],
  questions: [],
  signIn: "password",
  url: "https://mail.example.com",
  ...o,
});

export const note = (o: Partial<NoteEntry> = {}): NoteEntry => ({ ...base("note-1", "Alarm code"), kind: "note", hasBody: true, ...o });

export const key = (o: Partial<KeyEntry> = {}): KeyEntry => ({ ...base("key-1", "Example API"), kind: "key", keyId: "pk_mock_123", hasSecret: true, url: "https://api.example.com", ...o });

export const link = (o: Partial<LinkEntry> = {}): LinkEntry => ({ ...base("link-1", "Brand assets"), kind: "link", linkType: "web", location: "https://drive.example.com/assets", ...o });

export const payee = (o: Partial<PayeeEntry> = {}): PayeeEntry => ({
  ...base("payee-1", "Mama GCash"),
  kind: "payee",
  who: "Mama",
  relation: "Mother",
  provider: "GCash",
  number: "09171234567",
  accountName: "MA*** D*** C.",
  ...o,
});

export const thing = (o: Partial<ThingEntry> = {}): ThingEntry => ({ ...base("thing-1", "Passport"), kind: "thing", room: "Bedroom", spot: "blue folder, top shelf", grab: 1, ...o });

export const device = (o: Partial<DeviceEntry> = {}): DeviceEntry => ({
  ...base("device-1", "Home router"),
  kind: "device",
  type: "router",
  model: "Archer C6",
  serial: "",
  imei: "",
  mac: "",
  adminUrl: "192.168.1.1",
  adminUser: "admin",
  ssid: "Harbor-5G",
  hasAdminPassword: true,
  hasWifiPassword: true,
  hasPhoto: false,
  ...o,
});

export const id = (o: Partial<IdEntry> = {}): IdEntry => ({ ...base("id-1", "Driver's license"), kind: "id", idType: "Driver's license", hasNumber: true, hasPhoto: false, ...o });

// A stand-in for window.kapevault that records every call, set before a module that reads it loads.
export function fakeBridge() {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const bridge = { platform: "win32", copyText: record("copyText"), copyPassword: record("copyPassword"), copySecret: record("copySecret"), copyTotp: record("copyTotp"), openEntry: record("openEntry") };
  (globalThis as { window?: unknown }).window = { kapevault: bridge };
  return calls;
}
