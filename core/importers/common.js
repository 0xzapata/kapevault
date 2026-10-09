// What every source parser shares: turning one exported row into a KAPEVault import item, the list of
// rows that could not be imported (with the reason), and short notes about what was changed on the way.
// The items go through core/import.js exactly like a KAPEVault import file, so its checks and its
// duplicate rule apply to them too.
//
// A skipped row is either harmless (it held nothing: an empty line, an empty folder, an exact copy of an
// earlier row) or it is not. The host deletes the export only when no row is lost, so every skip that
// is not provably empty must go through `skip`, and only `skipEmpty` marks a row as holding nothing.
import { parseTotp } from "../totp.js";

/** A refusal whose message is meant for the person, as it is (an encrypted export). */
export class ImportRefused extends Error {}

const text = (value) => (typeof value === "string" ? value.trim() : "");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** @param {{ row: number, reason: string, harmless?: true }[]} skipped @returns {{ row: number, reason: string }[]} the rows that held something and were not imported */
export const lostRows = (skipped) => skipped.filter((s) => !s.harmless);

/** @param {string} url @returns {string} the site's host without "www.", or "" */
export function hostOf(url) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// An app link (android://..., a custom scheme) is not a website: it goes to the notes instead.
function splitUrl(raw) {
  const url = text(raw);
  if (!url || /^https?:\/\//i.test(url) || !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return { url, app: "" };
  return { url: "", app: url };
}

/** @param {[string, unknown][]} pairs @returns {string} "Label: value" lines, empty values left out */
export function fieldLines(pairs) {
  return pairs
    .filter(([, value]) => text(value))
    .map(([label, value]) => `${label}: ${text(value)}`)
    .join("\n");
}

/** One import run's collector. */
export function collector() {
  const items = [];
  const skipped = [];
  const counts = { noPassword: 0, badTotp: 0, appLinks: 0, asNotes: 0, renamed: 0 };
  const seen = new Set();

  const skip = (row, reason) => skipped.push({ row, reason });
  const skipEmpty = (row, reason) => skipped.push({ row, reason, harmless: true });

  function add(row, item) {
    const signature = JSON.stringify([item.kind, item.title.toLowerCase(), item.username, item.password, item.url, item.totp, item.body, item.keyId, item.secret, item.notes]);
    if (seen.has(signature)) return skipEmpty(row, "Same item as an earlier row");
    seen.add(signature);
    items.push(item);
  }

  /**
   * @param {number} row
   * @param {{ title?: string, url?: string, username?: string, password?: string, totp?: string, notes?: string, folder?: string, tags?: string[], favorite?: boolean }} f
   */
  function login(row, f) {
    const { url, app } = splitUrl(f.url);
    const username = text(f.username);
    const password = typeof f.password === "string" ? f.password : "";
    const notes = [text(f.notes), app ? `App: ${app}` : ""].filter(Boolean).join("\n");
    if (app) counts.appLinks += 1;
    let totp = "";
    if (text(f.totp)) {
      try {
        totp = parseTotp(f.totp).uri;
      } catch {
        counts.badTotp += 1;
      }
    }
    const title = text(f.title) || hostOf(url) || username;
    if (!title) return password || notes || totp ? skip(row, "No title, site or username") : skipEmpty(row, "No title, site or username");
    // Only a note under a title: it belongs with the secure notes, where the text stays hidden.
    if (!url && !username && !password && !totp && notes) return note(row, { title, body: notes, folder: f.folder, tags: f.tags, favorite: f.favorite });
    if (!url && !username && !password && !totp) return skipEmpty(row, "Nothing to import (no site, username, password or notes)");
    if (!password) counts.noPassword += 1;
    const tags = [...(f.tags ?? []), text(f.folder)].filter(Boolean);
    const item = { kind: "login", title, url, username, password, notes, tags, favorite: f.favorite === true };
    if (totp) item.totp = totp;
    add(row, item);
  }

  /** @param {number} row @param {{ title?: string, body?: string, folder?: string, tags?: string[], favorite?: boolean }} f */
  function note(row, f) {
    const title = text(f.title);
    const body = typeof f.body === "string" ? f.body : "";
    if (!title && !text(body)) return skipEmpty(row, "Secure note with no title or text");
    const tags = [...(f.tags ?? []), text(f.folder)].filter(Boolean);
    add(row, { kind: "note", title: title || text(body).split("\n")[0].slice(0, 60), body, tags, favorite: f.favorite === true });
  }

  /** @param {number} row @param {{ title?: string, keyId?: string, secret?: string, notes?: string, folder?: string, tags?: string[], favorite?: boolean }} f */
  function key(row, f) {
    const title = text(f.title);
    if (!title) return skip(row, "Key with no title");
    const tags = [...(f.tags ?? []), text(f.folder)].filter(Boolean);
    add(row, { kind: "key", title, keyId: text(f.keyId), secret: typeof f.secret === "string" ? f.secret : "", notes: text(f.notes), tags, favorite: f.favorite === true });
  }

  // Items that share a title in one file get the username or a number, so they can be told apart in
  // the list afterwards.
  function result(extra = []) {
    const used = new Set();
    for (const item of items) {
      const key = (title) => `${item.kind}\n${title.toLowerCase()}`;
      let title = item.title;
      if (used.has(key(title)) && item.username) title = `${item.title} (${item.username})`;
      for (let n = 2; used.has(key(title)); n += 1) title = `${item.title} (${n})`;
      if (title !== item.title) counts.renamed += 1;
      item.title = title;
      used.add(key(title));
    }
    const notes = [...extra];
    if (counts.noPassword) notes.push(`${plural(counts.noPassword, "login has", "logins have")} no password.`);
    if (counts.badTotp) notes.push(`${plural(counts.badTotp, "login had a 2FA key", "logins had a 2FA key")} KAPEVault cannot read, so ${counts.badTotp === 1 ? "it came" : "they came"} in without it.`);
    if (counts.appLinks) notes.push(`${plural(counts.appLinks, "app link was", "app links were")} moved into the notes.`);
    if (counts.asNotes) notes.push(`${plural(counts.asNotes, "card, identity or ID was", "cards, identities or IDs were")} saved as secure notes.`);
    if (counts.renamed) notes.push(`${plural(counts.renamed, "item shares", "items share")} a title with another one and ${counts.renamed === 1 ? "was" : "were"} renamed.`);
    return { items, skipped, notes };
  }

  return { login, note, key, skip, skipEmpty, counts, result };
}
