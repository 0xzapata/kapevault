// The Import gate: the one way a plain-text import file is read, and the way it is removed after a
// successful import (it holds passwords in plain text). Used by Settings > Import (ipc/vault.cjs).
// It reads KAPEVault's own import file and the exports of other password managers (core/importers).
const fs = require("node:fs");
const path = require("node:path");
const { parseExport, ImportRefused, lostRows } = require("../core/importers/index.js");

const IMPORT_FORMATS = ["kapevault-import", "bovault-import"]; // bovault-import = files made before the rename
const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const NOT_AN_IMPORT = "KAPEVault cannot read that file. Use a KAPEVault import file or a .csv / .json export from Bitwarden, 1Password, KeePass, Chrome, Edge, Brave, Firefox, Apple Passwords or LastPass.";

// Reads and checks an import file: a real file under IMPORT_MAX_BYTES (a leading BOM from Notepad is
// dropped), either a KAPEVault import file (format kapevault-import or bovault-import, version 1) or an
// export core/importers knows. Returns { file, entries, source, label, skipped, notes }: file is the REAL
// path - a symlink would otherwise be deleted and its target kept; skipped lists the rows that could not
// become items. An export we know and refuse (an encrypted one) throws its own message; anything else
// throws NOT_AN_IMPORT, whatever went wrong.
function readImportFile(picked) {
  let file;
  let text;
  try {
    file = fs.realpathSync(picked);
    const info = fs.statSync(file);
    if (!info.isFile() || info.size > IMPORT_MAX_BYTES) throw new Error("not a file");
    text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch {
    throw new Error(NOT_AN_IMPORT);
  }
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not JSON: it may be a CSV export
  }
  if (IMPORT_FORMATS.includes(parsed?.format)) {
    if (parsed.version !== 1) throw new Error(NOT_AN_IMPORT);
    return { file, entries: parsed.entries, source: "kapevault", label: "KAPEVault", skipped: [], notes: [] };
  }
  let found;
  try {
    found = parseExport(text);
  } catch (e) {
    throw e instanceof ImportRefused ? e : new Error(NOT_AN_IMPORT);
  }
  if (!found) throw new Error(NOT_AN_IMPORT);
  return { file, entries: found.items, source: found.source, label: found.label, skipped: found.skipped, notes: found.notes };
}

// The rows that could not be imported, counted by reason: [{ reason, count }]. Row numbers and titles
// never go to the page.
function summarizeSkipped(skipped) {
  const counts = new Map();
  for (const { reason } of skipped) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts].map(([reason, count]) => ({ reason, count }));
}

// The whole import after the file is picked: read it, add it in one all-or-nothing write, then delete it.
// The file holds every password in plain text, but it is also the only copy of any row that did not
// come in, so it is deleted only when every row was added or was an exact copy of an item already in
// the vault. `kept` counts the rows that were not (the file stays); `unreadable` says why.
// Returns { ok: false, error } or { ok: true, added, skipped, kept, deleted, vault, name, source, notes, unreadable }.
function importPicked(filePath, vault) {
  let picked;
  try {
    picked = readImportFile(filePath);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const unreadable = summarizeSkipped(picked.skipped);
  if (picked.entries.length === 0 && unreadable.length) {
    return { ok: false, error: `Nothing in that file could be imported: ${unreadable.map((s) => `${s.count} x ${s.reason.toLowerCase()}`).join(", ")}.` };
  }
  let result;
  try {
    result = vault.importEntries(picked.entries);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const kept = lostRows(picked.skipped).length;
  // The import is saved either way; a failed delete (file open in an editor) is reported, not fatal.
  const deleted = kept === 0 && shredFile(picked.file);
  return { ok: true, added: result.added, skipped: result.skipped, kept, deleted, vault: result.vault, name: path.basename(picked.file), source: picked.label, notes: picked.notes, unreadable };
}

// Zeros go over the file first, flushed, then it is deleted. That is not a secure erase: an SSD, a
// synced folder or an editor's backup can keep the old bytes, which is why the page says only
// "deleted". Returns false when it could not be done (the file open in an editor); never throws.
function shredFile(file) {
  try {
    const fd = fs.openSync(file, "r+");
    try {
      const { size } = fs.fstatSync(fd);
      fs.writeSync(fd, Buffer.alloc(size), 0, size, 0);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.rmSync(file);
    return true;
  } catch {
    return false;
  }
}

module.exports = { readImportFile, importPicked, shredFile, summarizeSkipped, IMPORT_MAX_BYTES, NOT_AN_IMPORT };
