/**
 * Fails when the Electron version the app ships has a known high or critical advisory.
 *
 * `electron` is a devDependency (electron-builder wants it there), so CI's
 * `npm audit --omit=dev` never looks at it, and Electron is the runtime that ships:
 * Chromium and Node included. This audits it on its own: a scratch project outside the
 * repo that depends on exactly the version package-lock.json pins, then `npm audit`.
 *
 * `node scripts/audit-electron.mjs [version]` - the optional version overrides the
 * locked one, to prove the gate fails on an old Electron.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const version = process.argv[2] ?? lock.packages?.['node_modules/electron']?.version;
if (!version) {
  console.error('audit-electron: electron is not in package-lock.json');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'kapevault-audit-electron-'));
// npm is npm.cmd on Windows, which only runs through a shell. The command lines are fixed literals.
const npm = (command) => spawnSync(command, { cwd: dir, stdio: 'inherit', shell: true });

try {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'audit-electron', version: '0.0.0', private: true, dependencies: { electron: version } }),
  );
  console.log(`audit-electron: electron@${version}`);
  // --ignore-scripts: electron's postinstall would download the binary. The audit needs only the tree.
  const install = npm('npm install --package-lock-only --ignore-scripts --no-fund');
  process.exitCode = install.status === 0 ? (npm('npm audit --audit-level=high').status ?? 1) : (install.status ?? 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
