# Releasing KAPEVault

A release is built from a public tag in the public repository, brewed-ops/kapevault. Day-to-day work
happens in a private repository, but nothing is ever released from it: build attestations
(`gh attestation verify`) only exist for public repositories on a free GitHub account, and a download
that cannot be traced to public source cannot be checked by anyone. The Release workflow
(`.github/workflows/release.yml`) refuses to run anywhere else.

## Cut a Windows release

1. **Prepare** in the private repo: bump `version` in `package.json` and `package-lock.json`, update
   `CHANGELOG.md`, commit, and wait for CI to be green on that commit.
2. **Export** that commit as a clean tree. The export takes the committed files only, leaves out the paths
   in `.publishignore`, and scans for secrets, key files and personal names before anything leaves the
   machine. It stops on any hit.
3. **Publish the source** to the public repo: copy the export onto a clone of `brewed-ops/kapevault` (the
   export replaces the tree, so deleted files disappear too), check `git status` shows only what you
   expect, commit, and push to `main`. Wait for the public repo's CI to be green on that commit.
4. **Tag** that public commit: `git tag v0.1.4` (`v` plus the exact `version`) and `git push origin v0.1.4`.
   The workflow fails in seconds if the tag does not match `package.json` or is not a commit of `main`.
5. **Watch the Release workflow** (Actions > Release). Three jobs run:
   - `build` (read-only): `npm ci`, tests, build, the installer, the **fuse check** (the exe must have the
     fuses from `package.json` `electronFuses`; the job fails otherwise), SignPath signing if on, the
     SHA-256 file.
   - `attest`: signs the build provenance of the installer.
   - `release`: opens a **draft** release with the installer and its `.sha256`. The note names the commit.
6. **Verify the draft before you publish it.** Download both files from the draft and run the two checks
   under [Verify a download](#verify-a-download) exactly as a user would. The fuse check is the `Check
   the fuses in the built exe` step of the `build` job: it must be green in the run log.
7. **Publish** the draft, then put the same SHA-256 on the website's download page
   (https://kapevault.brewedops.cloud). The hash on the release page is only as safe as the GitHub
   account that can edit it; a second copy on a different host is what shows a swap.

You can also run the workflow by hand from a branch (Actions > Release > Run workflow). That builds
and runs the fuse check but makes no release, signs nothing and uses no secret.

## Cut an Android release

The phone app is signed with a key that never leaves the owner's PC, so it is built there, not in
Actions, and GitHub cannot attest it. What ties it to public source is the commit it is built from,
and the hash published next to it.

1. Release the PC app first if the release changes anything in `core/` (phones read what the PC wrote;
   see `mobile/README.md`).
2. The source is already public from the PC release's steps 3 and 4. Tag that public commit
   `android-v0.1.7` (`android-v` plus `version` in `mobile/package.json`; the `android-` prefix keeps it
   from starting the Windows workflow).
3. Build from a **fresh clone of that tag**, never from the private working tree:

   ```
   git clone --branch android-v0.1.7 --depth 1 https://github.com/brewed-ops/kapevault.git
   cd kapevault/mobile
   npm ci
   npm run notices:android
   npm run apk:release
   npm run aab:release
   ```

   The release key and `keystore.properties` are read from outside the repo (`mobile/README.md`, "Release
   APK"). The scripts check the signature, the version and that the build is not debuggable.
4. Write the hashes: `sha256sum KAPEVault-0.1.7.apk > KAPEVault-0.1.7.apk.sha256` (on Windows,
   `Get-FileHash -Algorithm SHA256`).
5. Create a **draft** release on the public repo for the tag, with the APK and its `.sha256` attached, and
   this in the notes: `Built from commit <the 40-character commit of the tag>. Signed with the release
   key below.` The Play bundle (`.aab`) goes to Google Play only; Play re-signs what it delivers, so its
   hash is not published.
6. Publish the draft and add the APK's SHA-256 to the website's download page next to the Windows one.

The APK's SHA-256 is published in three places: the `.sha256` file on the release, the release note, and
the website. The signing certificate is below.

## Signing (SignPath Foundation)

Windows installers are signed through [SignPath Foundation](https://signpath.org), which gives free code
signing to open source projects. The certificate belongs to SignPath, not to this repo; the workflow sends
the unsigned installer to SignPath and gets the signed file back.

Until the project is approved, signing is off and releases are **unsigned**. Windows SmartScreen shows
"Windows protected your PC" with "unknown publisher"; users pick More info, then Run anyway, after
checking the hash below.

After approval, add these in the public repo's settings (Settings > Secrets and variables > Actions):

| Name | Kind | Value |
|---|---|---|
| `SIGNPATH_ORGANIZATION_ID` | variable | the organization id from SignPath. Setting it turns signing on. |
| `SIGNPATH_API_TOKEN` | secret | API token of a SignPath user allowed to submit to the project |
| `SIGNPATH_PROJECT_SLUG` | variable, optional | defaults to `kapevault` |
| `SIGNPATH_SIGNING_POLICY_SLUG` | variable, optional | defaults to `release-signing` |
| `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | variable, optional | empty uses the project's default |

The secret is used only by a tag run, never by a manual run or a pull request. The SignPath artifact
configuration should sign the installer (`KAPEVault Setup *.exe`) and, deep inside it, `KAPEVault.exe` and
the uninstaller, so the installed app is signed too, not only the download. The workflow refuses to release
a "signed" file whose signature is not valid.

## Verify a download

**Windows installer**

- Compare the SHA-256 with the `.sha256` file on the release page, and with the one on the website:

  ```powershell
  Get-FileHash .\KAPEVault.Setup.0.1.4.exe -Algorithm SHA256
  ```

  GitHub may show spaces in the file name as dots. The hash is what has to match.
- Check where it was built (needs the [GitHub CLI](https://cli.github.com)):

  ```
  gh attestation verify .\KAPEVault.Setup.0.1.4.exe --repo brewed-ops/kapevault --signer-workflow brewed-ops/kapevault/.github/workflows/release.yml
  ```

  This proves the file was built by this repository's Release workflow, on a tag of the public source, and
  names the commit. It does not prove the source is harmless: read the source at that commit for that.
- If it is signed, right-click the file > Properties > Digital Signatures, or `Get-AuthenticodeSignature <file>`.

You can rebuild the same commit yourself (`npm ci`, `npm run installer`). Only `dist/version.json` is proven
to come out byte-identical; do not expect the installer file to match, because the NSIS packaging is not
reproducible.

**Android APK**

The APK is built and signed on the owner's PC with the release key, from a fresh clone of the public tag
`android-v<version>`. There is no build attestation for it. To check one:

- The SHA-256 of the APK must match the `.sha256` file on its release and the website. The release note
  names the commit it was built from.
- Its signature:

  ```
  apksigner verify --print-certs KAPEVault-<version>.apk
  ```

  `apksigner` ships with the Android SDK build-tools. The certificate it prints must be this one, on every
  release:

  ```
  CN=Kenneth Villar, O=BrewedOps, C=PH
  SHA-256: 15de6f4829800a27d3565e3a721902321363292788a125e84e1c7cfff8812274
  ```

If either check fails, do not install that APK.
