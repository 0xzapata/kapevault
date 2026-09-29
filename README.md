# KAPEVault

An encrypted password vault for Windows and Android that keeps everything on your own devices.
There is no KAPEVault account and no KAPEVault server.

It stores logins (including Sign in with Google logins), 2FA codes, IDs, secure notes, API keys,
payee numbers, devices, things and links to files and folders, all in one encrypted file.

Website and docs: https://kapevault.brewedops.cloud

## How it protects your vault

- Your master password becomes a key through **scrypt** (N=2^17, r=8, p=1), and **AES-256-GCM** seals the
  whole vault as one file on your device. The master password is never stored.
- Every file is checked before any key is derived: a vault or backup with other scrypt settings is
  refused, so a planted file cannot hang unlock.
- On Windows, the unlocked vault and its key live only in the app's main process; the window only sees
  an item's password when you reveal, copy or edit it. On Android, the vault and its key live in the
  app's page, behind one vault-host module the screens ask for one secret at a time (no separate process).
- On Windows, copied passwords clear from the clipboard after 30 seconds, on lock and on quit, and are
  kept out of clipboard history. On Android, a copy is marked sensitive and cleared within 30-60 seconds
  and on lock.
- It locks itself after 5 minutes without keyboard or mouse use, on sleep and on Windows lock (on the
  phone: 30 seconds after you leave the app by default - at once, 30 seconds or 1 minute in Settings),
  and on both 8 hours after unlock by default.
- Nothing leaves the device except the optional backup: the already encrypted vault file, uploaded to a
  Cloudflare R2 bucket **you** own. No telemetry, no analytics.
- **Air Wall** (Windows) has Windows Firewall block the app from the internet. Encrypted backups still
  reach your bucket.
- The **Forever Opener** is one HTML file that opens your vault in any browser, offline, without KAPEVault.
- An **Emergency Kit** is a printable page with everything needed to recover.

The file format is in [FORMAT.md](FORMAT.md), the backup and phone sync design in [SYNC.md](SYNC.md) (a
premortem; its section 3 is what shipped, code in `core/sync/`), and the most
recent security review (with every fix) in [SECURITY-AUDIT-2026-09-28.md](SECURITY-AUDIT-2026-09-28.md).
To report a security problem, see [SECURITY.md](SECURITY.md).

## Build from source

Requirements: Node (the version in [.nvmrc](.nvmrc)) and npm. The Windows app builds on Windows; the
Android app needs the Android SDK and JDK 21.

```sh
npm install
npm start            # build and open the desktop app
npm run app:dev      # the desktop app with hot reload
npm test             # unit tests (crypto, vault file, sync, rules)
npm run e2e          # drives every screen of the real app window against a throwaway vault
npm run installer    # the Windows installer
```

`npm run e2e` needs Playwright, which is not a dependency: `npm i -D playwright && npx playwright install
chromium`, or set `PLAYWRIGHT_PATH` to a playwright package folder.

The Android app lives in [mobile/](mobile/) with its own `package.json`; see [mobile/README.md](mobile/README.md).

## Layout

| Folder | What it is |
|---|---|
| `core/` | The rules both apps share: the vault format, sync merge, validation, item kinds |
| `electron/` | The desktop app's main process: encryption, the unlocked session, backup, OS features |
| `src/` | The desktop app's window (React), in feature folders under `src/features/` |
| `mobile/` | The Android app (Capacitor): its own UI, the native autofill service, the phone's vault host |
| `scripts/` | Build, test and release scripts |

## Licence

KAPEVault is free software: you can redistribute it and/or modify it under the terms of the
[GNU General Public License, version 3](LICENSE). Copyright (C) 2026 BrewedOps.

Brand logos in `src/assets/logos/` and `mobile/` are trademarks of their owners. They are shown only to
help you recognise your own accounts and are not covered by this licence.
