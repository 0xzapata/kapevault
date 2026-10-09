// The install folder is where KAPEVault.exe sits, and Windows starts that exe at every login (Start with
// Windows) and the Air Wall firewall rule is keyed to its path. The installer lets the user pick the
// folder, and a folder made straight under a drive root (C:\KAPEVault) inherits "Authenticated Users:
// modify" from the root. Another account on the PC could then swap the exe or plant a DLL beside it and
// capture the master password at the next login: a boundary between users, which the same-user
// threat model does not cover. This reads the folder's ACL and names who else can write.
const path = require("node:path");
const { runPsJson } = require("./system-tools.cjs");
const { psQuote } = require("./air-wall.cjs");

// SDDL right abbreviations (Microsoft: Security Descriptor String Format) -> access mask bits.
const RIGHTS = {
  GA: 0x10000000, GR: 0x80000000, GW: 0x40000000, GX: 0x20000000,
  RC: 0x20000, SD: 0x10000, WD: 0x40000, WO: 0x80000,
  FA: 0x1f01ff, FR: 0x120089, FW: 0x120116, FX: 0x1200a0,
};
// What lets someone replace or add a file in the folder or take it over: add file / write data,
// delete child, delete, change permissions, take ownership, and the generic write / all.
const CAN_REPLACE = 0x2 | 0x40 | 0x10000 | 0x40000 | 0x80000 | 0x40000000 | 0x10000000;

// SIDs that may write: SYSTEM, Administrators, Creator Owner / Owner Rights (the user who made the
// folder), TrustedInstaller. The folder's owner is added per folder (the user, for a per-user install).
const TRUSTED = new Set(["SY", "BA", "CO", "OW", "S-1-5-18", "S-1-5-32-544", "S-1-3-0", "S-1-3-4", "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"]);
// Names for the ones a message is likely to carry; any other SID is shown as it is.
const NAMES = { AU: "Authenticated Users", "S-1-5-11": "Authenticated Users", BU: "Users", "S-1-5-32-545": "Users", WD: "Everyone", "S-1-1-0": "Everyone", IU: "Interactive users", "S-1-5-4": "Interactive users" };

/** @param {string} rights hex ("0x1301bf") or runs of two-letter codes ("FA", "GRGX") */
function maskOf(rights) {
  if (/^0x[0-9a-f]+$/i.test(rights)) return Number(rights);
  let mask = 0;
  for (let i = 0; i < rights.length; i += 2) {
    const bits = RIGHTS[/** @type {keyof typeof RIGHTS} */ (rights.slice(i, i + 2))];
    if (bits === undefined) throw new Error(`Unknown right ${rights.slice(i, i + 2)}`);
    mask += bits;
  }
  return mask;
}

/** @param {string} sddl @returns {{ owner: string, aces: { type: string, mask: number, sid: string }[] }} */
function parseSddl(sddl) {
  const owner = /(?:^|[^A-Z])O:(S-[\d-]+|[A-Z]{2})/.exec(sddl)?.[1] ?? "";
  const aces = [...sddl.matchAll(/\(([AD]);[^;]*;([^;]*);[^;]*;[^;]*;([^)]+)\)/g)].map((m) => ({ type: m[1], mask: maskOf(m[2]), sid: m[3] }));
  return { owner, aces };
}

/**
 * The principals other than the trusted ones that an allow entry lets write. A deny entry is ignored:
 * it can only shrink the list. user: the signed-in user's SID, who may write in their own install.
 */
function otherWriters(sddl, user = "") {
  const { owner, aces } = parseSddl(sddl);
  const named = aces.filter((a) => a.type === "A" && a.mask & CAN_REPLACE && !TRUSTED.has(a.sid) && a.sid !== owner && a.sid !== user).map((a) => NAMES[/** @type {keyof typeof NAMES} */ (a.sid)] ?? a.sid);
  return [...new Set(named)];
}

// Reads one folder's access list (SDDL is language-independent; icacls prints localized names).
const SDDL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "try { @{ status = 'Success'; sddl = (Get-Acl -LiteralPath $Path).Sddl; user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value } | ConvertTo-Json -Compress }",
  "catch { @{ status = 'Error' } | ConvertTo-Json -Compress }",
].join("\n");

/**
 * @param {string} folder the folder holding KAPEVault.exe
 * @returns {Promise<string[] | null>} who else can write there (empty = nobody), or null when it could not be read
 */
async function writersOf(folder) {
  try {
    const result = await runPsJson({ script: `$Path = ${psQuote(folder)}\n${SDDL_SCRIPT}`, timeoutMs: 20_000 });
    return result.status === "Success" && typeof result.sddl === "string" ? otherWriters(result.sddl, result.user) : null;
  } catch {
    return null;
  }
}

/**
 * What the Security view shows: who else can write to the folder this exe runs from. Only a packaged
 * Windows build has an install folder to guard; a folder that cannot be read raises nothing. Started once
 * at startup and read when the page asks, so it never waits on an unlock.
 * @returns {Promise<string[]>}
 */
async function installFolderWriters({ packaged, platform = process.platform, execPath = process.execPath, writers = writersOf }) {
  if (!packaged || platform !== "win32") return [];
  return (await writers(path.win32.dirname(execPath))) ?? [];
}

module.exports = { writersOf, installFolderWriters, otherWriters, parseSddl, SDDL_SCRIPT };
