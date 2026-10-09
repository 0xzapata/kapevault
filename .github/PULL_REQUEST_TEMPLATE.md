## What this changes

<!-- One change per pull request. Say what now happens, in plain words. -->

## Why


## Checks

- [ ] `npm run lint`, `npm run typecheck` and `npm test` pass
- [ ] `cd mobile && npm run typecheck && npm test` pass (if `mobile/` or `core/` changed)
- [ ] `npm run e2e` passes (if a screen or IPC changed)
- [ ] A test covers the new behaviour, next to the module it tests
- [ ] FORMAT.md or SYNC.md updated (if the vault file, sync or the Forever Opener changed)
- [ ] No new dependency (or it was agreed in an issue first)
- [ ] Test data uses made-up names and example values only

## Security impact

<!-- Does this touch the vault file, the key, unlock, IPC, the clipboard, backup, sync, autofill or the
Forever Opener? If so, say what an attacker could do before and after. Security problems themselves are
reported privately (SECURITY.md), not in a pull request. -->

By sending this pull request, I agree that my contribution is licensed under the GPL-3.0.
