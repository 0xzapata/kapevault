const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// electron-builder runs customInstall inside the install section, after the files are written
// (node_modules/app-builder-lib/templates/nsis/installSection.nsh). It cannot be run here: the
// installer is verified on a packaged install (see the report of the "custom install folder" fix).
const nsh = fs.readFileSync(path.join(__dirname, "..", "build", "installer.nsh"), "utf8");
const install = (/!macro customInstall([\s\S]*?)!macroend/.exec(nsh) ?? [])[1] ?? "";

test("a custom install folder is locked: no inherited rights, only the user, SYSTEM and Administrators write", () => {
  assert.ok(install, "installer.nsh has a customInstall macro");
  assert.match(install, /\$SYSDIR\\icacls\.exe/, "full path to icacls");
  assert.match(install, /\/inheritance:r/);
  assert.match(install, /\/grant:r/);
  assert.match(install, /\*S-1-5-18:\(OI\)\(CI\)F/, "SYSTEM by SID");
  assert.match(install, /\*S-1-5-32-544:\(OI\)\(CI\)F/, "Administrators by SID");
  assert.match(install, /\*S-1-5-32-545:\(OI\)\(CI\)RX/, "Users read and execute by SID");
  assert.match(install, /USERDOMAIN/);
  assert.match(install, /USERNAME/);
  assert.match(install, /:\(OI\)\(CI\)F"/, "the installing user gets full control");
  assert.doesNotMatch(install, /Authenticated Users|BUILTIN\\|Everyone/i, "no group is named in a language-bound way");
});

test("the default per-user folder is left alone, and so is a drive root", () => {
  assert.match(install, /\$LOCALAPPDATA\\/);
  assert.match(install, /\$INSTDIR/);
  assert.match(install, /> 3/, "a drive root (D:\\) is never locked");
});
