// Dry-run an import file before handing it over: `npm run import:check -- <file.json>`.
// Reads it with the app's real import gate (import-file.cjs), imports it into a THROWAWAY vault with the
// app's real session code (the exact path Settings > Import takes) and prints counts only - never titles,
// usernames, or passwords. Re-imports it to prove the skip logic, then deletes the throwaway vault. The
// file itself is left untouched.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createVaultSession } = require("../electron/vault-session.cjs");
const { readImportFile } = require("../electron/import-file.cjs");

(async () => {
  const src = process.argv[2];
  if (!src) throw new Error("Usage: npm run import:check -- <path to import .json>");
  const { entries } = readImportFile(src);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-dry-"));
  try {
    const vault = createVaultSession(path.join(dir, "vault.kapevault"));
    await vault.create("dry run master pass");
    const r = vault.importEntries(entries);
    const logins = r.vault.entries.filter((e) => e.kind === "login");
    const oauth = logins.filter((e) => e.signIn !== "password");
    const byType = {};
    for (const e of r.vault.entries.filter((e) => e.kind === "link")) byType[e.linkType] = (byType[e.linkType] || 0) + 1;
    const local = r.vault.entries.filter((e) => e.kind === "link" && (e.linkType === "folder" || e.linkType === "doc"));
    console.log(`added ${r.added}, skipped ${r.skipped}`);
    console.log(`clients: ${r.vault.spaces.filter((s) => s.kind === "client").length}`);
    console.log(`logins ${logins.length} (with password ${logins.filter((e) => e.hasPassword).length}), oauth ${oauth.length} (linked ${oauth.filter((e) => e.viaEntryId).length})`);
    console.log(`links by type: ${JSON.stringify(byType)} | local paths missing: ${local.filter((e) => !fs.existsSync(e.location)).length}`);
    const again = vault.importEntries(entries);
    console.log(`re-import adds ${again.added} (expect 0)`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.log(`IMPORT WOULD FAIL: ${e.message}`);
  process.exit(1);
});
