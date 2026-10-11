# Changelog

All notable changes to KAPEVault. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The Windows app (the root `package.json`) and the Android app (`mobile/package.json`) carry separate
version numbers; each entry names the versions it covers. Versions before the Unreleased section were
built and installed by hand; none was tagged.

## [Unreleased]

### Security

- Android: a bucket that came inside a restored backup file uploads nothing until you turn on Back up
  automatically in Settings > Cloud backup.
- Android: a restore keeps the device removals of the vault it replaces, also when the app locks during
  the download, and never takes them from an unrelated vault.
- Android: Delete older backups after a master password change; turning fingerprint unlock off and
  changing settings refuse while locked; an oversized object in the bucket is never downloaded on restore.
- Android: an unlock that finishes while the app is in the background still locks on leave.

## [Windows 0.1.4] - 2026-10-11

The first release built by the Release workflow from the public repository.

### Added

- Import from other password managers on Windows: Bitwarden (CSV and unencrypted JSON), 1Password (CSV),
  KeePass (CSV), Chrome, Edge and Brave, Firefox, Apple Passwords and LastPass. An encrypted Bitwarden
  export is refused with a message. Settings > Import.
- Trash on Windows and Android: deleting moves an item to the Trash for 30 days, with Undo. Restore,
  Delete now and Empty Trash. A trash and a restore sync between devices.
- Check my Opener (Settings > Backup): compares the Forever Opener in the backup folder with the app's own
  and puts the real one back.
- Removing a device from sync walks through locking it out: change the master password, then replace the
  R2 token. A "Finish locking out" card stays until the master password has changed.
- A warning after a master-password unlock when that master password is easy to guess.
- The Windows lock screen says "No account. No server.", like the phone.
- Release workflow: a tag builds the Windows installer in CI, with build provenance, a SHA-256 file and
  SignPath signing once approved. See RELEASING.md.
- A `.sha256` file beside every APK, AAB and Windows installer, and the signing certificate beside the APKs.
- docs/THREAT-MODEL.md, CONTRIBUTING.md, this changelog, issue and pull request templates.
- The installer carries LICENSE, LICENSE-EXCEPTION, NOTICE and the licence text of every npm package it
  ships (THIRD-PARTY-NOTICES.txt, with the SIL OFL for the fonts) in its resources folder.
- LICENSE-EXCEPTION: a GPL section 7 permission for the Android app's Google Play Billing and Play
  services libraries. README has "Remove KAPEVault completely" and "Updates and security notices".
- Recent passwords in the password generator, on Windows and Android: the last 20 values you copied or used
  from the last 90 days are kept in the encrypted vault, so a lock while an item is open cannot lose a
  password you already pasted into a site. Clear empties the list. It stays on the device that made it,
  and the Forever Opener shows it with every value hidden.
- Open source licences screen: Settings > General on Windows, Settings > About on Android.
- Check for updates (Windows, Settings > General, off by default): once a day it asks GitHub whether a newer
  release is out.
- Security on Windows lists other accounts that can write to the install folder.
- Settings says when this PC's policy blocks Windows Hello.
- An Android build without Google Play code, for F-Droid or a self-build (`npm run apk:release:foss`).
  Pro is not available in it.

### Changed

- SYNC.md is now a plain description of how sync works.
- Electron 44.5.1. The installer build fails unless the built exe's fuses match `package.json`.
- The Windows app loads from `app://kapevault/`; the file:// extra-privileges fuse is off.
- Android release builds use R8 and resource shrinking; Gradle dependency hashes are pinned.
- The master password meter prices common words, not letters.
- Connect (Windows) shows the account and bucket backups will go to before connecting, like the phone.
- CI runs lint, typecheck, `npm audit` on the production tree and gitleaks; actions are pinned by commit
  SHA; Dependabot is on. It also audits the locked Electron version on its own and checks the Android
  dependency hashes by resolving Gradle's release and debug classpaths.
- The release workflow runs only in the public repository, from a tag on main, with one job per
  permission. RELEASING.md covers the Windows and Android releases step by step.
- `dist/version.json` carries the commit time instead of the build time, so two builds of one commit match.
- NOTICE lists the 121 brand logos by source and credits the Nayuki QR Code generator. The Landbank and
  Remitly logos (non-free uploads) and the SSS, PhilHealth, Pag-IBIG and BIR marks (government agencies)
  were removed; those brands show the letter tile.
- `http-cache-semantics` 4.3.0 and `source-map-js` 1.2.2 (the two high `npm audit` advisories).
- A vault, backup or sync snapshot saved by a newer KAPEVault now says so ("saved by a newer KAPEVault.
  Update this app.") on every unlock and restore path, in both apps and in the Forever Opener, instead of
  failing or being repaired. It is not counted as a wrong password.
- Landbank, Remitly, SSS, PhilHealth, Pag-IBIG Fund and BIR stay in the brand list and are still
  recognised by name, with a letter tile instead of a logo.
- Importing skips an item only when it is an exact copy of one already in that client, and keeps the import
  file when any row could not be imported (the page says how many).
- The Trash counts its 30 days from the later of the trash time and its sync stamp, so a device with a
  clock far behind cannot empty the Trash everywhere.

### Removed

- Payee Check: the payee item type and the check of a pasted GCash or bank number against the numbers you
  confirmed by call. Existing payees open as secure notes with every field in the note, on Windows and
  Android (and in backups, sync and import files). The number is part of the note's hidden text now.

### Security

- IPC answers only the app's own page, checked by origin as well as by frame.
- More launch switches that weaken the sandbox, certificate checks or the network lockdown make a
  packaged build exit.
- Every copy on Windows clears from the clipboard after 30 seconds, not only secrets.
- The vault key is wiped when opening the vault fails after the key was derived.
- A snapshot with an unknown master password planted in a device's folder no longer hides that device's
  real snapshots (Windows and Android).
- Delete older backups continues past deletes a bucket lock refuses and says how many are still locked.
- A vault file's encrypted data must be canonical base64, the same verdict the Forever Opener gives.
- A Forever Opener beside a saved copy that is not this version's exact page is replaced, even when it
  claims a newer version.
- Android autofill asks before filling a login saved for another site or app.
- Android autofill remembers an app's signing certificate on the first fill and refuses a changed one.
- The Android fingerprint-wrapped vault key works only while the phone is unlocked.
- Junk device folders in the bucket can no longer stall every sync.
- A `cloud` block that is not an R2 bucket is dropped when a vault is read.
- Linked folders, file opening, temporary files and devtools hardened on Windows.
- Android asks before carrying the phone's items into a bucket that holds another vault.
- No autocorrect, capitalising or autocomplete on Android secret fields and notes.
- Windows: locking replaces every window's renderer process, so revealed passwords leave the page's memory,
  and the buffers the decrypted vault passes through are zeroed.
- Windows: PowerShell helpers read their script from standard input and run with a minimal environment.
  Windows Hello keeps working when its focus helper is blocked, and says so under Constrained Language Mode.
- Android: the vault's WebView is marked data-sensitive (Android 14 and later), the keyboard is asked not to
  learn from it, Capacitor's WebView plugin has no methods, the HTTP plugin reaches Cloudflare R2 only, and
  a saved server path is dropped at start.
- Android autofill no longer treats an empty record of an app's signing certificates as a match.
- Restoring your own vault while another vault is open no longer takes that vault's master password,
  device removals or cloud backup setup, and keeps the replaced copy (security audit run-1).
- Unlock misses are counted per vault file, so unlocking a restored backup no longer resets the wait for
  guesses at the vault it replaced.
- Sync refuses item ids and device names like `toString` or `__proto__` instead of failing every merge.
- A closed account's wiped secrets, and passwords cleared from history, no longer come back in a conflict
  copy. Moves to the Trash count toward the sync review.
- The Forever Opener in the cloud bucket sits at one fixed name the Emergency Kit prints, checked on
  every backup; older pages there are removed.
- Another device holding the vault key can no longer fake a master password change to hide "Finish
  locking out".
- A changed bucket URL or key ID never reuses the saved secret key.
- Settings, Air Wall, Windows Hello turn-off, QR scan, copy and reveal refuse while the vault is locked.
  Connecting cloud backup, deleting older backups, choosing the copy folder and saving a printout stop if
  the vault locked meanwhile. A copy made while the clipboard is being cleared is still cleared later.
- Office files open only when they really are Office files (password-protected ones open their folder
  instead); links inside linked folders and at the
  folder-copy name are refused; an encrypted copy cannot be saved into the vault's own folder.
- A custom install folder is locked by the user's SID, with entries another account added removed.
- The lock-file workflow runs no install scripts and hands its token only to the push step.

### Fixed

- A line break inside a CSV field is stored as LF, whatever the exporting OS wrote.
- Reinstall finds the app where the installer wizard put it.
- Android: every file is saved with a synced, atomic write, so a power cut cannot leave a half-written
  vault.
- An item with a missing title no longer breaks the vault list's sort or search, and one malformed item
  no longer stops the Forever Opener showing the rest.
- A payee or due-to note converted on open no longer undoes a delete made on another device.
- Importing a file with thousands of rows of one title no longer freezes the app; the 5000-item cap is
  checked while reading.
- Android covers the vault the moment you leave the app, and dates and times follow the phone's language.
- Sync no longer downloads a newer device's snapshot again on every run.
- Import brings in Bitwarden SSH keys as key items.

## [Windows 0.1.3, Android 0.1.6 and 0.1.7] - 2026-09-30

### Added

- KAPEVault Pro on Android (Android 0.1.7): a one-time Google Play purchase that unlocks sync with other
  devices and client folders. Without it the phone uploads backup-only snapshots, which every device can
  restore and none merges. Google Play is contacted only once the user opens Pro.
- Windows installer wizard with the GPL licence page and a choice of install folder (Windows 0.1.3).
- Android: a signed App Bundle for Google Play (`npm run aab:release`); Settings > About > Privacy policy.

### Fixed

- Android autofill in compatibility-mode browsers: suggestions came back, the page is named only from the
  request's own fields, and the relayed structure is read as untrusted.
- Android: every vault write goes through one size check; Generate uses the Windows app's generator.

## [Windows 0.1.2] - 2026-09-29

### Added

- Settings > Security > Hide from screen capture (Windows), on by default. The same switch on Android,
  Settings > Screen, shipped in Android 0.1.6.

## [Windows 0.1.1, Android 0.1.5] - 2026-09-29

### Security

- Every Medium and Low finding of SECURITY-AUDIT-2026-09-28.md fixed, among them: the Windows app's
  windows excluded from screen capture; restored and synced vaults cleaned as untrusted data; key-only unlock
  refused when the file header's salt was changed (`keySalt`); a stronger master password rule; planted
  snapshots can no longer push real ones out or be ranked newest; Android autofill matches apps exactly,
  pins browser signing certificates and uses the Public Suffix List. Details and proof in the audit.

## [Android 0.1.0 to 0.1.4] - 2026-09-26 to 2026-09-28

### Added

- The Android app: create or restore a vault, items with 2FA codes, fingerprint unlock (Android Keystore,
  StrongBox when available), a sensitive self-clearing clipboard, `FLAG_SECURE`, camera QR scan for the
  R2 setup code and 2FA keys, R2 backup and restore, sync with the Windows app, and an autofill service.
- Android 0.1.4: the ID item kind; Restore from a file.

## [Windows 0.1.0] - 2026-09-25 to 2026-09-28

### Added

- The Windows app: one encrypted vault file (scrypt, AES-256-GCM) with logins, 2FA codes, secure notes,
  API keys, payees, devices, things, IDs and file links; client folders; Windows Hello unlock; password
  history and the Security view; backup codes and security questions; closing an account on purpose;
  Quick Search; themes.
- Backup: R2 snapshots through the system curl, a copy in a folder, restore from a file or R2, the
  Emergency Kit and the Forever Opener.
- Air Wall: a Windows Firewall rule that keeps the app offline, with a test.
- Sync with the Android app through the user's R2 bucket (SYNC.md).
