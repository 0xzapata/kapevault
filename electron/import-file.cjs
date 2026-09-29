// The Import gate: the one way a plain-text import file is read, and the way it is removed after a
// successful import (it holds passwords in plain text). Used by Settings > Import (ipc/vault.cjs).
const fs = require("node:fs");

const IMPORT_FORMATS = ["kapevault-import", "bovault-import"]; // bovault-import = files made before the rename
const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const NOT_AN_IMPORT = "That file is not a KAPEVault import file.";

// Reads and checks an import file: a real file under IMPORT_MAX_BYTES, JSON (a leading BOM from
// Notepad is dropped), format kapevault-import (or bovault-import) version 1. Returns { file, entries }:
// file is the REAL path - a symlink would otherwise be deleted and its target kept. Anything else
// throws NOT_AN_IMPORT, whatever went wrong.
function readImportFile(picked) {
  let file;
  let parsed;
  try {
    file = fs.realpathSync(picked);
    const info = fs.statSync(file);
    if (!info.isFile() || info.size > IMPORT_MAX_BYTES) throw new Error("not a file");
    parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(NOT_AN_IMPORT);
  }
  if (!IMPORT_FORMATS.includes(parsed?.format) || parsed.version !== 1) throw new Error(NOT_AN_IMPORT);
  return { file, entries: parsed.entries };
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

module.exports = { readImportFile, shredFile, IMPORT_MAX_BYTES, NOT_AN_IMPORT };
