# KAPEVault threat model

What KAPEVault protects, from whom, and where that protection stops. Every claim names the code that
backs it. The file format is in [FORMAT.md](../FORMAT.md), sync in [SYNC.md](../SYNC.md), how to report a
problem in [SECURITY.md](../SECURITY.md). The last self-review with every fix is
[SECURITY-AUDIT-2026-09-28.md](../SECURITY-AUDIT-2026-09-28.md).

KAPEVault has no server and no account. Everything below is about the user's own devices, the user's
own Cloudflare R2 bucket and the files the user saves.

## Assets

| Asset | Where it lives |
|---|---|
| Master password | Typed at unlock, create, change and restore. Never stored. Held as a JS string while it is used. |
| Vault key (32 bytes, scrypt output) | In memory while unlocked: the Electron main process on Windows/macOS, the app's WebView page on Android. Wrapped by Windows Hello, Touch ID or the Android Keystore when quick unlock is on. |
| Vault contents | `vault.kapevault`, one AES-256-GCM ciphertext. Decrypted only in memory. |
| R2 credentials | Inside the encrypted vault (`cloud`), per device. The phone setup QR and, if ticked, the Emergency Kit carry them too. |
| Backups | Snapshots in the R2 bucket, an optional copy in a folder the user picks, copies the user saves. All are the same encrypted file. |
| The Forever Opener | `KAPEVault Opener.html`, beside saved copies and in the bucket. Not secret, but it is where a recovering user types the master password. |
| Integrity of what the vault says | A recovery code, an admin URL. A changed value can be as harmful as a leaked one. |

Visible without the master password: the file header (format, version, scrypt settings, salt, IV,
tag), the file size, and in R2 the object names (an install id and a UTC time per snapshot), sizes,
upload times and how many snapshots each device has.

## Trust boundaries

1. **Window page to main process (PC).** The React page never holds the vault or the key. It asks the
   main process over IPC for one secret at a time (reveal, copy, edit). `electron/main.cjs` `handle()`
   answers only the main frame of a KAPEVault window whose URL is the app's own origin
   (`app://kapevault`); a preview frame showing an untrusted file gets nothing.
2. **App to other processes as the same OS user.** Not a boundary KAPEVault can hold. See "Malware on an
   unlocked PC".
3. **Device to R2 bucket.** Only ciphertext and the Opener page go up. What comes back is untrusted: every
   file is header-checked before any key derivation (`core/vault-format.js` `checkVaultFile`) and the
   decrypted JSON is cleaned (`core/clean-vault.js`). The Windows app's one other outbound call, the
   opt-in update check, is a GET to api.github.com through the same courier; its answer is untrusted
   JSON of which only a version tag and a link on this project's releases page are used
   (`electron/updates.cjs`).
4. **Device to a linked or copy folder.** Anyone who can write the folder can replace files there.
5. **Android: the vault page to other apps.** Autofill decides which app or site gets a login.
6. **Files the user opens in KAPEVault.** Import files, backups from someone else, previewed files in a
   linked folder. All untrusted.

## Adversaries

### Someone with a copy of the vault file

A stolen laptop disk, a leaked cloud folder, a downloaded snapshot. They can run an offline guessing
attack against the master password, and nothing else.

- Key: `scrypt(NFC(master), salt, N=2^17, r=8, p=1)` to 32 bytes, about 128 MiB of memory per guess
  (`electron/vault-crypto.cjs` `deriveKey`; phone `mobile/src/app/host/scrypt.ts`).
- Cipher: AES-256-GCM over the whole vault JSON, a random 12-byte IV on every save, the 16-byte tag
  length pinned on decrypt (`vault-crypto.cjs` `decryptWithKey`). A wrong password and an altered
  file both fail the tag check.
- Before any key derivation, the header must be exactly what KAPEVault writes: known format, version 1,
  scrypt with N, r, p pinned, canonical base64 salt/iv/tag/data of the right sizes (`checkVaultFile`).
  A planted file with p = 2^20 cannot make unlock run for hours. The Forever Opener applies the same
  rule (`electron/opener/opener-crypto.cjs` `checkOpenerFile`); `electron/opener.test.cjs` holds the two
  to the same verdicts.
- The header is not covered by the GCM tag. Every header field that matters feeds the key (salt, N,
  r, p), so an edited header fails the tag on a password unlock. A key-only unlock (Windows Hello,
  Touch ID, fingerprint) does not derive from the header, so the vault stores the last salt a password
  proved (`keySalt`, `core/key-salt.js`) and refuses a key-only unlock when the header salt differs.
- The master password rule: at least 12 characters and a Strong score (an estimated 60 bits) on the
  app's own estimator, which prices common words, repeats and patterns (`core/password-health.js`). It
  is a heuristic, not zxcvbn. It applies when a master password is created or changed.

What scrypt cannot do: make a weak master password safe. The unlock throttle (`core/unlock-throttle.js`)
slows guesses at the running app only; it is no defence against a copied file.

### Malware or another process on an unlocked PC

Out of scope. Code running as the same Windows or macOS user while the vault is unlocked can read the
main process's memory, inject into it, read the screen through the OS, or log keystrokes. KAPEVault does
not claim to stop it. What still helps against weaker or accidental exposure:

- **Screen capture:** windows are excluded from capture by default (`setContentProtection`,
  `electron/windows.cjs`; Settings can turn it off). Screen sharing, Recall and taskbar previews see
  nothing.
- **Clipboard:** every copy clears after 30 seconds, on lock and on quit, but only if the clipboard still
  holds KAPEVault's value. Every copy is marked to stay out of Windows clipboard history, cloud
  clipboard and clipboard managers that honour the opt-out formats (`electron/clipboard.cjs`).
- **IPC:** only the app's own page may call (`handle()` in `electron/main.cjs`). The page sandbox is on,
  `contextIsolation` on, `nodeIntegration` off; the preload exposes a fixed list of named calls
  (`electron/preload.cjs`).
- **Launch switches:** a packaged build exits if started with a debugging switch (`--inspect`,
  `--remote-debugging-port` and others) or one that weakens the sandbox, site isolation, certificate
  checks or the network lockdown (`electron/hardening.cjs` `refuseDebugging`).
- **Electron fuses:** run-as-node, `NODE_OPTIONS`, the inspect arguments and file:// extra privileges
  are off; asar integrity and load-only-from-asar are on (`package.json` `build.electronFuses`).
  `scripts/check-fuses.mjs` fails the installer build if the built exe's fuses do not match.
- **Locking:** after 5 minutes without input, on sleep, on Windows lock, and 8 hours after unlock by
  default.
- **Memory after lock:** when the vault locks, every window's renderer process is replaced
  (`electron/renderer-recycle.cjs`), so revealed passwords leave the page's memory. The key buffer and
  the decrypted vault's buffers are zeroed (`electron/vault-crypto.cjs`). The main process keeps
  JavaScript strings it cannot zero (the master password typed to unlock and entry passwords it handed
  to the page) until it exits, and a memory dump of it can still find them. `scripts/memory-canary.mjs`
  measures what a process dump finds after a lock.

The installer is per-user, into a folder the user can write. Same-user malware can replace the exe and
sidestep the fuses. A signed per-machine install would close that; it is not done. For the case of an
install folder under a drive root, where other Windows accounts inherit write access, Security lists
those accounts (`electron/install-folder.cjs`).

### Someone with write access to the backup folder

A shared Drive or OneDrive folder, or an account takeover of it. They cannot read the vault copy. They
can:

- **Replace the Forever Opener with a page that sends the master password away.** This is the one place a
  folder writer can phish the master password. KAPEVault's answer is to trust the page by its bytes only:
  every time KAPEVault writes a copy, an Opener that carries KAPEVault's marker but is not this
  version's exact bytes is replaced, whatever version it claims (`electron/opener.cjs`
  `writeOpenerBeside`). Settings > Backup > Check my Opener compares the folder's page with the app's own
  and puts the real one back. Any other file by that name (no Opener marker, or a link) is renamed aside
  with `.txt` added, so no browser runs it, and the real page takes the name; only a folder of that name
  is left alone. The Emergency Kit prints the real page's full SHA-256. The gap
  that remains: a user who opens a planted page from the folder before KAPEVault next writes or checks
  it, and does not compare the hash.
- **Replace the vault copy with an older one or a different vault.** Opening it needs that file's own
  master password. A restore is checked like any other file, keeps the vault it replaces, and a restored
  vault from another lineage never merges silently with sync (SYNC.md 3.7).
- **Edit the vault header.** Covered above (`keySalt`).

### The R2 bucket owner, or anyone holding an R2 token

They cannot read the vault: only ciphertext goes up, and object names hold an install id and a time,
nothing else. They can run the offline guessing attack on any snapshot, as with a stolen file. They can
also delete, withhold, overwrite and replay objects. Detected and not detected:

| Action | What happens |
|---|---|
| Plant a snapshot with an unknown salt in a known device's folder | Passed over: that device's next snapshot that opens is merged. The prompt for "the master password set on <device>" still appears (`electron/sync.cjs` `download`, `mobile/src/app/host/sync.ts`). |
| Plant many device folders | At most 8 unknown devices are read per run (`MAX_NEWCOMERS`, `core/sync/snapshots.js`); objects larger than a vault can be are never downloaded. |
| Name a snapshot in the future (2099) | The name does not decide which snapshot is newest: R2's `LastModified` does. Pruning leaves names more than a day ahead out of its count, so they cannot push real snapshots out. |
| Plant snapshots under this device's own id | Pruning and "this device" only cover keys this install uploaded (`sent-snapshots.json`). |
| Replace the Opener in the bucket | Read back once per bucket per run, compared byte for byte and put back (`electron/cloud-backup.cjs`). |
| Point a setup QR at their own bucket | Before connecting, the PC and the phone both show the account and bucket backups will go to. |
| Delete snapshots | Not prevented by the app. A 30-day bucket lock rule on `kapevault/snapshots/` does prevent it (SYNC.md, Protect the bucket). The folder copy is the offline fallback. |
| Write a snapshot as a device that holds the vault key | Merged. The mass-change gate asks before a merge that deletes more than 5 items (or more than 10% when that is 3 or more), changes secrets on more than 20 items, replaces the vault with a restored one, or moves to another master password (`core/sync/review.js`). The gate judges one merge at a time. It is a guard against bugs and mistakes, not against a key holder, who can stay under it on every sync. |
| Re-upload an old valid snapshot, or delete the newer ones | Not detected. Sync is unaffected (an older state merges as a subset), but a restore on a device with no newer state restores the old vault. There is no rollback counter yet. |

### A lost or stolen phone or PC

- **Locked device:** the vault file is the stolen-file case. The fingerprint-wrapped key on Android is a
  Keystore AES-256-GCM key that needs a strong biometric on every use, is invalidated when a fingerprint
  is added, is unusable while the phone is locked, and prefers StrongBox
  (`VaultKeystorePlugin.kt` in `mobile/android/app/src/main/java/com/brewedops/kapevault/`). The prompt accepts `BIOMETRIC_STRONG` only; the phone's
  PIN alone does not unlock the vault. Windows Hello's wrapped key needs that PC's TPM-backed Hello key
  (`electron/windows-hello.cjs`). Quick unlock asks for the master password every 14 days, with the
  dates sealed under a key derived from the vault key (`electron/biometric-record.cjs`).
- **Unlocked device:** the thief has the vault until it locks (phone: 30 seconds after leaving the app by
  default; PC: idle, sleep or Windows lock; both: 8 hours). A device that was synced also holds the vault
  key and the R2 token.
- **Locking a lost device out:** on the PC, Sync sheet > Remove from sync stops merging that device's
  folder. It is not a lock-out on its own: a device that holds the key and the token can write under a
  new install id. The Sync sheet then walks through the two steps that do lock it out, and keeps a
  "Finish locking out" card until the first is done (`src/features/sync/components/LockOutCard.tsx`):
  1. Change the master password. The vault is re-encrypted under a new salt and key. The old key opens
     nothing written after that, and snapshots written under the old key are not merged.
  2. Replace the R2 API token in Cloudflare, then Disconnect and Connect with the new one. The vault
     cannot see this step, so the card only states it.
  The phone has no remove-device screen; changing the master password on the phone does step 1.

### A phishing app on Android

An app that asks the autofill service for a login it should not get.

- **Browsers** are trusted only when their signing certificate matches a pinned one
  (`TrustedBrowsers.kt`). The page is then matched by registrable domain from the Public Suffix List, so
  `evil.pages.dev` is not `example.pages.dev` (`mobile/src/app/features/autofill/match.ts`).
- **Other apps** get a suggestion only for a login saved as `androidapp://<package>`, and only while
  their signing certificates are the ones seen on the first fill (`AppSigners.kt`).
- **Filling a login saved for another site or app** asks first ("Fill anyway"), naming both
  (`FillPicker.tsx`). One tap never fills a mismatched login.
- The service keeps no secret; the picked login goes into a use-once dataset; the fill screen is
  `FLAG_SECURE` and not exported; a pick carries the request id and an older request gets nothing.
- **Accessibility services:** the vault's WebView is marked `ACCESSIBILITY_DATA_SENSITIVE_YES` on
  Android 14 and later, so a service that does not declare itself an accessibility tool gets no nodes or
  events from it, while TalkBack and other tools keep working. Android 11 to 13 have no such flag, so
  there an enabled accessibility service can still read the screen (`MainActivity.kt`).
- **Keyboards:** `VaultWebView` asks the keyboard not to learn from any field of the vault
  (`IME_FLAG_NO_PERSONALIZED_LEARNING`). A keyboard may ignore the request, and it covers every field,
  secret or not.
- **Capacitor's core plugins:** the `WebView` plugin is replaced by one with no methods and a persisted
  server path is dropped at start, so script in the page cannot make a later launch load a page it wrote.
  `CapacitorHttp` stays because the phone's R2 traffic uses it, but `R2OnlyHttpPlugin` refuses any URL
  that is not https on a host under `.r2.cloudflarestorage.com`, so injected script cannot use it to
  reach another server (`DisabledCorePlugins.kt`).
- **Caveat, compatibility mode:** a browser that Android reads through its accessibility bridge names the
  page only by its address bar, which hides the scheme. There, an https-saved login can be offered on
  an http page of the same domain, and a cross-origin frame is named by the bar. Chrome's "Autofill
  using another service" setting avoids compatibility mode. Details in `mobile/README.md`.

### A malicious import file, backup or previewed file

- **Import (PC):** up to 5 MB and 5,000 items; KAPEVault's own format or a known export (Bitwarden,
  1Password, KeePass, Chrome/Edge/Brave, Firefox, Apple Passwords, LastPass). Every item is checked
  before anything changes, and one bad item stops the whole import: field types, kinds, dates, 2FA URIs,
  photos (JPEG data URLs only), and folder links (network paths, whole drives and the home folder are
  refused) (`electron/import-file.cjs`, `core/import.js`). An encrypted Bitwarden export is refused with a
  message.
  The file is overwritten with zeros and deleted after a successful import; on an SSD or a synced folder
  that is not a secure erase, and the app says only "deleted".
- **A vault or backup from someone else:** header-checked, then the decrypted JSON is treated as
  untrusted: wrong-typed fields and non-JPEG photos dropped, bad or repeated ids dropped, nesting deeper
  than 24 refused, a `cloud` block that is not an R2 bucket dropped (`core/clean-vault.js`).
- **Previews:** scripts off by default; "Run scripts" is a per-file click into an opaque-origin sandboxed
  frame (`allow-scripts` only) whose CSP allows no network request, frame or form (`PREVIEW_CSP` in
  `electron/hardening.cjs`). The page cannot fetch `file://` URLs, so a planted path cannot send the
  Windows NTLM hash.

## Cryptography choices

### Why scrypt and not Argon2id

Argon2id is the usual first choice today. KAPEVault uses scrypt with N = 2^17, r = 8, p = 1, which
OWASP's Password Storage Cheat Sheet lists as an acceptable minimum, for one practical reason: the
Forever Opener.

The Opener is one HTML file that must open a vault in any browser, offline, with no dependencies and a
CSP that pins its one script by hash and allows no request (`electron/opener.cjs`). WebCrypto offers
PBKDF2-HMAC-SHA256 and AES-GCM, but neither scrypt nor Argon2. scrypt is PBKDF2 plus a small Salsa20/8
mixing function (RFC 7914), so the Opener carries a short plain-JavaScript scrypt that tests check
against Node's `crypto.scrypt` (`electron/opener/opener-crypto.cjs`, `electron/opener.test.cjs`). The
phone reuses the same implementation (`mobile/src/app/host/scrypt.ts`, measured at 533-656 ms per unlock
in the emulator's WebView). The PC uses Node's built-in `crypto.scrypt`. No reader needs a third-party
KDF package.

Argon2id would mean a new dependency in all three readers, and a fast Argon2id in a browser usually
means WebAssembly, which the Opener's CSP would then have to allow (`'wasm-unsafe-eval'`). That trade was
not worth it for version 1.

### KDF upgrade plan

Not built yet. Today the settings are stored per file (`kdf` in the header) but every reader accepts
exactly one setting: the PC and phone (`checkVaultFile`) and the Opener (`checkOpenerFile`). Pinning is
deliberate: the settings come from the file, so accepting any value would let a planted file choose its
own cost.

The plan:

1. Replace the single setting with an explicit allowed list. Each entry is still an exact match
   (`{ name, N, r, p }`), so a file can only name a setting KAPEVault ships.
2. New files are written with the newest entry.
3. On the next unlock that derives the key from the master password, a vault under an older entry is
   re-encrypted under the newest one (a new salt and key, as a master password change does). Other
   devices adopt the new salt through the key history sync already carries (SYNC.md 3.6).
4. The Opener's list changes in the same release. Openers saved beside older copies keep opening those
   copies; an older reader refuses a file with a setting it does not know, which is the safe failure.

### One long-lived key, no data-key split

The scrypt output is the AES key for every save on every device. There is no random data key wrapped by
a password key. Windows Hello, Touch ID and the Android Keystore wrap this same key, and the seal over
the 14-day dates uses a key derived from it with HKDF.

Consequences:

- Changing the master password re-encrypts the whole vault under a new salt and key, every other device
  must adopt it (it asks for the new master password once), and quick unlock is turned off and must be
  turned on again.
- Snapshots and copies made before the change still open with the old password until they are deleted
  (Settings > Delete older backups; a cloud folder's own version history is outside the app's reach).
- Random 96-bit IVs under one key are well inside safe limits at the number of saves a vault sees.

A data-key/key-encryption-key split would make a password change a rewrap only. It is not planned for
format version 1.

## Known limitations

- **KAPEVault Pro is an honour-system gate.** On Android, sync and client folders need a one-time Google
  Play purchase. The check is client-side (`mobile/src/app/host/pro.ts`, a local `pro.json`), there is no
  server to verify it, and the source is GPL-3.0, so anyone can build the app with Pro unlocked. That is
  acceptable and intended; it is not a vulnerability.
- **The phone setup QR hands over the PC's own R2 token.** Settings > Backup > Add a phone encodes the PC's
  saved access key and secret (`electron/cloud-backup.cjs` `setupCode`), so both devices share one
  token, and revoking it cuts both. Advised: create a second token for the phone in Cloudflare, scoped
  to this one bucket with Object Read & Write, and type it on the phone instead of scanning. R2 tokens
  cannot be limited to a folder, so any token can still write every device's snapshots.
- **Android 11 and 12 ignore the sensitive-clipboard flag** (it exists from Android 13). There a copied
  password shows in the clipboard preview and is readable by the keyboard until it clears (30 seconds,
  or up to about 60 when Android has frozen the app).
- **Windows Hello trusts any process of the same Windows user.** The Hello key has a fixed name; any
  same-user process can ask Hello to sign the stored challenge. With the Windows PIN and a logged-in session, the vault opens until the 14-day master
  password check. A real fix needs package identity (an MSIX or Store build).
- **Touch ID is a UI gate.** The key sits in an Electron `safeStorage` (Keychain) item that is not bound
  to biometrics; code running as the app can decrypt it without a finger (`electron/touch-id.cjs`).
- **The Windows installer is unsigned** until SignPath Foundation signing is approved. Check the
  SHA-256 and the build provenance ([RELEASING.md](../RELEASING.md)).
- **The Mac build is ad-hoc signed, not notarized, and not verified on a Mac.** It is built only on a
  GitHub runner (`.github/workflows/mac.yml`).
- **No rollback detection.** See the R2 table above.
- **Secrets in JS strings.** The master password and decrypted entries live as ordinary strings in the
  main process (PC) or the WebView (phone) while unlocked; strings cannot be wiped. Key buffers and the
  decrypted vault's buffers are zeroed. On the PC the windows' renderers are replaced on lock; the main
  process's strings stay until it exits.
- **Unlocked means trusted.** Reveal, copy and print do not ask for the master password again.
- **Plaintext PDFs on request.** Hand back with secrets and the Emergency Kit with keys write a plaintext
  PDF where the user saves it.
- **No third-party audit.** The reviews so far are self-reviews: SECURITY-AUDIT-2026-09-28.md and a
  follow-up on 2026-10-04 with no Critical or High findings.
