// LastPass CSV export: url,username,password,totp,extra,name,grouping,fav (older files have no totp).
// A secure note has the url "http://sn" and its text in `extra`; "http://group" rows are empty folders.
import { collector } from "./common.js";

export const label = "LastPass (CSV)";

/** @param {string[]} headers */
export const matches = (headers) => ["url", "extra", "name", "grouping", "password"].every((h) => headers.includes(h));

/** @param {{ records: { row: number, get: (name: string) => string }[] }} table */
export function parse({ records }) {
  const c = collector();
  for (const r of records) {
    const url = r.get("url").trim().toLowerCase();
    if (url === "http://group") {
      c.skipEmpty(r.row, "Empty LastPass folder");
      continue;
    }
    const common = { title: r.get("name"), folder: r.get("grouping"), favorite: r.get("fav") === "1" };
    // LastPass heads a note's text with its own "NoteType:Generic" line (and a language line).
    if (url === "http://sn") c.note(r.row, { ...common, body: r.get("extra").replace(/^NoteType:Generic\r?\n(Language:[^\r\n]*\r?\n)?/, "") });
    else c.login(r.row, { ...common, url: r.get("url"), username: r.get("username"), password: r.get("password"), totp: r.get("totp"), notes: r.get("extra") });
  }
  return c.result();
}
