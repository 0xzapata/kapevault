// Reading items out of the open vault: the folders the file browser may read, what "Open" opens, the
// hand-back printout, and the secrets that come out one at a time. Nothing here changes the vault, so
// it needs only the session and the lookups of vault-session's context.
const path = require("node:path");
const core = require("../core/index.js");
const { totpCode } = require("./totp.cjs");
const { isNetworkPath } = require("./file-access.cjs");
const { GRAB_NAMES } = require("./evacuation.cjs");
const { tooWide, refusedByName } = require("./vault-session-folders.cjs");

const SIGN_IN_NAMES = { google: "Google", microsoft: "Microsoft", apple: "Apple", github: "GitHub", facebook: "Facebook", "email-link": "Email link", sso: "SSO" };
const DEVICE_NAMES = { router: "Router", cctv: "CCTV / NVR", phone: "Phone", laptop: "Laptop", other: "Other" };

// A value a name map does not name prints nothing (as before) - never an inherited member such as "constructor".
const named = (map, value) => (Object.hasOwn(map, value) ? map[value] : undefined);

/** @param {import("./vault-session.cjs").VaultContext} ctx */
function createReads(ctx) {
  const { requireOpen, findLiveEntry } = ctx;

  // Folders saved as file links - the only places the file browser may read. Empty while locked. A link
  // that came in by sync or restore skipped saveEntry's checks, so the same two run here: a whole drive
  // or the home folder, and the names refused outright, widen nothing. (A plain network folder stays: it
  // lists only after a click.)
  function linkedFolders() {
    if (!ctx.session) return [];
    return core.liveEntries(ctx.session.data.entries)
      .filter((e) => e.kind === "link" && e.linkType === "folder" && path.isAbsolute(e.location) && !refusedByName(e.location) && (isNetworkPath(e.location) || !tooWide(e.location)))
      .map((e) => e.location);
  }

  // What "Open" opens for an item: a file link's location, a login's / API key's website, or a
  // device's admin page. A website saved without a scheme ("google.com") is a website, never a path
  // on this PC; a device's bare address (192.168.1.1) is http, as routers serve their admin page.
  function openTarget(id) {
    const entry = findLiveEntry(String(id));
    const raw = core.cleanText(entry.kind === "link" ? entry.location : entry.kind === "device" ? entry.adminUrl : entry.kind === "note" ? "" : entry.url);
    if (!raw) throw new Error("This item has no link");
    // A path from either OS stays a path: a Windows folder link opened on a Mac is not a website.
    if (entry.kind === "link" && (path.win32.isAbsolute(raw) || path.posix.isAbsolute(raw))) return { kind: "path", target: raw };
    const url = /^[a-z][a-z0-9+.-]+:/i.test(raw) ? raw : `${entry.kind === "device" ? "http" : "https"}://${raw}`;
    return { kind: "url", target: url };
  }

  // "Hand back": every item kept for one person (heldFor, any case), as label/value rows for the
  // printout. Secrets are read only when the page's tick box asked for them.
  function handBack(person, withSecrets) {
    const data = requireOpen();
    const name = core.cleanText(person).toLowerCase();
    const entries = core.liveEntries(data.entries).filter((e) => name && core.cleanText(e.heldFor).toLowerCase() === name);
    if (!entries.length) throw new Error("Nothing is held for that person");
    const spaceName = (id) => data.spaces.find((s) => s.id === id)?.name ?? "";
    const items = [...entries]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((e) => {
        const rows = [];
        const add = (label, value, secret = false) => {
          if (value && (withSecrets || !secret)) rows.push({ label, value, secret });
        };
        if (e.kind === "login") {
          add("Website", e.url);
          add("Signs in with", named(SIGN_IN_NAMES, e.signIn));
          add("Username", e.username);
          add("Password", e.password, true);
          add("2FA setup key", withSecrets && e.totp ? core.parseTotp(e.totp).secret : "", true);
          add("Backup codes", (e.recoveryCodes?.codes ?? []).filter((c) => !c.used).map((c) => c.code).join("\n"), true);
          for (const q of e.questions ?? []) {
            add("Security question", q.question);
            add("Answer", q.answer, true);
          }
        } else if (e.kind === "key") {
          add("Website", e.url);
          add("Key ID", e.keyId);
          add("Secret", e.secret, true);
        } else if (e.kind === "link") {
          add("Location", e.location);
        } else if (e.kind === "note") {
          add("Note", e.body, true);
        } else if (e.kind === "thing") {
          add("Room", e.room);
          add("Where", e.spot);
          add("In a hurry", named(GRAB_NAMES, e.grab));
          add("Expires", e.expires);
        } else if (e.kind === "device") {
          add("Type", named(DEVICE_NAMES, e.type));
          add("Model", e.model);
          add("Serial number", e.serial);
          add("IMEI", e.imei);
          add("MAC address", e.mac);
          add("Admin page", e.adminUrl);
          add("Admin username", e.adminUser);
          add("Admin password", e.adminPassword, true);
          add("Wi-Fi name", e.ssid);
          add("Wi-Fi password", e.wifiPassword, true);
        } else if (e.kind === "id") {
          add("ID", e.idType);
          add("ID number", e.idNumber, true);
        }
        add("Notes", e.notes);
        return { title: e.title, space: spaceName(e.spaceId), rows };
      });
    return { person: core.cleanText(entries[0].heldFor), items };
  }

  // One secret on reveal/copy/edit; the fields are listed at core's secretOf.
  function getSecret(id, field, index) {
    return core.secretOf(findLiveEntry(id), field, index);
  }

  function getPassword(id) {
    const entry = requireOpen().entries.find((e) => e.id === id);
    return entry && entry.kind === "login" && !core.isTrashed(entry) ? entry.password ?? "" : "";
  }

  function getTotpCode(id) {
    const entry = findLiveEntry(id);
    if (entry.kind !== "login" || !entry.totp) throw new Error("No 2FA code for this item");
    return totpCode(entry.totp);
  }

  function followUpsDue() {
    return ctx.session ? core.followUpsDue(ctx.session.data) : 0; // core leaves the Trash out
  }

  function getRecoveryCodes(id) {
    return core.listRecoveryCodes(requireOpen(), id);
  }

  return { linkedFolders, openTarget, handBack, getSecret, getPassword, getTotpCode, followUpsDue, getRecoveryCodes };
}

module.exports = { createReads };
