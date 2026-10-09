/**
 * Writes dist/legal/THIRD-PARTY-NOTICES.txt: the licence text of every npm package that ships in the
 * desktop app, read from node_modules.
 *
 * Vite strips the licence comments out of the bundle, and the fonts are plain files, so without this the
 * installer carries no MIT notice for React, marked or Phosphor and no SIL OFL text for Geist, which
 * those licences require. electron-builder copies the file next to LICENSE and NOTICE
 * (package.json build.extraResources -> resources/legal/).
 *
 * "Ships" = every package in package-lock.json that is not dev-only (the same set `npm ci --omit=dev`
 * installs): the bundled renderer, the fonts, and jsqr for the main process. Runs as part of `postbuild`.
 * A package with no licence file stops the build, so a new dependency cannot ship without its notice.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));

const shipped = Object.entries(lock.packages)
  .filter(([path, p]) => path.startsWith('node_modules/') && !p.dev && !p.optional && !p.devOptional)
  .sort(([a], [b]) => a.localeCompare(b));

const LICENCE_FILE = /^(licen[sc]e|copying|notice)(\.(md|txt))?$/i;
const sections = [];
for (const [path, p] of shipped) {
  const dir = join(root, path);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => LICENCE_FILE.test(f)).sort() : [];
  if (files.length === 0) {
    console.error(`third-party-notices: ${path} ships in the app but has no licence file. Run npm ci, or add its notice by hand.`);
    process.exit(1);
  }
  const name = path.replace(/^node_modules\//, '');
  const texts = files.map((f) => readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim());
  sections.push(`${name} ${p.version} (${p.license ?? 'see text'})\n${'-'.repeat(72)}\n${texts.join('\n\n')}\n`);
}

const header = `KAPEVault - third-party notices

These packages are part of the desktop app, each under its own licence. KAPEVault's own licence is in
LICENSE and LICENSE-EXCEPTION, and NOTICE lists everything else that ships with it (Electron and Chromium
carry theirs in LICENSE.electron.txt and LICENSES.chromium.html beside KAPEVault.exe).

`;
const outDir = join(root, 'dist', 'legal');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'THIRD-PARTY-NOTICES.txt'), `${header}${sections.join('\n\n')}`);
console.log(`third-party-notices: ${shipped.length} packages -> dist/legal/THIRD-PARTY-NOTICES.txt`);
