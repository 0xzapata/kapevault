// The field groups sync versions and merges as a unit (SYNC.md 3.3). Two devices that changed
// different groups of one item both keep their change; a group changed on both is one conflict.
// `id` is the item's identity and `lastUsedAt` is bookkeeping (merged by max, never versioned), so
// neither belongs to a group. A field no table knows yet (a newer app version) falls into `core`.

const SHARED = { title: "core", tags: "core", notes: "core", heldFor: "core", brand: "core", updatedAt: "core", kind: "core", favorite: "fav", spaceId: "space", trashedAt: "trash" };

const BY_KIND = {
  login: { username: "core", url: "core", signIn: "core", viaEntryId: "core", password: "pw", passwordChangedAt: "pw", history: "history", totp: "totp", questions: "qa", recoveryCodes: "codes", lifecycle: "life" },
  link: { linkType: "core", location: "core" },
  note: { body: "body" },
  key: { keyId: "core", url: "core", expires: "core", secret: "secret" },
  thing: { room: "core", spot: "core", grab: "core", expires: "core" },
  device: { type: "core", model: "core", serial: "core", imei: "core", mac: "core", adminUrl: "core", adminUser: "core", ssid: "core", adminPassword: "dpw", wifiPassword: "wifi", photo: "photo" },
  id: { idType: "core", idNumber: "idnum", photo: "photo" },
};

const UNVERSIONED = new Set(["id", "lastUsedAt"]);

/** The group a field of an entry of `kind` belongs to, or null for id / lastUsedAt. */
export function groupOf(kind, field) {
  if (UNVERSIONED.has(field)) return null;
  return SHARED[field] ?? BY_KIND[kind]?.[field] ?? "core";
}

/** An entry's fields split by group: { core: { title, ... }, pw: { password, ... }, ... }. Undefined fields are left out. */
export function splitGroups(entry) {
  const groups = {};
  for (const [field, value] of Object.entries(entry)) {
    const group = groupOf(entry.kind, field);
    if (group && value !== undefined) {
      groups[group] ??= {};
      groups[group][field] = value;
    }
  }
  return groups;
}

// A space has one group: its name (and kind, which never changes after it is made).
export const SPACE_GROUP = "core";
