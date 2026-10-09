// Password-manager exports -> KAPEVault import items (the same items a KAPEVault import file holds).
// One small module per source; each is pure: text in, { items, skipped, notes } out. Nothing here reads a
// file - the host does that (electron/import-file.cjs) and then runs the items through core/import.js.
import * as appleCsv from "./apple-csv.js";
import * as bitwardenCsv from "./bitwarden-csv.js";
import * as bitwardenJson from "./bitwarden-json.js";
import * as browserCsv from "./browser-csv.js";
import * as firefoxCsv from "./firefox-csv.js";
import * as keepassCsv from "./keepass-csv.js";
import * as lastpassCsv from "./lastpass-csv.js";
import * as onepasswordCsv from "./onepassword-csv.js";
import { csvTable } from "./csv.js";

export { ImportRefused, lostRows } from "./common.js";

// Most specific header sets first: Chrome's four plain columns are inside several others.
/** @type {[string, { label: string, matches: (headers: string[]) => boolean, parse: (table: any) => any }][]} */
const CSV_SOURCES = [
  ["lastpass", lastpassCsv],
  ["bitwarden-csv", bitwardenCsv],
  ["keepass", keepassCsv],
  ["firefox", firefoxCsv],
  ["1password", onepasswordCsv],
  ["apple", appleCsv],
  ["browser", browserCsv],
];

/**
 * @param {string} text the whole file
 * @returns {null | { source: string, label: string, items: object[], skipped: { row: number, reason: string }[], notes: string[] }}
 * null = not a format we know. Throws ImportRefused for one we know and will not read (an encrypted export).
 */
export function parseExport(text) {
  const body = text.replace(/^﻿/, "");
  if (/^\s*[{[]/.test(body)) {
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      return null;
    }
    return bitwardenJson.matches(json) ? { source: "bitwarden-json", label: bitwardenJson.label, ...bitwardenJson.parse(json) } : null;
  }
  const table = csvTable(body);
  const found = CSV_SOURCES.find(([, source]) => source.matches(table.headers));
  return found ? { source: found[0], label: found[1].label, ...found[1].parse(table) } : null;
}
