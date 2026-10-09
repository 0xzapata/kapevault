// KeePassXC CSV (Group, Title, Username, Password, URL, Notes, TOTP, ...) and KeePass 2's generic CSV
// (Account, Login Name, Password, Web Site, Comments).
import { collector } from "./common.js";

export const label = "KeePass / KeePassXC (CSV)";

/** @param {string[]} headers */
export const matches = (headers) => (headers.includes("group") && headers.includes("title") && headers.includes("password")) || (headers.includes("account") && headers.includes("login name") && headers.includes("web site"));

// "Root/Email/Work" -> "Email/Work": the group becomes a tag.
const groupTag = (group) => group.replace(/^\/?Root(\/|$)/i, "").replace(/^\/+|\/+$/g, "");

/** @param {{ records: { row: number, get: (name: string) => string }[] }} table */
export function parse({ records }) {
  const c = collector();
  for (const r of records) {
    const group = groupTag(r.get("group"));
    if (/(^|\/)Recycle Bin$/i.test(group)) {
      c.skip(r.row, "In the KeePass recycle bin");
      continue;
    }
    c.login(r.row, {
      title: r.get("title") || r.get("account"),
      url: r.get("url") || r.get("web site"),
      username: r.get("username") || r.get("login name"),
      password: r.get("password"),
      totp: r.get("totp"),
      notes: r.get("notes") || r.get("comments"),
      folder: group,
    });
  }
  return c.result();
}
