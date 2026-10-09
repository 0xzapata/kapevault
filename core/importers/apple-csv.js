// Apple Passwords / iCloud Keychain export: Title,URL,Username,Password,Notes,OTPAuth (the older Safari
// export has only Title,Url,Username,Password)
import { collector } from "./common.js";

export const label = "Apple Passwords (CSV)";

/** @param {string[]} headers */
export const matches = (headers) => ["title", "url", "username", "password"].every((h) => headers.includes(h));

/** @param {{ records: { row: number, get: (name: string) => string }[] }} table */
export function parse({ records }) {
  const c = collector();
  for (const r of records) c.login(r.row, { title: r.get("title"), url: r.get("url"), username: r.get("username"), password: r.get("password"), totp: r.get("otpauth"), notes: r.get("notes") });
  return c.result();
}
