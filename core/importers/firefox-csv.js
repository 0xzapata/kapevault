// Firefox password export: url,username,password,httpRealm,formActionOrigin,guid,timeCreated,... (older
// versions call the first column hostname). Firefox keeps no title, so the site name is the title.
// Firefox's own sync login (chrome://FirefoxAccounts, a key blob) is not one of the person's passwords.
import { collector } from "./common.js";

export const label = "Firefox (CSV)";

/** @param {string[]} headers */
export const matches = (headers) => (headers.includes("url") || headers.includes("hostname")) && ["username", "password"].every((h) => headers.includes(h)) && (headers.includes("httprealm") || headers.includes("formactionorigin"));

/** @param {{ records: { row: number, get: (name: string) => string }[] }} table */
export function parse({ records }) {
  const c = collector();
  for (const r of records) {
    const url = r.get("url") || r.get("hostname");
    if (url.trim().toLowerCase() === "chrome://firefoxaccounts") c.skipEmpty(r.row, "Firefox's own sync login");
    else c.login(r.row, { url, username: r.get("username"), password: r.get("password") });
  }
  return c.result();
}
