# Security policy

KAPEVault holds people's passwords, so security reports get priority over everything else.

## Reporting a problem

Please do not open a public issue for a security problem. Report it privately on GitHub: the repository's
**Security** tab, **Report a vulnerability**. Include:

- what you found and where (file and line, or the steps in the app),
- what an attacker could do with it,
- the app and its version (Windows: Settings > Apps > Installed apps > KAPEVault; Android: Settings >
  Apps > KAPEVault) and your OS.

You will get a reply within 7 days. Once a fix ships, you are credited in the release notes unless you
would rather not be.

## In scope

- Anything that could reveal vault contents, the master password or a derived key.
- Ways to open, change or replace a vault without the master password.
- The backup and sync path (what is uploaded, what is trusted when it comes back).
- The Android autofill service filling the wrong app or site.
- The Forever Opener and the Emergency Kit.

## Out of scope

- An attacker who already controls the unlocked device while the vault is open.
- Weak master passwords (the app refuses them when you create or change one).
- Problems in your own Cloudflare R2 account settings.

## Scope notes

- What KAPEVault defends against and its known limits are in the threat model,
  [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). A limit listed there is known; a report that shows it is
  worse than stated is welcome.
- `npm audit` without `--omit=dev` still prints moderate advisories, all in build tooling that never ships
  in the app:
  - root: `sprintf-js` (GHSA-hp3w-g68c-fv3c, no patched version exists) and the chain that pulls it in,
    `roarr`, `global-agent`, `@electron/get`, `app-builder-lib`, `electron-builder`. npm's only offer is a
    forced downgrade to electron-builder 26.5.0, which is older than the pinned release tooling, so it is
    not taken.
  - `mobile/`: `uuid` (GHSA-w5hq-g745-h8pq) through `xcode` and `@capacitor/cli`. The only offer is a
    forced downgrade of `@capacitor/cli`.

  The high advisories that a plain `npm audit fix` can fix are fixed (`http-cache-semantics`, `source-map-js`).
  CI fails on any high advisory in the production tree of both packages (`npm audit --omit=dev
  --audit-level=high`). Electron itself is a dev dependency, so that command does not see it; a separate CI
  step (`scripts/audit-electron.mjs`) audits the exact locked Electron version, Chromium and Node included,
  and fails on a high one.
- KAPEVault Pro on Android is an honour-system gate: the app checks it, there is no server, and the source
  is GPL. Building or patching the app to unlock Pro is not a vulnerability.

## Supported versions

Only the latest release is supported.

The Windows app can tell you when a release is out: turn on Settings > General > Check for updates (off by
default; once a day it asks GitHub for the newest release). The Android app does not check. A security fix
is announced through the repository: a **GitHub Security Advisory** for anything that matters, and a new
entry on the **Releases** page. Watch the repository (Watch > Custom > Releases and Security alerts) to be
told, or look at those two pages and at https://kapevault.brewedops.cloud now and then. Updating over an
installed copy keeps your vault.

The last full security review, a historical snapshot with every fix, is
[SECURITY-AUDIT-2026-09-28.md](SECURITY-AUDIT-2026-09-28.md).
