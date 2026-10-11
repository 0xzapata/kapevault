const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSddl, otherWriters, installFolderWriters, SDDL_SCRIPT } = require("./install-folder.cjs");

const ME = "S-1-5-21-400883919-3398603373-3929718506-1001";
// SAFE and OPEN were captured from real folders with Get-Acl (SAFE: only the user, SYSTEM and
// Administrators; OPEN: the same plus Authenticated Users modify).
const SAFE = `O:${ME}G:${ME}D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;${ME})`;
const OPEN = `O:${ME}G:${ME}D:PAI(A;OICI;0x1301bf;;;AU)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;${ME})`;
// What a folder made straight under a drive root inherits: Authenticated Users modify, Users read.
const ROOT_CHILD = `O:${ME}G:${ME}D:AI(A;OICIID;FA;;;BA)(A;OICIID;FA;;;SY)(A;OICIIOID;FA;;;CO)(A;OICIID;0x1301bf;;;AU)(A;OICIID;0x1200a9;;;BU)`;

test("an SDDL string splits into the owner and its entries", () => {
  const { owner, aces } = parseSddl(OPEN);
  assert.equal(owner, ME);
  assert.deepEqual(aces.map((a) => [a.type, a.sid]), [["A", "AU"], ["A", "SY"], ["A", "BA"], ["A", ME]]);
  assert.equal(aces[0].mask, 0x1301bf);
});

test("two-letter rights read the same as the masks they stand for", () => {
  const { aces } = parseSddl("D:(A;;FA;;;BU)(A;;FR;;;WD)(A;;FW;;;AU)(A;;GRGX;;;IU)(A;;GA;;;LS)");
  assert.deepEqual(aces.map((a) => a.mask), [0x1f01ff, 0x120089, 0x120116, 0x80000000 + 0x20000000, 0x10000000]);
});

test("a folder only the user, SYSTEM and Administrators can write has no other writers", () => {
  assert.deepEqual(otherWriters(SAFE), []);
});

test("Authenticated Users with modify is named as a writer", () => {
  assert.deepEqual(otherWriters(OPEN), ["Authenticated Users"]);
});

test("under a drive root: modify for Authenticated Users counts; read for Users and Creator Owner do not", () => {
  assert.deepEqual(otherWriters(ROOT_CHILD), ["Authenticated Users"]);
});

test("Everyone, Users and a stranger's SID are named when they can write; read, execute and list are fine", () => {
  const sddl = `O:${ME}D:(A;;FA;;;WD)(A;;0x1200a9;;;BU)(A;;0x1301bf;;;S-1-5-21-1-2-3-1500)(A;;FR;;;AU)(A;;0x1200a0;;;IU)`;
  assert.deepEqual(otherWriters(sddl), ["Everyone", "S-1-5-21-1-2-3-1500"]);
  assert.deepEqual(otherWriters(`O:${ME}D:(A;;0x1301bf;;;BU)`), ["Users"]);
});

test("each way in counts: add file, delete child, delete, change permissions, take ownership", () => {
  for (const bit of [0x2, 0x40, 0x10000, 0x40000, 0x80000]) {
    assert.deepEqual(otherWriters(`O:${ME}D:(A;;0x${(0x100000 | bit).toString(16)};;;BU)`), ["Users"], `mask bit 0x${bit.toString(16)}`);
  }
  assert.deepEqual(otherWriters(`O:${ME}D:(A;;0x120089;;;BU)`), []);
});

test("the signed-in user may write in their own install even when Administrators own the folder", () => {
  // Captured from C:\Users\<me>\AppData\Local\Programs: owner BA, the user's own SID with full control.
  const programs = `O:BAG:${ME}D:AI(A;OICIID;0x1200a9;;;S-1-5-21-400883919-3398603373-3929718506-1004)(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;${ME})`;
  assert.deepEqual(otherWriters(programs, ME), []);
  assert.deepEqual(otherWriters(programs, "S-1-5-21-9-9-9-1001"), [ME], "another user signed in: the first user is someone else");
});

test("a deny entry is not a grant, and a trusted SID is never named", () => {
  assert.deepEqual(otherWriters(`O:${ME}D:(D;;FA;;;BU)(A;;FA;;;S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464)`), []);
});

test("the script only reads one folder's SDDL", () => {
  assert.match(SDDL_SCRIPT, /Get-Acl -LiteralPath \$Path/);
  assert.doesNotMatch(SDDL_SCRIPT, /Set-Acl|icacls|Remove-/i);
});

// Started once at startup and read when the Security view asks, so it can never hold up an unlock.
test("a packaged Windows build reads the folder holding its exe, once, and hands the Security view the names", async () => {
  const asked = [];
  const writers = async (folder) => (asked.push(folder), ["Users", "Everyone"]);
  const started = installFolderWriters({ packaged: true, platform: "win32", execPath: "C:\\KAPEVault\\KAPEVault.exe", writers });
  const handlers = {};
  require("./ipc/settings.cjs").register({ handle: (name, fn) => (handlers[name] = fn), installWriters: started });
  assert.deepEqual(await handlers["security:installFolder"](), ["Users", "Everyone"]);
  assert.deepEqual(await handlers["security:installFolder"](), ["Users", "Everyone"]);
  assert.deepEqual(asked, ["C:\\KAPEVault"], "read once, not per ask");
});

test("a dev run, another OS, or a folder that cannot be read raises nothing", async () => {
  const never = async () => assert.fail("must not read the folder");
  assert.deepEqual(await installFolderWriters({ packaged: false, platform: "win32", execPath: "C:\\a\\b.exe", writers: never }), []);
  assert.deepEqual(await installFolderWriters({ packaged: true, platform: "darwin", execPath: "/Applications/KAPEVault", writers: never }), []);
  assert.deepEqual(await installFolderWriters({ packaged: true, platform: "win32", execPath: "C:\\a\\b.exe", writers: async () => null }), []);
  assert.deepEqual(await installFolderWriters({ packaged: true, platform: "win32", execPath: "C:\\a\\b.exe", writers: async () => [] }), []);
});

test("an entry this reader cannot size up is a writer, never 'nobody': conditional, unknown right code, malformed", () => {
  // A conditional (callback) allow entry for Everyone: its condition could be anything.
  assert.deepEqual(otherWriters(`O:${ME}D:(A;OICI;FA;;;SY)(XA;OICI;FA;;;WD;(@User.Title == "x"))`, ME), ["Everyone"]);
  // A conditional entry whose condition holds parentheses of its own is still one entry.
  assert.deepEqual(otherWriters(`O:${ME}D:(XA;;FA;;;BU;((@User.a == 1) && (@User.b == 2)))(A;;FA;;;${ME})`, ME), ["Users"]);
  // A right code outside the table (DC) used to throw and read as an empty list.
  assert.deepEqual(otherWriters(`O:${ME}D:(A;OICI;DC;;;AU)(A;OICI;FA;;;${ME})`, ME), ["Authenticated Users"]);
  // An object entry and an entry with no SID.
  assert.deepEqual(otherWriters(`O:${ME}D:(OA;;CC;bf967a86-0de6-11d0-a285-00aa003049e2;;S-1-5-21-1-2-3-1500)`, ME), ["S-1-5-21-1-2-3-1500"]);
  assert.deepEqual(otherWriters(`O:${ME}D:(A;;FA)`, ME), ["an entry that could not be read"]);
  // A conditional DENY only shrinks the list, like a plain deny.
  assert.deepEqual(otherWriters(`O:${ME}D:(XD;;FA;;;BU;(@User.a == 1))(A;;FA;;;${ME})`, ME), []);
  assert.deepEqual(parseSddl(`D:(XA;;FA;;;WD;(@User.a == 1))`).aces.map((a) => [a.type, a.sid, a.unparsed]), [["XA", "WD", true]]);
});

test("the DACL is found whatever sits before it: alias group, numeric group, no group, flags, an S: section", () => {
  const AUW = [["A", "SY"], ["A", "AU"]];
  const ids = (s) => parseSddl(s).aces.map((a) => [a.type, a.sid]);
  // Real Get-Acl shape: the group alias ends in Y/A right before D:.
  assert.deepEqual(ids("O:BAG:SYD:PAI(A;OICI;FA;;;SY)(A;OICI;0x1301bf;;;AU)"), AUW);
  assert.deepEqual(ids("O:BAG:BAD:PAI(A;OICI;FA;;;SY)(A;OICI;0x1301bf;;;AU)"), AUW);
  assert.deepEqual(ids(`O:${ME}G:${ME}D:PAI(A;OICI;FA;;;SY)(A;OICI;0x1301bf;;;AU)`), AUW);
  assert.deepEqual(ids("O:BAD:(A;;FA;;;SY)(A;;0x1301bf;;;AU)"), AUW);
  assert.deepEqual(ids("D:P(A;;FA;;;SY)(A;;0x1301bf;;;AU)"), AUW);
  assert.deepEqual(ids("O:BAG:SYD:AI(A;;FA;;;SY)(A;;0x1301bf;;;AU)"), AUW);
  assert.deepEqual(ids("O:BAG:SYD:PARAI(A;;FA;;;SY)(A;;0x1301bf;;;AU)"), AUW);
  assert.deepEqual(ids("O:BAG:SYD:PAI(A;;FA;;;SY)(A;;0x1301bf;;;AU)S:AI(AU;SA;FA;;;WD)"), AUW);
  assert.deepEqual(ids("O:BAG:SYD:(A;;FA;;;SY)(A;;0x1301bf;;;AU)S:(ML;;NW;;;LW)"), AUW);
  assert.deepEqual(ids("O:BAG:SYD:PAI(A;;FA;;;SY)(XA;;FA;;;AU;(@User.a == 1))S:AI"), [["A", "SY"], ["XA", "AU"]]);
  assert.equal(parseSddl("O:BAG:SYD:PAI(A;;FA;;;SY)").owner, "BA");
  assert.equal(parseSddl(`O:${ME}G:SYD:PAI`).owner, ME);
  assert.deepEqual(parseSddl("O:BAG:SYD:PAI").aces, [], "an empty DACL lets nobody in");
});

test("real-shaped SDDL names Authenticated Users; a missing or unreadable DACL is never 'nobody'", () => {
  assert.deepEqual(otherWriters("O:BAG:SYD:PAI(A;OICI;FA;;;BA)(A;OICI;FA;;;SY)(A;OICI;0x1301bf;;;AU)"), ["Authenticated Users"]);
  assert.deepEqual(otherWriters("O:BAG:SYD:PAI(A;OICI;FA;;;BA)(A;OICI;FA;;;SY)(A;OICI;0x1301bf;;;AU)S:AI(AU;SA;FA;;;WD)"), ["Authenticated Users"]);
  assert.deepEqual(otherWriters(`O:${ME}G:SYD:PAI(A;OICI;FA;;;BA)(A;OICI;FA;;;SY)`, ME), []);
  assert.equal(parseSddl("O:BAG:SY").aces, null);
  assert.equal(parseSddl("").aces, null);
  assert.equal(parseSddl("O:BAG:SYD:PAI(A;;FA;;;SY)garbage").aces, null);
  assert.equal(parseSddl("O:BAG:SYD:NO_ACCESS_CONTROL").aces, null, "a NULL DACL grants everyone");
  for (const bad of ["O:BAG:SY", "", "nonsense", "O:BAG:SYD:PAI(A;;FA;;;SY)garbage"]) {
    assert.notDeepEqual(otherWriters(bad, ME), [], `unknown must not read as nobody: ${bad}`);
  }
});

test("a folder owned by another account is a writer unless OWNER RIGHTS narrows it; the user's own folder is not", () => {
  const THEM = "S-1-5-21-400883919-3398603373-3929718506-1002";
  const made = `O:${THEM}G:${THEM}D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;${ME})`;
  assert.deepEqual(otherWriters(made, ME), [THEM], "owner is someone else: they can rewrite the permissions");
  assert.deepEqual(otherWriters(`O:${THEM}G:${THEM}D:PAI(A;OICI;0x1200a9;;;OW)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;${ME})`, ME), [], "an OWNER RIGHTS read entry cancels the implicit rights");
  assert.deepEqual(otherWriters(`O:${THEM}D:PAI(A;OICI;FA;;;OW)(A;OICI;FA;;;${ME})`, ME), [THEM], "an OWNER RIGHTS entry that still grants write does not");
  assert.deepEqual(otherWriters(SAFE, ME), [], "owned by the signed-in user");
  assert.deepEqual(otherWriters(`O:BAD:(A;;FA;;;${ME})`, ME), [], "owned by Administrators");
});
