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

## Supported versions

Only the latest release is supported. The last full security review, with every fix, is
[SECURITY-AUDIT-2026-09-28.md](SECURITY-AUDIT-2026-09-28.md).
