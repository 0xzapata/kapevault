# KAPEVault security audit - 2026-09-28

> **Historical snapshot.** This is the self-review as it was written on 2026-09-28, kept as it was. The
> line numbers in it pointed into the private development history, which is not published, and the code
> has moved since (for example `electron/main.cjs` was split into `windows.cjs`, `ipc/*.cjs` and others,
> and rules moved into `core/`). So the references below name the file and, where the finding names one,
> the function or symbol, and no longer give a line. Search the current tree for the name. The findings
> are unchanged; whether each one still holds today is answered by the code and its tests, not by this page.

What KAPEVault defends against, and its known limits: [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). A
follow-up self-review ran on 2026-10-04 and found no Critical or High issue.

Scope: PC app (Electron 44, the private `feat/mobile` branch), Android app (`mobile/`, release APK 0.1.4),
and the landing site (a separate repository that is not published here). Method: six area reviewers in parallel (crypto/unlock, Electron IPC/shell,
untrusted input, cloud/exports, Android, site), mechanical scans, headline probes re-run by hand, then one
adversarial reviewer attacking the "held up" list. Probes were kept outside the repo.
References are to the audited code, before electron/main.cjs was split into windows.cjs, ipc/*.cjs and
others, and before more of the shared rules (sync run, R2 signing, vault format, unlock throttle) moved
into core/.
Fixes: see Fix status at the end.

**Verdict: no Critical, no High.** No path found where readable vault data leaves the device without the
user doing it on purpose (a print, a reveal, a copy). What does leak is metadata, screen pixels on the PC,
and file names in Windows' Recent list. The real weaknesses are integrity and robustness: what a hostile
vault file, a person holding only the R2 keys, or a phishing app on the phone can make the app do.

V = verified by a probe or test run. R = reasoned from code.

## Medium

| # | Finding | Where | Scenario | Fix | |
|---|---|---|---|---|---|
| M1 | PC windows are not capture-protected | `electron/main.cjs` (no `setContentProtection` anywhere) | While unlocked, Windows Recall, screen sharing and taskbar / Alt-Tab previews capture revealed passwords, 2FA codes, backup codes, ID photos. The phone has FLAG_SECURE; the PC has nothing. | `win.setContentProtection(true)` on both windows | V (absence) |
| M2 | A restored or synced vault is never re-validated | `vault-session.cjs` (`start`, `commitRestore`), `sync.cjs`, `core/public-view.js` | A backup made by someone else (handed over with its password) or a peer that has the master password can carry: a `photo` of `file://attacker/share/x.jpg` - clicking Show photo sends the Windows NTLM hash (**proved in Electron 44 with the app's exact CSP**: `img-src 'self'` on a `file://` page loads `file://<host>/...` over SMB, no violation); a malformed field (`questions: "boom"`) that makes `publicView` throw on every unlock and then syncs to every device; network-folder links; non-JPEG photos. Import checks all of this; restore and sync check none of it. | One `core.cleanVault(data)` using the import/upsert rules, run in `start()`, on every remote snapshot before merge, and before `commitRestore` writes. `secretOf` refuses a photo that fails `cleanPhoto`. Draw PC photos from `blob:` like the phone. | V |
| M3 | Vault header is not bound to the key | `vault-crypto.cjs`, `vault-session.cjs`, phone `vault-file.ts` | Someone with write access to the vault file edits `kdf.N` or the salt. Windows Hello still unlocks (it uses the key directly), the next save keeps the edited header, and from then on the master password is "wrong" on the vault, every new R2 snapshot, folder copy and the Opener. Once Hello's 14 days run out, the owner is locked out. | Key-based opens require N = 2^17 exactly and the salt sealed into the Hello / Touch ID / fingerprint record (add `salt` + `N` to `SEALED`). Longer term: format v2 with the header as GCM AAD. | V |
| M4 | Master password rule accepts guessable passwords | `core/password-health.js` | Accepted: `Aa1!Aa1!Aa1!`, `password password`, `Dragon!Dragon!1`, `KapeVault2026!`. This rule is the only thing protecting every copy that leaves the device. | Score a repeated block once, match common words anywhere in the string, block the app name. (zxcvbn-ts would be a new dependency - flag first.) | V |
| M5 | Someone with only the R2 keys can wipe the real snapshots and push an old one to the top | `cloud-backup.cjs`; phone `cloud.ts` | Snapshots are ranked and pruned by the time in the object NAME, which the uploader picks. Probe: 20 old snapshots planted under the PC's install id, dated 2099. The restore list's top row became the old vault labelled "this device", and the next normal backup deleted all 20 real snapshots. | Prune only keys listed in `sent-snapshots.json`; rank by `LastModified`; ignore names in the future; the restore confirm shows the snapshot's own `sync.clock` and warns when it is older than the open vault. | V |
| M6 | Android autofill offers logins to look-alike apps | `mobile/src/app/features/autofill/match.ts`; `LoginForm.kt` | A sideloaded `com.phish.paypal` gets your PayPal login as "For ..."; an app labelled "Gmail" gets "Fill Gmail". A sideloaded app named `org.chromium.chrome` is trusted as a browser and can claim to be `accounts.google.com`. There is no public-suffix list, so `evil.pages.dev` counts as the same site as `example.pages.dev` (also `github.io`, `vercel.app`). The user still has to tap, but the picker is telling them it is the right site. | For apps: exact `androidapp://<package>` match plus signing-certificate check; package and installer shown in the picker. Browsers: pin signing certs (`hasSigningCertificate`). Vendor the public-suffix list as data, or match the exact host. | V |
| M7 | Site overclaims (trust copy must stay true) | the landing site's trust copy and landing content (not in this repo) | "Air Wall ... block KAPEVault from going online at all": R2 goes through Windows' curl, outside the rule (by design). "After 5 minutes idle": it is PC-only and OS-wide idle; the phone locks when you leave the app. "Clipboard clears in 30 s, and on quit": the phone clears in 30-60 s and has no "quit". "The bucket only ever holds noise": it also holds the Opener page and dated object names. | Rewrite those four lines (the Privacy page already says the bucket part correctly). | V |

## Low

| # | Finding | Where | Fix | |
|---|---|---|---|---|
| L1 | Throttle reset: at the lock screen with the slot taken, restoring your own backup with its own password resets the miss count, so guesses at the current master never slow down (PC + phone) | `main.cjs`, `restore.cjs`; phone `throttle.ts`, `real-host.ts` | Only a success on the LOCAL vault clears the count | V |
| L2 | Windows file dialogs leave a Recent-files trail: `For <person>.pdf`, `KAPEVault Emergency Kit.pdf`, the plaintext import file's name + path, the USB copy's path | 8 dialogs in `main.cjs` | Add `"dontAddToRecent"` to every dialog's `properties` | V |
| L3 | Clipboard managers (Ditto etc.) keep copied passwords | `main.cjs` | Add `ExcludeClipboardContentFromMonitorProcessing` + `Clipboard Viewer Ignore` to the same `ClipboardItem` | V |
| L4 | PC base64 decoding is lenient: a salt the PC accepts is refused by the phone and the Opener, so a restored file can become one the Opener cannot open until the next save | `vault-crypto.cjs` `b64()` | Strict regex + round-trip check | V |
| L5 | "Open" on a network-folder link calls `fs.statSync` on the UNC path (NTLM) with no click gate; hand-typed folder links accept `C:\`, the home folder and `\\share` (then any text file under 1 MB is readable through `files:readText`) | `vault-session.cjs`, `file-access.cjs`, `core/entries.js` | Refuse `isNetworkPath` in `openTarget`; reuse the import's drive / home / network refusal in `saveEntry` | V |
| L6 | IPC trusts any frame in the window, not only the app page (preview frames show untrusted files). A compromised renderer could also exfiltrate through `openExternal` on a saved link or `cloud:connect` to its own R2 account (curl is outside Air Wall) | `main.cjs`, `r2-client.cjs` | `handle()` requires `event.senderFrame === w.webContents.mainFrame` + the page URL; a native confirm naming the R2 account on connect | V (gap) / R (exploit) |
| L7 | Same issue on the phone: a hostile setup QR points backups at the attacker's bucket (offline guessing against scrypt) | `mobile/src/app/host/r2.ts` | Show account + bucket and confirm before connecting | R |
| L8 | Forever Opener in R2 can be swapped by anyone with the keys; the kit prints only 16 hex of its hash | `cloud-backup.cjs`, `opener.cjs` | Print the full 64-hex hash; make `openerReplaced` a loud warning | R |
| L9 | Phone reads a whole download before checking size (a planted 1-2 GB object crashes every sync); listing stops silently at 50 pages | `r2.ts`, `sync.ts`, `r2-client.cjs`, `r2.ts` | Skip objects whose listed Size > `MAX_VAULT_BYTES` before the GET; error when the page cap is hit | R |
| L10 | `commitRestore` writes the file before `start()` runs, so a malformed backup is written and then cannot unlock (the replaced copy is kept) | `vault-session.cjs` | Validate (M2's `cleanVault`) before the write | V |
| L11 | Deeply nested JSON parses but every save then throws; a large pasted backup-code block freezes the page (8k codes 7 s, 32k codes 95 s) | `vault-session.cjs`; `src/features/recovery/lib/parse-codes.ts` | Depth limit in `cleanVault`; one-pass tally or an 8 KB paste cap | V |
| L12 | Folder copies in Drive / OneDrive / Dropbox keep version history, so after a master password change the older copies still open with the old password (the no-.bak rule, outside the app's reach) | `folder-copy.cjs` | Say so after a password change and in the trust copy | R |
| L13 | `.rtf`, `.svg`, `.xml` open in their default app (SVG/XML in a browser, scripts on) | `file-access.cjs` | Make those three reveal-only | V |
| L14 | A previewed HTML file may resolve DNS through `dns-prefetch` past the dead proxy | preview frame | `host-resolver-rules: MAP * ~NOTFOUND` (dev host excluded) | R |
| L15 | Windows Hello's 14-day rule is enforced only by the app: any script as the same Windows user can get the Hello key to sign, so Windows PIN + a logged-in session opens the vault | `windows-hello.cjs`, `.ps1` | State it on the trust page; a real fix needs package identity (MSIX / Store) | R |
| L16 | Per-user install folder is user-writable: same-user malware can swap the exe or plant a DLL, which sidesteps the fuses. `DEBUG_SWITCHES` also misses `--renderer-cmd-prefix`, `--gpu-launcher`, `--utility-cmd-prefix`, `--browser-subprocess-path` | `package.json` nsis `perMachine: false`, `main.cjs` | Extend the switch list now; per-machine + signed install comes with the Store build | R |
| L17 | Android: `singleTask` with the default task affinity and no overlay protection on API 30 (task hijacking, tapjacking) | `AndroidManifest.xml` | `android:taskAffinity=""`, `filterTouchesWhenObscured`, `setHideOverlayWindows(true)` on 31+ | R |
| L18 | Android: payee numbers and usernames are copied without the sensitive flag and never cleared | `ActionDock.tsx`, `rows.tsx`, `native.ts` | Sensitive flag at least on payee numbers | V (code) |
| L19 | Hand back (secrets ticked) and Kit (keys ticked) PDFs are plaintext files wherever the save dialog points, often a synced Documents folder | `main.cjs` | A warning line at the save step | R |

## Info
- Fuses on the INSTALLED exe read correct (no run-as-node, NODE_OPTIONS, inspect; asar integrity + only-from-asar). Launching it with `--remote-debugging-port` / `-remote-debugging-port` / `--inspect` exits 1 with the port never opening (V).
- gitleaks full history: app 417 commits, 4 hits, all mock test data (AWS's published example key, `0123...` placeholders, `example.com` mock vault); site and film 0 (V).
- osv-scanner: app and site clean; phone has `uuid@7.0.3` (High CVE) only via `@capacitor/cli > xcode`, a dev tool that never ships (V).
- APK signed v2 only (turn on v3 for key rotation); no R8 / minification; leftover Cordova `<access origin="*"/>` in `res/xml/config.xml` (inert); Keystore key not StrongBox-backed.
- Fixed: `VaultWebView` sets `IME_FLAG_NO_PERSONALIZED_LEARNING` on every field. (Was: the phone keyboard, Gboard, may learn a secure note or a revealed secret.)
- Courier `.body` temp files (ciphertext) survive a hard kill; sweep `kapevault-courier-*` on start.
- `system32()` falls back to the env `SystemRoot` if the kernel link cannot be read; should fail closed.
- Tests have left about 6,978 `kapevault-*` folders in `%TEMP%` (mock data only).
- Site: no hosting headers yet, downloads are `#download` placeholders, no published SHA-256 for the installer / APK / Opener, `.env` tracked (holds only the public site URL). Launch blockers, not vulnerabilities today. Recommended headers (inline `style=` in the prerendered HTML needs `'unsafe-inline'` for styles; check in `vite preview` first): `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; media-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Cross-Origin-Opener-Policy: same-origin`.

## Held up under attack (the adversarial pass tried to break each)
1. Only ciphertext leaves: 13 captured requests, planted marker strings (titles, passwords, held-for name, device name, R2 secret, master) in none of them; no `x-amz-meta`; object names are install id + UTC time only. (V)
2. Every password check (6 on PC, 5 on phone) goes through the throttle; calls queue one at a time. (V) - see L1 for the reset.
3. `checkVaultFile` refuses every non-standard KDF on all three readers; `p=2^20` refused in 1 ms. (V) - see L4 for base64 parity.
4. Locked = no linked folders, so `kapevault-file://` and `files:*` refuse; `checkPath` refuses `..`, junctions, ADS, `\\?\`, `\\.\`, UNC, `CON`, encoded separators. (V)
5. `publicEntry` never sends a secret field to the page for any kind; the only IPCs returning secrets are the documented reveal/copy ones. (V)
6. Replace without a copy while locked needs the current master password; one restore at a time. (V)
7. Clipboard cleared at 30 s / lock / quit, only if still ours; phone clips marked sensitive. (V) - see L3.
8. Forever Opener masks unknown fields, `textContent` only, no network. (V)
9. Android release: `allowBackup=false`, FLAG_SECURE before first frame, not debuggable, `LoginTestActivity` absent, only launcher + autofill (permission-protected) exported, fingerprint key BIOMETRIC_STRONG + invalidated on new enrollment, no localStorage / Preferences secrets, no logcat logging. (V)
10. Fresh random IV per save (10,000 / 10,000 unique), new salt on master change, 16-byte tag pinned, no timing oracle (wrong password vs tampered file both ~370 ms). (V)
11. HTML previews: `sandbox=""`, Run scripts adds `allow-scripts` only, never `allow-same-origin`; no `dangerouslySetInnerHTML` anywhere. (V)
12. Chromium profile (12 e2e profiles, 731 files scanned): no mock secret in Local Storage, Cache, blob storage or code cache; spellcheck off on every secret input; window title and tray tip name nothing. (V)
13. Outbound network at the audited commit: R2 via curl by full path (`courier.cjs`, spawn, `--proto =https`), host check `r2-client.cjs`; `shell.openExternal` http/https only `main.cjs`; Air Wall test `air-wall.cjs` on click only (`main.cjs`); dead proxy `main.cjs`; `net.fetch` file:// only `main.cjs`. No fetch / XHR / WebSocket / `http.request` / `dns` / crashReporter / autoUpdater in `electron/` or `src/`. (V)

## Fix status (2026-09-29)

Every Medium and Low was fixed except where noted. Proof: PC `npm test` 620 pass / 1 skip, phone
`npm test` 67/67, all 14 e2e suites 828/828 in one run, `kit:fit` 1123/1123, Kotlin compiles,
gitleaks 0 on the fix commits, semgrep 0 in shipped code (7 hits, all test/proof scripts), and probes
run in the real app or in Electron 44. Three review passes on the fix diff (a short repeated review loop): pass 1
found a Blocker (B1) and a data-loss trap (R-M1), pass 2 an old screen-blanking crash its comment
claimed was handled; all fixed, pass 2 scored 4/5.

| Finding | Fix | Proof |
|---|---|---|
| M1 screen capture | `setContentProtection` on both windows (`lockDown`); design shots opt out unpacked | Real-screen capture of the running app shows the window behind it, not KAPEVault |
| M2 hostile vault | `core/clean-vault.js` inside `decryptWithKey` (PC + phone): wrong-typed fields, non-JPEG photos, bad ids dropped, nesting > 24 refused; page `file://host` requests cancelled | Hostile-restore test red on old code; `file://127.0.0.1/C$` image refused in Electron |
| M3 header not bound | `keySalt` in the encrypted data; key-only unlock refused on a different header salt; N must be 2^17 | Session + phone tests (edited salt: refused, nothing written, biometric stays on) |
| M4 master rule | Repeats, inner common words, app name, CamelCase | All 4 audit passwords refused; real passphrases still Strong |
| M5 planted snapshots | Prune/"this device" only for keys in `sent-snapshots.json` (PC + phone); future names never newest; list by LastModified | Reviewer's probe as a test: red on old code, green now |
| M6 autofill | Exact `androidapp://`, pinned browser certs, Public Suffix List, package shown | 10 match tests incl. the 3 probes; emulator proof 68/69 (one scrypt timing flake) |
| M7 site overclaims | Air Wall, auto-lock, clipboard, bucket, llms.txt reworded; Hello + folder-versions limits added | Site build + page checks, CSP proof on 5 routes (site repo 632d3d6..a4de981) |
| L1 throttle reset | `local: false` for backups, kept copies, snapshots (PC restore.cjs included after B1) | restore.test.cjs + phone sync test |
| L2 Recent files | `dontAddToRecent` on all 8 dialogs | Code |
| L3 clipboard managers | Two more opt-out formats | Code |
| L4 base64 parity | Canonical base64 on PC, phone and Opener | Header parity test |
| L5 folder links / UNC | No drive/home/device-path/admin-share links; network link opens in Explorer without a stat | Session test |
| L6 IPC frames | `handle()` requires the window's main frame | e2e green |
| L7 hostile setup QR | Phone confirms account + bucket before connecting | device-proof step |
| L8 opener hash | Whole SHA-256 on the kit; louder Settings line | kit test + `kit:fit` 1123/1123 |
| L9 listing / size | Page cap throws; oversized objects never picked (PC + phone) | r2-client + snapshots tests |
| L10, L11 | Validation before write; depth limit | cleanVault tests |
| L12, L15, L19 | Trust sheet + site statements; printout warnings | Copy |
| L13 | `.rtf` `.svg` `.xml` reveal-only | file-access test |
| L14 DNS | `host-resolver-rules MAP * ~NOTFOUND` | e2e green |
| L16 switches | 4 more launcher switches exit | Code (per-machine signed install: comes with the Store build) |
| L17 tapjacking | `taskAffinity=""`, hidden overlays (12+), obscured touches refused with a toast | Kotlin compiles; proof checks; toast not yet seen on a device |
| L18 phone clipboard | Every copy on the sensitive, self-clearing clipboard | Code |
| Info | Courier temp sweep, v3 signing, StrongBox (with ProviderException fallback), `system32` never from env | Tests / compile |

**Review of the fixes, found and fixed:** B1 restore.cjs still reset the throttle; R-M1 cleanVault dropped
a newer version's enum values (would sync as deletions); folder rule bypass via `\\?\`; phone restore
without keySalt; phone master-required code; a before-restore upload race; main's own `net.fetch`
blocked (would have broken network-folder previews - proved, then exempted); StrongBox fallback.
Pass 2/3: an unknown device or link type blanked the vault screen (icon lookups), an older device
reset a newer signIn/linkType or refused a newer grab/type on edit, hand back could print
"constructor", the grab list left out an unknown grab - all fixed.

**Left open on purpose:**
- Per-machine, signed Windows install (same-user malware can swap the exe) - comes with the Microsoft Store (MSIX) build.
- App-signer pinning for `androidapp://` logins - needs a new login field; exact package matching already stops look-alike apps.
- Phone keyboard personalised learning - needs a custom WebView. Fixed since: `VaultWebView` sets `IME_FLAG_NO_PERSONALIZED_LEARNING` on every field.
- A native confirm before `cloud:connect` - a compromised page still has `openExternal`, so it would not close the channel; the fix is keeping the page uncompromised (frame check, CSP, file:// block).
- Published SHA-256 for the installer, APK and Opener on the site - when downloads go live.

**Still to check on real hardware:** the overlay toast on an Android 11 phone, Windows Hello after the
update (asks for the master password once, then works), and a network-folder preview on a NAS.
