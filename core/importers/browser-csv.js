// Chrome, Edge and Brave password export: name,url,username,password,note (older files have no note).
import { collector } from "./common.js";

export const label = "Chrome / Edge / Brave (CSV)";

/** @param {string[]} headers */
export const matches = (headers) => ["name", "url", "username", "password"].every((h) => headers.includes(h));

/** @param {{ records: { row: number, get: (name: string) => string }[] }} table */
export function parse({ records }) {
  const c = collector();
  for (const r of records) c.login(r.row, { title: r.get("name"), url: r.get("url"), username: r.get("username"), password: r.get("password"), notes: r.get("note") });
  return c.result();
}
