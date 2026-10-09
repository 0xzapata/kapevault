// 1Password CSV export: Title, Url or Website, Username, Password, OTPAuth (one-time password), Notes,
// Type, Favorite, Archived, Tags (the columns differ a little between versions).
import { collector } from "./common.js";

export const label = "1Password (CSV)";

// The columns this parser reads, and the ones that only describe the item. Anything else with a value in
// it (a card number, an identity, a section field) has no place here, so the row is reported.
const KNOWN = ["title", "url", "website", "username", "password", "otpauth", "one-time password", "notes", "type", "favorite", "archived", "tags", "created date", "uuid", "scope", "autosubmit"];

/** @param {string[]} headers */
export const matches = (headers) => headers.includes("title") && headers.includes("password") && ["website", "type", "favorite", "archived", "tags"].some((h) => headers.includes(h));

/** @param {{ records: { row: number, get: (name: string) => string, hasOther: (known: string[]) => boolean }[] }} table */
export function parse({ records }) {
  const c = collector();
  for (const r of records) {
    if (r.get("archived").toLowerCase() === "true") {
      c.skip(r.row, "Archived in 1Password");
      continue;
    }
    const tags = r.get("tags").split(/[;,]/).map((t) => t.trim()).filter(Boolean);
    const common = { title: r.get("title"), tags, favorite: r.get("favorite").toLowerCase() === "true" };
    const url = r.get("url") || r.get("website");
    const extra = r.hasOther(KNOWN);
    // A card or an identity has nothing in the login columns: it is not an empty row.
    if (extra && !url && !r.get("username") && !r.get("password") && !r.get("notes")) {
      c.skip(r.row, "Has details KAPEVault cannot keep");
      continue;
    }
    if (/note/i.test(r.get("type"))) c.note(r.row, { ...common, body: r.get("notes") });
    else c.login(r.row, { ...common, url, username: r.get("username"), password: r.get("password"), totp: r.get("otpauth") || r.get("one-time password"), notes: r.get("notes") });
    if (extra) c.skip(r.row, "Has details KAPEVault cannot keep");
  }
  return c.result();
}
