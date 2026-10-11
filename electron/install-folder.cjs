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

const ALLOW_TYPES = new Set(["A", "OA", "XA", "ZA"]); // plain, object, conditional (callback), compound

// The top-level "(...)" groups of the D: part, each as its inside text. A conditional entry holds
// parentheses of its own, so groups are found by depth, not by the first ")".
function aceTexts(dacl) {
  const out = [];
  let depth = 0;
  let from = -1;
  for (let i = 0; i < dacl.length; i++) {
    if (dacl[i] === "(" && depth++ === 0) from = i + 1;
    else if (dacl[i] === ")" && depth > 0 && --depth === 0) out.push(dacl.slice(from, i));
  }
  return out;
}

// Walks the sections in order: O:<sid|alias> G:<sid|alias> D:<flags><aces> S:<flags><aces>. An owner or
// group value is a 2-letter alias (BA, SY) or an S-1-... SID, so a "D:" is only a section start where the
// previous section ended - never found by looking for the letters. dacl is null when there is no D:
// section, it is a NULL DACL (NO_ACCESS_CONTROL: everyone has access), or the text does not fit the
// layout: "unknown", which the caller must not read as "nobody".
function splitSddl(sddl) {
  let owner = "";
  let dacl = null;
  let i = 0;
  while (i < sddl.length) {
    const tag = /^([OGDS]):/.exec(sddl.slice(i))?.[1];
    if (!tag) return { owner, dacl: null };
    i += 2;
    if (tag === "S") break; // the audit list follows the DACL and says nothing about who can write
    if (tag === "O" || tag === "G") {
      const value = /^(?:S-[\d-]+|[A-Z]{2})/.exec(sddl.slice(i))?.[0];
      if (!value) return { owner, dacl: null };
      if (tag === "O") owner = value;
      i += value.length;
      continue;
    }
    const flags = /^(?:P|AI|AR)*/.exec(sddl.slice(i))?.[0] ?? "";
    i += flags.length;
    const from = i;
    let depth = 0;
    for (; i < sddl.length; i++) {
      if (sddl[i] === "(") depth++;
      else if (sddl[i] === ")") depth--;
      else if (depth === 0) break;
      if (depth < 0) return { owner, dacl: null };
    }
    if (depth !== 0) return { owner, dacl: null };
    dacl = sddl.slice(from, i);
  }
  return { owner, dacl };
}

/**
 * unparsed: an allow entry this reader cannot size up (a conditional or object entry, a right code
 * outside the table, a malformed entry). otherWriters counts it as a writer - an unreadable entry is
 * never read as "nobody". aces is null when the DACL could not be found or read (see splitSddl).
 * @param {string} sddl @returns {{ owner: string, aces: { type: string, mask: number, sid: string, unparsed: boolean }[] | null }}
 */
function parseSddl(sddl) {
  const { owner, dacl } = splitSddl(sddl.trim());
  if (dacl === null) return { owner, aces: null };
  const aces = aceTexts(dacl).map((text) => {
    const f = text.split(";");
    const type = f[0];
    const sid = (f[5] ?? "").trim();
    if (type === "A" || type === "D") {
      try {
        return { type, mask: maskOf(f[2] ?? ""), sid, unparsed: !sid };
      } catch {
        return { type, mask: CAN_REPLACE, sid, unparsed: true };
      }
    }
    return { type, mask: CAN_REPLACE, sid, unparsed: true };
  });
  return { owner, aces };
}

/**
 * The principals other than the trusted ones that an allow entry lets write. A deny entry is ignored:
 * it can only shrink the list. user: the signed-in user's SID, who may write in their own install.
 */
function otherWriters(sddl, user = "") {
  const { owner, aces } = parseSddl(sddl);
  if (aces === null) return ["an access list that could not be read"];
  // The owner may change the folder's permissions just by owning it, unless an OWNER RIGHTS entry
  // narrows that (the installer adds one). With the signed-in user known, an owner who is neither them
  // nor a trusted account is a writer - a folder another account made ahead of the install.
  const ownerRights = aces.find((a) => ALLOW_TYPES.has(a.type) && (a.sid === "OW" || a.sid === "S-1-3-4"));
  const ownerNarrowed = ownerRights !== undefined && !ownerRights.unparsed && !(ownerRights.mask & CAN_REPLACE);
  const ownerIsTrusted = !user || owner === user || TRUSTED.has(owner);
  const name = (/** @type {string} */ sid) => NAMES[/** @type {keyof typeof NAMES} */ (sid)] ?? (sid || "an entry that could not be read");
  const named = aces
    .filter((a) => ALLOW_TYPES.has(a.type) && (a.unparsed || a.mask & CAN_REPLACE) && !TRUSTED.has(a.sid) && (a.sid !== owner || !ownerIsTrusted) && a.sid !== user)
    .map((a) => name(a.sid));
  if (owner && !ownerIsTrusted && !ownerNarrowed) named.push(name(owner));
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
