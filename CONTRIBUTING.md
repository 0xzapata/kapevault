# Contributing to KAPEVault

Thanks for helping. KAPEVault holds people's passwords, so changes are reviewed for safety first and
features second.

## Security problems

Report vulnerabilities privately on GitHub: the repository's **Security** tab, **Report a
vulnerability**. Never in an issue, a pull request or a discussion. See [SECURITY.md](SECURITY.md) and
the threat model in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

## Setup

- Node: the version in [.nvmrc](.nvmrc), with npm. CI uses exactly that version.
- The Windows app builds on Windows. The Android app needs the Android SDK and JDK 21; see
  [mobile/README.md](mobile/README.md).

```sh
npm ci
npm start                  # build and open the desktop app
cd mobile && npm ci        # the Android app has its own package.json and lockfile
```

## Checks

Run these before opening a pull request. CI runs the same on Linux and Windows.

```sh
npm run lint               # Biome, lint rules only
npm run typecheck          # the app, plus the shared JavaScript in core/ and electron/
npm test                   # unit tests: core/, electron/, src/
cd mobile && npm run typecheck && npm test   # the Android app's host, screens and scripts
```

- `lint` is Biome's lint rules only, no formatter, and `biome.jsonc` switches some rules off (each with its
  reason); it is not "every rule passes".
- `typecheck` checks the app with TypeScript `strict`. The shared JavaScript in `core/` and `electron/` is
  checked too (`checkJs`, `strict`), except `noImplicitAny` and `useUnknownInCatchVariables`, which are off
  in `tsconfig.js.json`, and test files are not checked. "0 errors" means exactly that configuration.
- Windows-only tests skip themselves on other systems; CI runs them on a Windows runner.
- `npm run e2e` drives the real app window against a throwaway vault. It needs a desktop session and
  Playwright (see the README); it does not run in CI. Run it for any change to a screen or to IPC.
  KAPEVault hides its windows from screen capture by default, so to watch or record a run set
  `KAPEVAULT_ALLOW_CAPTURE=1` (development builds only; the installed app ignores it). Some checks press
  the real mouse: leave the test windows alone while it runs.
- Android device checks (`npm run proof`, the emulator) are in mobile/README.md.

## Changes

- Keep a change to one thing. Every behaviour change comes with a test next to the module, named as a
  sentence (`test("a planted snapshot cannot hide a device's real ones", ...)`).
- A change to the vault file, sync or the Forever Opener updates [FORMAT.md](FORMAT.md) or
  [SYNC.md](SYNC.md) in the same pull request. Both apps and the Opener must keep opening every file
  KAPEVault has written.
- Do not add a dependency without asking first in an issue. The runtime has very few, on purpose.
- Test data uses made-up names and example values only.
- No telemetry, analytics or network calls beyond the user's own R2 bucket, the Windows app's opt-in
  update check (GitHub's release list) and, on Android, Google Play for KAPEVault Pro.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): a type, an optional scope,
and a subject that says what now happens, in plain words.

```
fix(sync): a planted snapshot cannot hide a device's real ones
feat(pc): import from Bitwarden, 1Password, KeePass, Chrome/Edge/Brave, Firefox, Apple Passwords, LastPass
test(e2e): the Opener walk-through uses a master the strength rule accepts
```

Types: `feat`, `fix`, `test`, `docs`, `build`, `ci`, `chore`. Common scopes: `pc`, `mobile`, `android`,
`core`, `sync`, `electron`, `import`, `e2e`.

## Licence

KAPEVault is licensed under the [GNU General Public License, version 3](LICENSE) (3 only, not "or later"),
with one additional permission under its section 7: the Android app may be combined with Google's Play
Billing and Play services libraries, which are not free software. The permission and the exact libraries
are in [LICENSE-EXCEPTION](LICENSE-EXCEPTION). By sending a contribution you agree that it is licensed
under the GPL with that permission. If you do not agree to the permission, please do not send code.

Contributions to the PC app and to `core/` carry the same terms. The permission is there so Pro can be
sold on Google Play; your code stays under the GPL.
