// Step of `npm run installer` after electron-builder: reads the fuse wire out of the BUILT
// win-unpacked/KAPEVault.exe and exits 1 unless every fuse in package.json "electronFuses" is set to
// the value written there. Config alone proves nothing - this proves the fuses landed in the exe.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// @electron/fuses is a dependency of electron-builder, not of this package; it is CommonJS.
const require = createRequire(import.meta.url);
const { getCurrentFuseWire, FuseV1Options } = require("@electron/fuses");
// The wire stores bytes: 0x31 is "1" (enabled), 0x30 is "0" (disabled).
const FuseState = { ENABLE: 0x31, DISABLE: 0x30 };

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
const dir = pkg.build.directories.output.replace(/\$\{env\.(\w+)\}/g, (_, name) => process.env[name] ?? "");
const exe = path.join(dir, "win-unpacked", `${pkg.build.productName}.exe`);
if (!fs.existsSync(exe)) {
  console.error(`check-fuses: no built exe at ${exe}`);
  process.exit(1);
}

const wire = await getCurrentFuseWire(exe);
let bad = 0;
for (const [name, want] of Object.entries(pkg.build.electronFuses)) {
  // resetAdHocDarwinSignature is a build option for macOS, not a fuse in the exe.
  if (name === "resetAdHocDarwinSignature") continue;
  const index = FuseV1Options[name.charAt(0).toUpperCase() + name.slice(1)];
  if (index === undefined) {
    console.error(`check-fuses: package.json names an unknown fuse "${name}"`);
    bad++;
    continue;
  }
  const got = wire[index] === FuseState.ENABLE;
  const ok = wire[index] === (want ? FuseState.ENABLE : FuseState.DISABLE);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: want ${want}, exe has ${got}`);
  if (!ok) bad++;
}
if (bad) {
  console.error(`check-fuses: ${bad} fuse(s) do not match package.json in ${exe}`);
  process.exit(1);
}
console.log(`check-fuses: every fuse in ${exe} matches package.json`);
