# KAPEVault for Android

The phone app. Everything Android lives in this folder, with its own `package.json`, Vite
config and `src/`; it never imports from the PC app's `src/` or `electron/`. The shared vault
rules come from the top-level `core/`, imported through `@core`. Capacitor 8, Android 11+ (minSdk 30).

The app opens on the vault (`index.html`, `src/app`, on the real host). `shell.html` (`src/shell`) is
a small native shell check that `npm run proof` drives by hand; only debug builds carry it
(`vite build --mode debug`, what `npm run sim` and `npm run apk` make). `npm run build` (tsc + Vite)
and `npm run sync` build the vault alone, and the release Gradle build refuses web assets that still
hold `shell.html`.

## Run it on the PC

```
cd mobile
npm install
npm run sim        # emulator window + build + install + open the app
npm run sim:live   # the same, and edits under src/ or index.html show in the app within seconds
```

- `sim` makes a `KAPEVault` emulator the first time (Android 17 QPR2 = API 37.2, Google Play image
  with 16 KB pages, the only form Google ships it in; 6 cores, 4 GB, host GPU; no Android
  Studio clicks needed), boots it as a normal window, or reuses it if it is already running.
  It looks like a Pixel 9 Pro (1280 x 2856, 480 dpi, rounded corners, centred camera hole): the
  device frame is copied once from Android Studio into the SDK's `skins` folder
  (`KAPEVAULT_SKIN_DIR` overrides the source), and the device keys are rewritten before every cold
  boot, so an older KAPEVault emulator takes the new look and keeps its data. The camera hole is
  drawn by the frame only: Android's cutout emulation offers a LEFT hole, not a centred one.
  `npm run sim -- --boot-only` just opens the phone (no build, no install). The window can open
  BEHIND other windows: `powershell -File scripts/emulator-window.ps1 front` brings it forward,
  `... shot` / `... screen` save what it draws / what the monitor shows. `node scripts/webview-probe.mjs
  [--reload]` reads the app page over DevTools (url, text, errors, a screenshot FLAG_SECURE allows). A change of Android
  image wipes the emulator's data on that one boot (the old version's data cannot boot).
  SDK packages: `<your Android SDK folder>\cmdline-tools\latest\bin\android.exe sdk install <path/with/slashes>`
  (the new Android CLI; `sdkmanager` is deprecated and splits `;` paths under cmd). Close the
  emulator before an `emulator` update - its files are locked while it runs.
  Measured on this PC: 34 s from a closed emulator (quick boot) to the app open, 155 s on a full
  cold boot, 19 s when it is already running. A new emulator's first boot takes longer.
- `npm run sim -- --no-window` boots it headless: no window, no audio, and no clipboard sharing
  with Windows. Use it for `npm run proof`.
- `sim:live` serves the page from Vite on this PC (reached through `adb reverse`, never the
  network). Only that one debug install points at the dev server; Ctrl+C stops it, and
  `npm run sim` puts the normal build back. A release build refuses a leftover dev server url.
- Both set the Android SDK and Android Studio's JDK for their own child processes only
  (`scripts/android-env.mjs`). The SDK is `ANDROID_HOME` (or `ANDROID_SDK_ROOT`): your Android SDK
  folder, the one holding `platform-tools` (an `Sdk` folder inside it is found too). `KAPEVAULT_SDK`
  overrides it and must hold `platform-tools` itself (or in its `Sdk` folder), else the script stops
  and names it. The JDK must be 21: `KAPEVAULT_JDK`, else Android Studio's bundled one on Windows when
  it is installed, else `JAVA_HOME`.
- The emulator's back camera is a panorama holding the test QR codes (`-camera-back
  image360:proof/camera-panorama.png`, drawn by `src/app/host/test/qr-poster.mjs` when `sim` starts
  the emulator). What it shows follows the phone's pose: `node scripts/emu-camera.mjs setup|totp|blank`
  turns it to the PC's Add a phone code, the 2FA code, or plain grey. (Emulator 37's virtual room
  draws no posters, so `adb emu virtualscene-image` shows nothing there.) An emulator started
  before this change keeps its old camera: `adb emu kill`, then `npm run sim`. The panorama is drawn
  only when `sim` boots the emulator, so changing a code in `qr-poster.mjs` needs the same restart.

## Fingerprint unlock on the emulator

The emulator has a virtual fingerprint sensor. Once per emulator:

1. Settings > Security & privacy > Device unlock > set a PIN.
2. Same place > Fingerprint Unlock > follow the steps. When it says "Touch the sensor", open the
   emulator's `...` (Extended controls) > Fingerprint > Touch sensor, a few times until
   "Fingerprint added".
3. In the app, tap "Turn on with a test key", then touch the sensor the same way.

`npm run proof` enrolls its own fingerprints under PIN 1111 and removes the PIN when it ends
(which removes the fingerprints too), so a cold boot never lands on a lock screen.

Heads-up: a windowed emulator shares its clipboard with Windows (Extended controls > Settings >
Clipboard sharing, on by default for every emulator on this PC). A copied test secret lands on the
PC clipboard, and it comes straight back into the phone as a new clip without the sensitive flag,
so with the app open the 30 s clear leaves it alone as someone else's. The headless emulator has
no sharing. A real phone has neither problem.

## Prove it

The Kotlin's pure decisions have JVM unit tests (`android/app/src/test`, JUnit 4, no emulator, no
Robolectric): `node scripts/gradle.mjs :app:testDebugUnitTest` runs them for both flavors. They cover
`AppSigners.judge` (first fill recorded, same signers, changed signers refused, a rotation lineage
accepted only when it holds every recorded certificate, several signers with no lineage refused, unreadable
signers counted as changed), `LoginForm.kindOf` (which field is the password or the username) and
`onePage`, `DurableFilePlugin`'s file-name check and atomic replace, and that the two replaced Capacitor
plugins keep their names, the WebView one offers no method and the HTTP one accepts R2 hosts only. What reads the phone itself (`PackageManager`,
`AssistStructure`, the WebView) is proven on the emulator by `npm run proof`.

`npm run proof` (with the KAPEVault emulator running, headless: `npm run sim -- --no-window`)
checks that the app opens on the vault, the manifest and the CSP of both pages, FLAG_SECURE (black
adb screenshot, blank recent-apps card), the background and resume events, the sensitive clip, its
background clear and `clear()`, the fingerprint round trip (including a new fingerprint
invalidating the key), that no key reaches logcat, the WebView scrypt timing, and the camera scan
(`camera`: the permission asked at the scan, denied / closed / leaving the app, the camera view in
the FLAG_SECURE window, and reading a setup code and a 2FA code off the camera panorama), a relaunch
while the app starts (`relaunch`: one WebView left), predictive Back (`back`), and autofill
(`autofill`: the service, the locked suggestion, the FLAG_SECURE vault, a fill into the debug-only
`LoginTestActivity`). The
native checks run on the shell page, so they need a debug build. `npm run proof -- --release` also
builds the release web assets and APK: no shell page and no mock host in `dist/` or the APK, not
debuggable, no DevTools; then it puts the debug web assets back. Pick sections:
`npm run proof -- clipboard keystore`. Output: `proof/` (gitignored), with `failure.png` when a
step throws. About 5 minutes a run.

Measured on this PC's emulator (2026-09-27):

- scrypt N=2^17 r=8 p=1 with the Forever Opener's JS: 591-606 ms warm, 827 ms for the first run
  (913 ms warm while the PC was busy). The check fails at 3 s.
- The clipboard clear: 30 s after the copy while the app's process runs (a main-thread timer; the
  check allows 29-35 s). When Android freezes the app, the scheduled job clears it instead, 33-60 s
  after the copy (the check allows 29-75 s).
- The WebView keeps its own copy of the clipboard and hears of a change only while the app has
  focus, so a clear in the background used to leave the old text pasteable inside the app. On focus
  after such a clear, the app sets and clears an empty sensitive clip so the WebView hears of it.

UI and motion checks in a browser at phone size, on the mock host (no emulator): start
`npx vite --port 5199 --strictPort`, then `node scripts/ui/<check>.cjs proof/ui` (proof/ is gitignored).
They need Playwright, which KAPEVault does not install: set `PLAYWRIGHT_PATH` to a `playwright` package
folder, or `npm i -D playwright` (`scripts/ui/browser.cjs`).
`tabbar-check` (the liquid pill lands, stretches, retargets, reduced motion), `pill-load-check` (the
biggest px/frame step, and compositor frames while the main thread is blocked 600 ms: a composited pill
keeps drawing), `pill-shots` (the pill frozen mid-flight, light and dark: seams, cap shape),
`motion-check` (segmented thumb, sort menu exit, kind switch, theme view transition, page errors),
`backup-list-check` (30 backups: the list scrolls, Use this backup stays on screen), `id-check` (the ID form, its
photo large and the detail, light and dark; `UI_PORT` when another checkout already serves 5199), `restore-file-check`
(Restore from a file from first run and Settings, light and dark: junk refused at the pick, the password
step, and the No backup yet line and row), `pro-check` (KAPEVault Pro, light and dark: backup only without Pro, the
`+` on Clients and the Space field send to the Pro sheet, Buy turns sync on; no Google Play, a pending payment, a
closed Play sheet), `trash-check` (Trash and Undo, light and dark: Move to Trash from the edit sheet,
the toast's Undo, the drawer's Trash count, days left, Restore, a read-only trashed item, Delete now and
Empty Trash; a trashed item is in no list and no search). The mock takes `?mock` plus `firstrun`, `nofingerprint`, `backups=N`, `free` (no Pro yet)
and `store=unavailable|pending|cancel` (what Google Play does on Buy); its master password is `demo`.

## Vault host

`src/app/host/real-host.ts` is the vault host (contract: `src/app/host/types.ts`); the platform is
injected (`native.ts`). Files live in the app's private folder: `vault.kapevault`, `settings.json`
(install id + phone settings), `unlock-throttle.json`, `fingerprint.json` (14-day dates, sealed),
`backup-pending`, `replaced.kapevault`, `pro.json` (KAPEVault Pro, below). Writes go through the
`DurableFile` plugin (`DurableFilePlugin.kt`): the text to `<name>.tmp`, fsync, an atomic rename over the target,
then an fsync of the folder; reads stay with `@capacitor/filesystem` (its `Directory.Data` is the same
`context.filesDir`). Restore from a file (first run's Restore from backup > Use a
file instead, or Settings > Restore from a file) picks a `.kapevault` file through Android's document
picker (Google Drive, Files, a USB drive: the WebView's file input, no plugin), refuses anything that is
not a vault file before any key derivation, and opens it with its own master password. A phone with
its own R2 setup keeps it; otherwise (no R2 on the phone, or locked) the backup's own R2 connection
comes with it. A restore keeps the vault it replaces in that one slot; when
the slot already holds another vault it asks first, and "Replace without a copy" goes ahead, with the
current vault's own master password when locked (the PC's rule). `npm test` runs the host in Node
against the PC's code and a fake R2; `node src/app/host/test/device-proof.mjs` runs it on the
headless emulator, then drives the app itself: unlock, and a fresh install's first run (the PC's
code read off the camera, the restore from the fake R2, the list, a 2FA code scanned into the item
form), with screenshots through the debug WebView in `proof/host/`. The mock host stays under `?mock`
in dev builds only. Sync (`sync.ts`) and the PC's `electron/sync.cjs` both run a sync on `core/sync/run.js`:
after unlock, 3 s after a save, on resume and on Sync now; device names both ways, a master password
changed elsewhere asked for once (through the throttle), restore-everywhere epochs, removal from
sync, and the delete review gate. Host methods for it: `applySync`, `adoptSyncKey`, and `restore`'s
`acceptOlder` (a backup from before a newer master password warns first). `sync.test.mjs` runs the
PC's real session, backup and sync code as the other device; `node src/app/host/test/two-device.mjs`
does the same against the headless emulator (output `proof/two-device/`). `@capacitor/filesystem`'s rename deletes the target first, so `storage.ts` reads each new
file back before the swap and finishes an interrupted swap on the next read.

## KAPEVault Pro

A one-time Google Play purchase (in-app product `pro`) that unlocks two things: syncing this phone with
the other devices, and client folders. Everything else stays free: backup, restore (a PC backup too),
autofill, fingerprint. The Windows app is free. The rule lives in one place, `src/app/host/pro.ts`:

- Without Pro every snapshot goes up as `-backup-only` (`core/sync/snapshots.js`): every device on this
  version or later can restore it (older PC builds do not list it), no device merges it - the PC's own
  sync skips it too. The phone never merges another device's
  snapshot (`sync.ts` `offReason()` "free": Sync now only backs up, the status says `backupOnly`).
- Without Pro no client folder is added and a new item goes to Personal; an item already in a client
  folder stays there and stays editable, and client folders from a restore, "Use the vault from your PC"
  or a sync stay visible and filterable (`real-host.ts` saveEntry / addSpace, the page greys the rest).
- `pro.json` keeps what Google Play last said, so Pro works offline. It is this phone's alone: not in the
  vault, never synced. Play's answer "not owned" (a refund) clears it; no answer keeps it.
- Google Play is contacted only when the user opens the Pro sheet (price and purchase), taps Buy or
  Restore purchase, or once `pro.json` records a purchase or a pending payment (then on start and resume,
  so a refund still lands). A fresh install never binds the Billing service; after a reinstall the owner
  taps Restore purchase. KAPEVault learns only the price and whether Pro is bought or pending: no
  server, no account. Once that billing code has run, Google's Play Billing library may send Google its
  own diagnostic logs (its datatransport job); KAPEVault's own code sends no telemetry, and a free user
  who never opens Pro never runs it.
- Buying Pro sends the vault up again as a normal snapshot at once, so the PC merges it without waiting
  for an edit.
- The `Billing` plugin (`BillingPlugin.kt` in `src/play`, Play Billing Library 9.1.0) makes its client on the first
  call, never at start. The foss flavor has none of this (see Two builds). The library merges `com.android.vending.BILLING`, `ACCESS_NETWORK_STATE` (from its
  `com.google.android.datatransport` dependency), two `<queries>` intents (the Play Store's billing
  service and Google's billing test companion), `ProxyBillingActivity` and `ProxyBillingActivityV2`,
  Play services' `GoogleApiActivity`, and datatransport's `TransportBackendDiscovery`,
  `JobInfoSchedulerService` and `AlarmManagerSchedulerBroadcastReceiver` (Google's log uploader, idle
  until the billing code has run); its tree also brings Play services base/basement/location. While Play's
  purchase sheet is open, `MainActivity.ownDialog` keeps the pause from locking the vault.
- On the emulator (debug builds only): `files/billing-fake` holding `approve` (Buy succeeds), `owned`,
  `pending`, `refuse` (Buy closed) or `unavailable` stands in for Google Play, e.g.
  `adb shell run-as com.brewedops.kapevault sh -c 'echo approve > files/billing-fake'`. A release build is
  not debuggable, so it never reads the file (`npm run proof -- --release` checks that). `ownPro()` in
  `scripts/lib/device.mjs` writes `pro.json` + the fake for the device proofs.
- Only a Play test track (license testers) proves a real purchase, a pending payment, the acknowledge, a
  refund clearing Pro, the website APK buying through Play, and Play's sheet not locking the vault.

## Two builds: play and foss

One source tree, two product flavors (`android/app/build.gradle`):

| | play | foss |
|---|---|---|
| Google Play Billing, `com.google.android.gms`, datatransport | in the APK | none: no `com.android.billingclient` and no `com.google.android.gms` class |
| `BillingPlugin` | `src/play`, the real one | `src/foss`, a stub with no method; the Pro sheet says "Pro is not available in this build of KAPEVault" |
| Extra permissions | `com.android.vending.BILLING`, `ACCESS_NETWORK_STATE` | none |
| For | the Play and website APKs | building it yourself, F-Droid |

- Debug: `node scripts/gradle.mjs assembleDebug` builds both (`android/app/build/outputs/apk/play/debug/app-play-debug.apk`
  and `.../foss/debug/app-foss-debug.apk`); `assemblePlayDebug` or `assembleFossDebug` builds one. `npm run sim` and
  `npm run proof` use the play build.
- Release: `npm run apk:release` is the play APK (`release/KAPEVault-<version>.apk`), `npm run aab:release` the play
  bundle, `npm run apk:release:foss` the foss APK (`release/KAPEVault-<version>-foss.apk`). There is no foss bundle.
- Before a release, `npm run notices:android` resolves both flavors' libraries with Gradle and fails when
  `legal/android-libraries.json` (the Open source licences screen) or `NOTICE` has fallen behind a dependency;
  `node scripts/android-notices.mjs --write` rewrites the list, then review the diff.
- To see what is in a build: unzip its `classes*.dex` and run `dexdump -f` (Android SDK build-tools) on each; the
  foss build lists no `com.android.billingclient` and no `com.google.android.gms` class.

## Release APK

`npm run apk:release` builds the signed APK into `release/KAPEVault-<version>.apk` (gitignored) and
checks it: signed with the release key (APK signature schemes v2 and v3; v3 allows a key rotation
later), not debuggable, no shell page. The key is a keystore outside the repo, by default in
`~/.kapevault-signing/` (the `.jks` + `keystore.properties` with `storeFile` and `keyAlias`; the passwords
are read from `storePassword` / `keyPassword` in that file when it has them, otherwise from the environment
variables `KAPEVAULT_STORE_PASSWORD` and `KAPEVAULT_KEY_PASSWORD`). **Back the key up, offline:** without it
the installed app can never be updated, and uninstalling wipes the phone's vault. The key does not need to
sit on the PC between builds: restore `kapevault-release.jks` to a folder only for a build and run
`pwsh -File scripts/apk-release-prompt.ps1` (add `-Bundle` for the Play `.aab`) from `mobile/`. It asks for
the folder and both passwords (hidden), writes a `keystore.properties` with only `storeFile` and
`keyAlias=kapevault` into that folder, gives the passwords to the build through environment variables of
that one process, and deletes the file and clears the variables when it ends, whatever the result. Then
move the `.jks` offline again. `KAPEVAULT_SIGNING` names another properties file;
`KAPEVAULT_SIGNING=none` builds unsigned (the release proof does this and signs with the debug key
so it installs over the debug build). The script refuses to build without the key rather than ship
a debug-signed APK. Version: `version` in `package.json`; versionCode = major x 10000 + minor x 100 +
patch (minor and patch under 100) - bump it for every release.

`npm run aab:release` builds `release/KAPEVault-<version>.aab`, the file that goes to Google Play, with
the same key and checks. In Play App Signing choose "Use my own key" and upload this release key, so
Play installs and the website's APK can update each other.

Handing an APK over: first run `npm run reinstall` at the repo root, from the same branch. The phone
connects through the PC's Settings > Backup > Add a phone and syncs with the PC's sync code; an
older installed PC app has neither, and the phone's first screen points at a button that is not there.

The brand catalog, matcher and logos are the PC's: `node scripts/sync-shared.mjs` copies them
(`--check` lists drift) and `npm test` fails when they differ. The same script writes `lib/brands.ts`,
`lib/sign-in.ts`, `lib/photo.ts`, `lib/generate-password.ts`,
`lib/issues.ts` and `lib/search.ts` from the PC's `brands.ts`, `sign-in.ts`,
`lib/photo.ts`, the generator, `issues.ts` and `filter-entries.ts` (its search text and sort only; `lib/filter.ts` keeps
the phone's views around them), changing only the imports; edit those on the PC, never on the phone.
Pure rules do not get a copy: `plural`, `daysFromToday` and scrypt live in `core/` and both apps import them.

## Security choices

- Nothing remote: no `server.url`, no `allowNavigation`, a strict CSP in the built page (images: the
  app's own files and `blob:`, for an ID's photo),
  cleartext off (debug builds allow `localhost` only, for `sim:live`).
- No backups: `allowBackup="false"` and data extraction rules that exclude everything, so
  neither Google backup nor a phone-to-phone transfer copies the vault.
- `FLAG_SECURE`: no screenshots, recordings or recent-apps preview, from the first frame. Settings >
  Screen "Hide from screen capture" off clears it (`ScreenCapturePlugin`, applied once the page reads
  settings.json); Android 13+ keeps the recent-apps preview blank anyway (`setRecentsScreenshotEnabled`).
- Capacitor's logging is off: in debug builds it prints every plugin call's arguments to logcat.
- Capacitor's own `WebView` plugin is replaced by one with no methods, and `CapacitorHttp` by `R2OnlyHttpPlugin`
  (`DisabledCorePlugins.kt`; Capacitor registers both whatever the app needs and lets an app plugin of the same
  name win: `Bridge.registerAllPlugins`, `Bridge.registerPlugin`). Without that, script that got into the page could
  write an `index.html` with `@capacitor/filesystem` and call `WebView.setServerBasePath` + `persistServerBasePath`
  so every later launch loads it with every plugin, and `CapacitorHttp` is a native HTTP client the CSP does not
  govern. The phone's own R2 requests need `CapacitorHttp`, so `R2OnlyHttpPlugin` keeps Capacitor's request
  code and refuses any URL that is not https on a host under `.r2.cloudflarestorage.com` (default port, no
  user info; parsed with `java.net.URL`, as Capacitor parses it) before a connection is made. A debuggable
  build also accepts `http://localhost`, for the device tests' fake bucket. `MainActivity` also drops a persisted server path (`CapWebViewSettings`) before the bridge is built, which
  is where `Bridge` reads it, so one planted some other way is not loaded either. `npm run proof` plants one and checks
  the bundled page opens.
- Accessibility services: the vault's WebView is marked `ACCESSIBILITY_DATA_SENSITIVE_YES` (Android 14+), so a
  service that does not declare `isAccessibilityTool` (the kind banking trojans use) gets no nodes or events from it,
  while TalkBack and other tools keep working. Earlier Androids have no such switch.
- Keyboard learning: `VaultWebView` (declared in `res/layout/capacitor_bridge_layout_main.xml`, which replaces
  Capacitor's layout) adds `IME_FLAG_NO_PERSONALIZED_LEARNING` to every field's input connection, so Gboard, SwiftKey
  and Samsung Keyboard are asked not to learn what is typed. A WebView cannot do this per field: it is on for every
  field of the vault, secret or not.
- WebView debugging only in debug builds (Capacitor's default, left alone).
- Permissions: `INTERNET` (R2 backup and sync; Google's billing library log upload once Pro was opened), `USE_BIOMETRIC`, `CAMERA` (the QR scan, asked for when a
  scan starts; a phone without a camera still installs), `HIDE_OVERLAY_WINDOWS` (below), and
  `com.android.vending.BILLING` + `ACCESS_NETWORK_STATE`, merged from the Play Billing library (KAPEVault Pro; the
  play flavor only - the foss manifest has neither).
- Overlays and task hijacking: other apps' floating windows are hidden over the vault and the fill
  screen (Android 12+), and a tap that came through one is dropped (`filterTouchesWhenObscured`, every
  version; an Android 11 screen-dimmer app blocks taps in the vault while it runs). `MainActivity` has an
  empty `taskAffinity`, so no other app's activity can slip into the vault's task.
- Native plugins are ours, in `android/app/src/main/java/com/brewedops/kapevault/`, no
  third-party biometric package:
  - `VaultKeystore` - `isAvailable`, `enable({ key })`, `unlock()`, `disable()`. A Keystore
    AES-256-GCM key that needs a strong biometric on every use and dies when a fingerprint is
    added wraps the 32-byte vault key; it lives in StrongBox (a separate secure chip) on phones that
    have one, else in the normal Keystore. Errors use the desktop codes (`not-enabled`, `canceled`,
    `locked-out`, `changed`, `unsupported`, `failed`). The 14-day master rule is
    `core/master-due.js`; the page's host (`src/app/host/biometric.ts`) applies it and seals the dates.
  - `SecureClipboard` - `copy({ text })` marks the clip sensitive and clears it 30 s later (a timer
    while the process runs; a scheduled job as the fallback when Android has frozen or killed the
    app; whichever runs first cancels the other); `clear()` on lock. Android shows the clipboard only to the app in focus, so a newer clip is
    kept when the app can see it, and cleared when it cannot tell.
  - `QrScanner` - `scan({ purpose: "setup" | "totp" })` reads one QR code: the camera view is laid
    over the app in the same FLAG_SECURE window, and CameraX frames are decoded on the phone by
    ZXing's core library. The scanner uses no ML Kit and no Play services (their barcode artifacts
    carry Google's usage logging; the code scanner downloads a module; Play services reach the app only
    through the Billing library, above), no network, no picture kept. Rejects `canceled`
    (Cancel, Back, leaving the app), `denied`, `unavailable` (no camera), `failed`.
  - Edge to edge (`MainActivity`): the page draws behind the status and navigation bars on every
    WebView version and gets their sizes as `--safe-area-inset-*`; only the keyboard pads the
    window. Capacitor's own SystemBars insets handling is off: below WebView 140 it pads the window
    instead, which shows white strips. The bar icons follow the page theme.
  - Autofill - `KapeAutofillService` offers one locked suggestion, "Fill from KAPEVault", with no
    values in it; tapping it opens `AutofillAuthActivity` (FLAG_SECURE, not exported), which brings
    up the vault to unlock and pick a login (`features/autofill/`). Only the picked username and
    password go into a use-once dataset; the service keeps no secret and logs nothing. It never
    fills KAPEVault itself (the debug-only `LoginTestActivity` is the proof's target). Settings >
    Autofill turns it on through Android. Who gets a "For ..." suggestion (`features/autofill/match.ts`):
    a browser only when its signing certificate matches the pinned one (`TrustedBrowsers.kt`, from
    Google's privileged-apps list), and then by registrable domain from the Public Suffix List (so
    `evil.pages.dev` is not `example.pages.dev`; refresh the list with `node
    scripts/public-suffix-sync.mjs`); any other app only for a login saved as `androidapp://<package>`, and only while its
    signing certificates are the ones it had when KAPEVault first filled it (`AppSigners.kt`: trust on first
    use, SHA-256 hashes of the public certificates in `noBackupFilesDir/autofill-app-signers.json`, never
    backed up or synced; a signer rotation proven by the app's signing lineage is accepted, anything else
    gets no suggestion at all; uninstalling KAPEVault clears the record).
    The page is named from the document the login fields sit in (`LoginForm.kt` reads each field's
    nearest web domain, so a login form in a cross-origin frame names nothing). A browser Android
    reads through its accessibility bridge (compatibility mode, `autofill_service.xml`) names the page
    only on its address bar, so for such a request (`FLAG_COMPATIBILITY_MODE_REQUEST`), when no field
    sits in a document and the screen shows exactly one domain, that is the page. That gives up two
    guarantees there: a cross-origin frame's fields are named by the bar too, and the bar hides the
    scheme, so an https-saved login is offered on a page of unknown scheme (Chrome's "Autofill using
    another service" setting avoids compatibility mode). Everywhere else a login saved for https (or a
    bare address) is offered only on a page known to be https. A pick carries the id of the request the
    picker showed, and `fill()` refuses any other: a newer request in between gets nothing.
    An app's name or package words only fill the picker's search box, and the picker shows the asking
    app's package name.
  - Back (`MainActivity`): Back closes the page's open layer (an item, a sheet, the drawer) and stays
    in the app; at the list it moves the app to the background, still unlocked for the grace period.
    The callback is always on: left to Android, Back on the first screen finishes the activity on
    Android 17 (even from the launcher) and the page with it. The cost is Android's back-to-home
    preview animation. The camera view's own Back sits above it.
  - `Billing` - `status()` and `buy()` for KAPEVault Pro (see KAPEVault Pro above). Rejects
    `unavailable` (no Play Store, not signed in, the product not offered), `canceled`, `failed`. In the foss
    flavor the plugin has no method, so both reject `UNIMPLEMENTED` and the page says Pro is not available.
  - `DurableFile` - `replace({ name, text })` saves a file in the app's folder that a power cut leaves whole
    (see Vault host). `name` is one plain file name.
  - The page gets a `kapevault:background` window event on pause, to lock, and
    `kapevault:resume` on resume, to check the grace period. The fingerprint prompt and the camera
    permission dialog fire neither; leaving the app from that dialog still fires background.
