// What the page may see of the vault. Secrets (passwords, 2FA keys, secure note bodies, API key
// secrets, old passwords, backup codes, security question answers, a device's admin and Wi-Fi passwords
// and label photo, an ID's number and photo) never go in: the page gets hasX flags and asks for ONE
// value through secretOf.
import { isTrashed } from "./entries.js";
import { liveEntries, trashDaysLeft } from "./trash.js";
/** @import { Entry, VaultData } from "./entries.js" */

// A login's backup codes: counts and paper copies, never a code.
function codesView(set) {
  if (!set) return undefined;
  return {
    total: set.codes.length,
    left: set.codes.filter((c) => !c.used).length,
    setAt: set.setAt,
    paper: (set.paper ?? []).map(({ where, printedAt, outdatedAt }) => ({ where, printedAt, outdatedAt })),
  };
}

// The known safe fields, copied one by one (an allowlist). Anything not listed (a secret field added
// later included) stays with the host without anyone having to remember.
function publicEntry(e, issues) {
  const base = {
    id: e.id,
    kind: e.kind,
    spaceId: e.spaceId,
    title: e.title,
    tags: e.tags ?? [],
    favorite: Boolean(e.favorite),
    notes: e.notes ?? "",
    updatedAt: e.updatedAt,
    lastUsedAt: e.lastUsedAt,
    brand: e.brand,
    heldFor: e.heldFor,
    issues: issues.get(e.id) ?? [],
  };
  switch (e.kind) {
    case "login":
      return {
        ...base,
        username: e.username ?? "",
        url: e.url ?? "",
        signIn: e.signIn ?? "password",
        viaEntryId: e.viaEntryId,
        hasPassword: Boolean(e.password),
        hasTotp: Boolean(e.totp),
        history: (e.history ?? []).map((h) => ({ changedAt: h.changedAt })),
        recoveryCodes: codesView(e.recoveryCodes),
        questions: (e.questions ?? []).map((q) => ({ question: q.question, hasAnswer: Boolean(q.answer) })),
        lifecycle: e.lifecycle && { state: e.lifecycle.state, requestedAt: e.lifecycle.requestedAt, followUpAt: e.lifecycle.followUpAt, goneAt: e.lifecycle.goneAt },
      };
    case "note":
      return { ...base, hasBody: Boolean(e.body) };
    case "key":
      return { ...base, keyId: e.keyId ?? "", url: e.url ?? "", expires: e.expires, hasSecret: Boolean(e.secret) };
    case "link":
      return { ...base, linkType: e.linkType, location: e.location ?? "" };
    case "thing":
      return { ...base, room: e.room ?? "", spot: e.spot, grab: e.grab, expires: e.expires };
    case "device":
      return {
        ...base,
        type: e.type,
        model: e.model ?? "",
        serial: e.serial ?? "",
        imei: e.imei ?? "",
        mac: e.mac ?? "",
        adminUrl: e.adminUrl ?? "",
        adminUser: e.adminUser ?? "",
        ssid: e.ssid ?? "",
        hasAdminPassword: Boolean(e.adminPassword),
        hasWifiPassword: Boolean(e.wifiPassword),
        hasPhoto: Boolean(e.photo),
      };
    case "id":
      return { ...base, idType: e.idType, hasNumber: Boolean(e.idNumber), hasPhoto: Boolean(e.photo) };
    default:
      return base;
  }
}

/**
 * `entries` holds only the items that are not in the Trash, so every list, search and count built from
 * it leaves the Trash out without knowing about it; the Trash view reads `trash`, whose items carry their
 * `daysLeft` (read against the vault's sync stamps, which the page never holds).
 * @param {VaultData} data
 * @param {Map<string, object[]>} issues findIssues' result
 * @param {number} [now] ms
 */
export function publicView(data, issues, now = Date.now()) {
  const trashed = data.entries.filter(isTrashed);
  const trashedIds = new Set(trashed.map((e) => e.id));
  return {
    spaces: data.spaces,
    // A login that signed in through an item in the Trash reads as unlinked until that item is restored.
    entries: liveEntries(data.entries).map((e) => {
      const view = publicEntry(e, issues);
      return trashedIds.has(view.viaEntryId) ? { ...view, viaEntryId: undefined } : view;
    }),
    trash: trashed.map((e) => ({ ...publicEntry(e, issues), trashedAt: e.trashedAt, daysLeft: trashDaysLeft(e, now, data) })),
  };
}

// field: "password" | "body" (secure note) | "secret" (API key) | "history" (old password at index)
// | "code" (backup code at index) | "answer" (security question answer at index)
// | "adminPassword" / "wifiPassword" / "photo" (a device's; the photo is a JPEG data URL)
// | "idNumber" / "photo" (an ID's)
/** @param {Entry} entry @param {string} field @param {number} [index] @returns {string} */
export function secretOf(entry, field, index = 0) {
  if (field === "password" && entry.kind === "login") return entry.password ?? ""; // a closed account has none left
  if (field === "body" && entry.kind === "note") return entry.body;
  if (field === "secret" && entry.kind === "key") return entry.secret;
  if (field === "history" && entry.kind === "login") return entry.history?.[index]?.password ?? "";
  if (field === "code" && entry.kind === "login") return entry.recoveryCodes?.codes[index]?.code ?? "";
  if (field === "answer" && entry.kind === "login") return entry.questions?.[index]?.answer ?? "";
  if ((field === "adminPassword" || field === "wifiPassword" || field === "photo") && entry.kind === "device") return entry[field] ?? "";
  if ((field === "idNumber" || field === "photo") && entry.kind === "id") return entry[field] ?? "";
  return "";
}
