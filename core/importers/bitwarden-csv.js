// Bitwarden CSV export: folder,favorite,type,name,notes,fields,reprompt,archivedDate,login_uri,login_username,login_password,login_totp
// (an organization's export has `collections` where `folder` is). Bitwarden writes only logins and secure
// notes to a CSV, and a login's several websites into one cell as a comma-separated list.
import { collector } from "./common.js";
import { parseCsv } from "./csv.js";

export const label = "Bitwarden (CSV)";

/** @param {string[]} headers */
export const matches = (headers) => headers.includes("login_uri") && headers.includes("login_username");

/** @param {{ records: { row: number, get: (name: string) => string }[] }} table */
export function parse({ records }) {
  const c = collector();
  for (const r of records) {
    const tags = r.get("collections").split(",").map((t) => t.trim()).filter(Boolean);
    const common = { title: r.get("name"), folder: r.get("folder"), tags, favorite: r.get("favorite") === "1" };
    const isNote = r.get("type").toLowerCase() === "note";
    if (isNote) c.note(r.row, { ...common, body: r.get("notes") });
    else {
      const [url = "", ...others] = (parseCsv(r.get("login_uri"))[0] ?? []).map((u) => u.trim()).filter(Boolean);
      const more = others.length ? `Other websites: ${others.join(", ")}` : "";
      c.login(r.row, { ...common, url, username: r.get("login_username"), password: r.get("login_password"), totp: r.get("login_totp"), notes: [r.get("notes").trim(), more].filter(Boolean).join("\n") });
    }
    // Custom fields can hold secrets: a secure note of their own, not the login's plain notes.
    const fields = r.get("fields").trim();
    if (fields && !isNote) c.note(r.row, { title: `${common.title || "Item"} (extra fields)`, body: fields });
  }
  return c.result(["Bitwarden's CSV export does not hold cards, identities or SSH keys. Export a .json file to bring those in."]);
}
