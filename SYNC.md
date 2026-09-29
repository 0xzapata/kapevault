# Premortem - KAPEVault PC <-> phone sync design

Written before sync was built, as a premortem: it assumes sync already failed and works back to why. It reviewed FORMAT.md, `electron/vault-session.cjs`, `electron/cloud-backup.cjs`, `electron/r2-client.cjs`, `electron/due-to-note.cjs`, `electron/opener/opener-page.js`.

"Task N" and "success criterion N" refer to the steps of the original build plan (task 1 = the on-disk data shape, task 7 = the first real-phone install). Section 3 is what shipped (code in core/sync/).

**The plan as written:** every entry and space gets `rev: { at: wall-clock ms, by: installId }`; deletes become tombstones `{ id, deleted: true, rev }` inside `entries`, dropped after 180 days once every known device has synced past them; a `devices: [{ id, name, lastSyncAt }]` list is added. Sync runs on unlock, after a save and on "Sync now": list the other devices' newest R2 snapshot, download, "decrypt with the master password", merge per item (newer `rev` wins; a login's losing password goes to history; other kinds get a "conflict copy"), save, upload. No server.

**Intake gaps (they are causes of death too):** no timeline or milestone dates for tasks 0-8; nobody named for the two-real-device test (task 7 says an emulator + fake R2, and a real phone only at "install the APK"); success criterion 1 ("nothing a user typed is ever silently dropped") has no measurement, so nobody can tell it failed.

---

## 1. Autopsy - it is March 2027, sync is off on both devices and the owner no longer trusts the vault

Ranked by likelihood x damage.

### 1. Item-level "newer rev wins" drops data and spawns conflict-copy storms
- **What killed it:** the merge could not tell "the phone edited after seeing the PC's edit" from "both edited at once", so it either made conflict copies on ordinary edits or silently threw away half of a real conflict.
- **How it unfolded:** Week 1: PC sets `lifecycle: deletion-requested` on a login (`setLifecycle`), the phone changes the same login's password before syncing. Phone's rev is newer, the phone's whole item wins, its old password goes to history - and the PC's lifecycle, TOTP or security answers typed that day vanish, because the plan only preserves a login's *password*. Week 2: a note is edited on the PC, synced, then edited again on the phone; revs differ, so the rule "other kinds get a conflict copy" fires on a plain sequential edit. Both devices resolve the same conflict in the same minute with `crypto.randomUUID()` copies, so there are two copies; next sync each device sees the other's copy as new; copies of copies follow. Month 2: 40 "(conflict copy)" items, the owner deletes them by hand, deleting one real item with them.
- **Assumption that allowed it:** a single timestamp per item carries enough history to merge. It carries no causality. And `upsert()` rebuilds the whole entry from the form on every save, so "the item" is the wrong unit: a password change, a code marked used (`markRecoveryCode`), a lifecycle change and a favorite toggle are separate user acts that land on one rev.
- **First warning sign:** the first conflict copy created in a week where the owner never edited the same item on both devices. It shows in the item list, nowhere else - there is no sync log.

### 2. Bookkeeping writes turn sync into an upload loop that eats the backups
- **What killed it:** writes that are not user edits bumped revs and uploaded snapshots, and each device's sync triggered the other's.
- **How it unfolded:** Day 1: `touch()` (every copy/open) writes `lastUsedAt` with `persist({ backup: false })`. Task 1 says "`rev` on every write", so copying a password on the phone makes the phone's version of that login "newer" than a real edit made on the PC an hour earlier - the PC edit loses. Day 2: sync saves `devices[].lastSyncAt`; that save is "a save", which the plan says triggers sync; the upload changes the phone's newest snapshot; the phone's unlock sync writes its own `lastSyncAt` and uploads. Each device's retention (`KEEP_RECENT = 20` in `cloud-backup.cjs`) fills with near-identical snapshots within a day, and the per-day history that restores rely on is pushed out of the newest-20 window faster than planned. Month 1: the 16 MB photo budget means the phone uploads tens of MB a day on mobile data.
- **Assumption that allowed it:** every write is a user change, and a merge always changes something.
- **First warning sign:** snapshot count per install id per day in R2 (the list call Settings already makes) above ~20 on a day the owner made two edits.

### 3. Wall-clock revs and client-named snapshots let one wrong clock freeze sync
- **What killed it:** the phone's clock was wrong for a while, and two separate parts of the design trusted it.
- **How it unfolded:** Month 1: the phone boots with no network after a battery drain and sits at 2030-01-01 for an hour (or the owner changes the date to cheat a game). Every edit in that hour gets `rev.at` in 2030 and wins every future conflict, forever - later PC edits of those items lose silently to stale values. Worse, `snapshotKey()` names the object from `new Date()` on the uploading device, and "the other device's newest snapshot" is chosen by that name (`snapshotTime`). The 2030-named snapshots stay "newest" for that install id for years, so the PC keeps merging a snapshot frozen at that hour and never sees the phone's later edits. The PC shows "Synced with Pixel 8" the whole time. Retention does not help: `snapshotsToPrune` keeps the top 20 by name, and a future `at` always passes `now - at < KEEP_DAYS`.
- **Assumption that allowed it:** device clocks are right, and the name of an object is when it was written.
- **First warning sign:** a snapshot key whose name time is ahead of its R2 `LastModified` by more than a few minutes. `r2-client.cjs` `list()` parses only `<Key>` and `<Size>` today, so this is invisible.

### 4. Restore - the disaster-recovery path - is quietly undone by sync
- **What killed it:** a restore is a reset, and the merge treated it as one more stale peer.
- **How it unfolded:** Month 3: a bad import or a mistaken bulk delete on the phone; the owner restores yesterday's snapshot on the PC (the existing `cloud:restore` flow, `-before-restore` kept, all correct). The restored vault's items carry yesterday's revs; the phone's snapshot carries today's tombstones and edits, all newer. The next sync on unlock deletes everything again. The owner restores again; same result. If task 1 instead re-stamps revs on write, the restored vault's first save makes every restored item "newest" and overwrites the phone's genuine edits since yesterday. Separately: `restore:fromFile` accepts any vault file, including someone else's or an old pre-sync vault with a different history; sync then merges two unrelated vaults into one.
- **Assumption that allowed it:** every snapshot in the bucket is a peer's current intent. The bucket also holds restores, `-before-restore` copies, un-named pre-install-id snapshots, dead devices and old-password snapshots.
- **First warning sign:** item count on the PC drops back within one sync after a restore.

### 5. A master password change strands the phone, and the plan's "decrypt with the master password" does not exist after a biometric unlock
- **What killed it:** keys, not passwords, are what the devices hold, and a password change forks the key.
- **How it unfolded:** Month 2: the owner changes the master password on the PC (`changeMaster`: new salt, new key, `olderBackupsPending`). The phone unlocks by fingerprint - it holds the old key, not a password - and cannot open the PC's new snapshots. Its own snapshots stay under the old key, which the PC cannot open either. Each side keeps editing; nothing flows; the phone shows no error because "download failed" looks like offline. When the owner finally types the new password on the phone, the implementation derives a key per sync with scrypt N=2^17 (seconds on a phone, blowing the 3 s unlock target), or keeps the master password in memory to re-derive, which breaks the "only the key lives in memory" rule. "Delete older backups" on the PC (`forgetOlder`) deletes only its own and un-named snapshots, so the phone's old-password snapshots - the reason for the change, if the old password leaked - stay in R2 indefinitely. `olderBackupsPending` then syncs to the phone and offers a delete that means something different there.
- **Assumption that allowed it:** one master password opens every snapshot at all times.
- **First warning sign:** a sync that downloaded a snapshot whose header `kdf.salt` differs from the local one. Nothing records it today.

### 6. Tombstones inside `entries` break every reader, and 180-day GC resurrects deletes
- **What killed it:** a new kind of row in `entries` that every existing loop had to learn to skip, plus a GC rule that is unsafe with snapshots that never die.
- **How it unfolded:** Task 1 ships. `publicView`, `findIssues`, password health, `handBack`, `linkedFolders`, `followUpsDue`, `importEntries`' duplicate check and `removeEntries` all iterate `entries`; one of them misses the `deleted` check (a tombstone has no `kind`, `title` or `spaceId`, so the page gets a blank item, or password health and Hand back count it). The Forever Opener was supposed to be "checked, not changed", but `opener-page.js` renders `rows = [...vault.entries]` and shows every unknown field masked, so every opener already written beside saved copies and in R2 (`kapevault/opener/...-<version>.html`, byte-pinned) shows blank-title rows with a masked "Rev". An old installed PC build (no `rev` support) opens the synced vault, deletes an item by removing it (`removeEntries`) - no tombstone - and edits another without a rev; the next sync brings the deleted one back and loses the edit. Month 7: GC drops a 180-day tombstone after "every known device synced past it", then the old phone the owner factory-reset without revoking (its install id's snapshots are never pruned - only the owner prunes) is still "another device's newest snapshot" and resurrects the item, secrets included.
- **Assumption that allowed it:** tombstones are rows, and "every known device" is a closed, live set.
- **First warning sign:** an item the owner deleted reappears after a sync; or any blank row in the Opener.

### 7. Syncing `cloud` and the other top-level fields lets one device break the other's backup, and a stolen phone reaches the PC
- **What killed it:** device-local state rode along in the synced document.
- **How it unfolded:** Month 4: the owner rotates the R2 token on the PC (`setCloud`). If `cloud` syncs, the phone gets the new keys only by downloading from R2 - with the revoked keys it can no longer use. If the phone saved anything with its stale config at a newer rev, the PC's new keys are overwritten with revoked ones and every PC backup fails quietly into `backup-pending`. A "Disconnect" on one device turns off backup on both. Month 5: the phone is stolen unlocked (or the thief knows the PIN and the biometric prompt allows device credential). The thief deletes 300 items; tombstones sync to the PC on its next unlock; the PC's Personal space empties. The owner restores (cause 4), sync deletes them again.
- **Assumption that allowed it:** the vault is one document whose every field is shared content. `commitRestore` already knows better ("R2 keys are this device's setup, not vault content").
- **First warning sign:** a backup error on one device within a day of a Settings > Cloud change on the other; or a merge that tombstones more than a handful of items.

---

## 2. Verdict

- **MOST LIKELY:** cause 1 (item-level LWW). It fires on the first week of normal use with two devices, needs no rare event, and `upsert()` rebuilding whole entries guarantees the wrong unit of merge.
- **MOST DANGEROUS:** cause 4 + the thief half of cause 7 together: a mass delete propagates, and the recovery path (restore) is undone by the next sync. Every other failure leaves the data somewhere; this one makes the backup system fight the user. It differs from most likely because it needs a trigger (a mistake or a theft), but when it fires there is no working way back except turning sync off.
- **Biggest hidden assumption:** that every snapshot in the bucket is a peer's current intent, so "newest wins" equals "what the owner wants". The bucket actually holds restores, `-before-restore` copies, un-named legacy snapshots, dead-device snapshots, old-key snapshots and, after a theft, attacker-written ones. The merge needs to know what KIND of state it is reading before it may merge it.
- **Fatal flaw:** no, this plan does not have a fatal flaw - serverless state-based sync over R2 snapshots is sound for 2-3 devices of one user. But as specified (one wall-clock `rev` per item, whole-item LWW, tombstones in `entries`, 180-day GC, "decrypt with the master password") it cannot meet its own success criteria 1 and 2. The rebuild below is required before task 1 ships, because task 1 fixes the on-disk shape.

---

## 3. The rebuild

### 3.1 Data (inside the encrypted JSON; header unchanged, still `version: 1`)

`spaces` and `entries` keep their exact current shape. **No sync field goes into an entry, and no tombstone goes into `entries`.** All sync metadata lives in one new top-level object, which every existing reader and every old Opener ignores (the Opener reads only `spaces`/`entries`; `start()` and `persist()` already carry unknown top-level fields through).

```
sync: {
  v: 1,
  vaultId: "<uuid>",               // lineage; two different ids never merge
  epoch: { id: "<uuid>", at: HLC }, // changes only on "Make this the vault everywhere" (restore)
  keys: [{ salt, n, at: HLC, by }], // key history; newest = this file's header salt
  clock: HLC,                      // highest HLC this vault has seen
  meta: {                          // one per entry id and per space id ("s:<id>")
    "<id>": { vv: { "<installId>": n }, g: { "<group>": { dot: ["<installId>", n], at: HLC } }, h: "<sha256 of canonical content>" }
  },
  gone: { "<id>": { vv, at: HLC } },           // tombstones: content-free, kept forever in v1
  histFloor: { "<id>": HLC },                  // "Clear history" watermark
  devices: { "<installId>": { name, platform, addedAt, revokedAt? } }
}
cloud: { ... }, olderBackupsPending: true  // device-local top-level fields, unchanged, never merged
```

Device-local state stays where it is: `cloud` and `olderBackupsPending` remain top-level fields, and core defines `SHARED_FIELDS = ["spaces", "entries", "sync"]` - every other top-level field is device-local and never merged (decided in task 1; no move means no migration risk for old app versions). `syncLog` is a top-level device-local field too: this device's last 50 results, `[{ at, with: [installId], added, changed, deleted, copies, review?, error? }]`. `HLC = [ms, counter, installId]`, compared in that order. `vaultId` is the Personal space's id (made once with the vault, never deleted), so two devices that migrate the same pre-sync vault agree on it. A new or migrated vault starts with `epoch: { id: vaultId, at: [0,0,""] }`, `keys: [{ salt, n: 1, at: [0,0,""], by: "" }]`, empty `meta`/`gone`/`histFloor`/`devices`. `h` = SHA-256 of `canonical(splitGroups(entry))` (a space: `canonical({ core: space minus id })`). A group with no entry in `g` has not been written since migration.

### 3.2 Stamping - one place, derived, not per write path
- `persist()` already holds `saved` (a shallow copy) and every change REPLACES objects. Stamping = diff `saved` vs `session.data` by object identity, then by group value: for each changed group, bump this device's counter in `vv`, set that group's `dot` and `at`, update `h`. No write path can forget to stamp.
- `lastUsedAt` is outside every group: merged by max, never bumps `vv`, never causes a conflict.
- A delete (`removeEntries`, `deleteSpace`, `confirmGone` is NOT a delete) writes `gone[id] = { vv: meta.vv + own tick, at }` and removes `meta[id]`. The `viaEntryId` cascade in `removeEntries` is NOT stamped on the other entries; a `viaEntryId` pointing at a gone or missing id is treated as unset at read time.
- **Repair on open (old writers):** an entry whose content hash differs from `meta.h` was edited by a non-sync build - stamp it as a local edit. An id in `meta` with no entry and no `gone` was deleted by a non-sync build - write a tombstone. This makes an old installed PC build safe.
- Migration never stamps: an entry with no `meta` is `vv: {}` (the plan's `at: 0`). Two devices holding the same legacy entry with the same content never conflict.
- Merge itself never stamps, never calls `today()`, `Date.now()` or `randomUUID()`. It is a pure function of its two inputs.
- Stamping sets `histFloor[id]` when a login's `history` group goes from present to absent. A change with no group written (lastUsedAt, a dead sign-in link dropped) only refreshes `h`. Repair cannot know which group an old build changed, so it stamps every group the item has or had. With no installId (settings.json unreadable) nothing is stamped that run.

### 3.3 Field groups and their merge rules

| Class | Groups | Rule |
|---|---|---|
| Plain content | `core` (title, tags, notes, heldFor, brand, updatedAt, and each kind's non-secret fields), `fav`, `space` | per-group causal LWW (below); loser -> conflict copy |
| Password | login `pw` (password + passwordChangedAt) | causal LWW; loser's password -> `history` with `changedAt` = loser's HLC date; no conflict copy if password is the only group that conflicted |
| History | login `history` | union, dedupe by password, drop entries at or below `histFloor[id]` (compared at day granularity: the UTC day of a row's `changedAt`; rows from before 2026-09-28 carry only a local date), sort by (changedAt, password) desc, cap 10 |
| Other secrets | `totp`, `qa` (questions), key `secret`, note `body`, device `dpw`, `wifi`, ID `idnum` (idNumber), `photo` (a device's label photo or an ID's) | causal LWW; loser -> conflict copy |
| Recovery codes | `codes` | same set (hash of the code list) on both sides: `used` = OR per code, `paper` = causal LWW; different sets: causal LWW on the `codes` group's HLC (not `setAt`, a plain display date), loser -> conflict copy |
| Payee money fields | `pay` = number + provider + accountName + confirmedAt, one group | never split: `confirmedAt` only ever travels with the number it confirmed. A payee conflict copy ALWAYS drops `confirmedAt` and gets "(check this number)" |
| Lifecycle | `life` | causal LWW; a losing `life` write is dropped with no conflict copy (nobody types it, so there is nothing to preserve) - except `gone`, which is absorbing: a gone login stays the tombstone shape from `confirmGone`; any concurrent secret-group change goes to a conflict copy titled "changed after closing" |
| Bookkeeping | `lastUsedAt` | max; not versioned |
| Spaces | `s:<id>` core (name) | causal LWW; a deleted space is a tombstone; entries whose space is gone show in Personal at read time (no stamp) |

**A new kind needs every syncing device to know it.** `groupOf` puts a field of a kind a build does not know into `core`, so a build without the ID kind folds an ID's `idNumber` and `photo` into `core`: its stamps and a concurrent change on a device that has the kind no longer meet in the same group, and one of the two changes can be lost. Every device that syncs a vault must run a build with the ID kind before IDs are created there - ship the phone APK with the ID kind together with the PC build. The same holds for any later kind with its own groups.

**Causal LWW per group** (dotted version vectors): for group `g`, side A's value was written by `A.g.dot = [d, n]`. If `B.vv[d] >= n`, B has seen that write, so B's value is the same or a successor - take B. Symmetric for A. Same dot - identical. Neither has seen the other's dot - a real conflict: winner = higher `at` (HLC, then installId), loser preserved per the table. Result `vv` = element-wise max. Clock skew can therefore only pick which of two TRULY concurrent values is shown first; it can never make an edit lose to one that did not see it.

**Conflict copy:** id = a v8 UUID derived from `sha256(canonical([id, loser dot, copy content]))` (deterministic, never `randomUUID()` - two devices resolving the same conflict independently produce the same bytes, so a second sync is a no-op), content = the loser side's whole item, title + " (conflict copy, <device name>, <UTC day of loser HLC>)", meta = `vv: { [dot.dev]: dot.n }`, every group's dot = the loser dot. The title date is the UTC calendar day of the HLC's ms, never a local date. A dropped password's `history` `changedAt` is the loser HLC's ms as a UTC ISO timestamp, as a device writes its own history rows.

**Delete vs edit:** `gone[id].vv >= item vv` - deleted. Item has events the tombstone never saw (edited concurrently or after) - the item stays alive (edit wins), the tombstone stays for the record, and the syncLog notes "deleted on PC, kept because Pixel edited it". Absence of an id in a snapshot never deletes anything.

**Commutative, idempotent and convergent, but not associative for kept losers:** three devices merging in a different order always agree on which values are alive, but can disagree on which loser a conflict copy or a `history` row preserves - the order two states meet in decides which one is called the loser. Accepted and documented, not fixed: the live data always converges, only the shape of the record of what lost does not.

### 3.4 Clock rule
- Local stamp: `ms = max(Date.now(), clock.ms)`; if equal to `clock.ms`, `counter = clock.counter + 1`, else 0. `clock` = the stamp.
- On merge: `clock = max(clock, remote.clock)` ONLY if `remote.clock.ms <= Date.now() + 24h`. Otherwise the snapshot is not merged: sync pauses for that device with "Pixel 8's clock is N days ahead. Fix its date, then Sync now." Same check per group `at`.
- HLC never feeds the Windows Hello / Touch ID `masterAt` / `highWater` seal or the 14-day rule; those stay on this device's clock.
- `updatedAt`, `passwordChangedAt`, `confirmedAt`, `setAt` stay local YYYY-MM-DD display dates (from the winning side), never used for ordering.

### 3.5 Which snapshot to read
- Add `LastModified` to `r2-client.cjs` `list()` (and the e2e fake R2). "Newest for device X" = max server `LastModified` among keys owned by X, never the name time.
- Skipped: own install id; `-before-restore`; un-named (pre-install-id) and `bovault/` legacy keys; revoked devices; devices whose newest object is older than 180 days (listed as "not seen since", merged only by an explicit Sync now).
- Before merging: `checkVaultFile`, then decrypt with the SESSION KEY when header `kdf` + salt equal the local ones (no scrypt, no stored password). Decrypt fails or JSON invalid: try that device's next-newest (state-based merge makes any older snapshot a safe subset), and record it; three consecutive failures for a device = visible error.
- `vaultId` differs: never merge; show "This bucket holds a different vault from <device>".
- `epoch` differs: see 3.7.
- Before upload: the bytes read from disk must decrypt with the session key (GCM tag check) - a device never uploads a file it cannot read.
- Duplicate install id (a copied `%APPDATA%\KAPEVault` on a second PC): an object under my own install id that is not in my last-uploaded list means two installs share an id; regenerate `installId` and log it. Sync refuses to run while `installId()` is "" (settings unreadable this run).

### 3.6 Master password change
- `changeMaster` appends `{ salt, n: prev.n + 1, at, by }` to `sync.keys`. The new salt is the ONE salt every device adopts - devices share `kdf`+salt so one key opens all current snapshots, exactly as today.
- Remote header salt is in my `sync.keys` but not the newest: that device is behind. Skip it silently, show "Pixel 8 still uses the old master password - unlock it there".
- Remote salt unknown to me: a newer (or forked) change. Prompt once for "the master password set on <device>", through `throttledUnlock`. It opens the snapshot: merge my local plaintext into it, write my file under the REMOTE kdf/salt/key, adopt its `sync.keys`, turn Windows Hello / Touch ID / phone biometric OFF (the key changed - same path as restore), set my own `olderBackupsPending` (a top-level device-local field).
- Fork (both `n` equal, different salts): higher HLC wins; both adopt it; the loser device shows "the master password from <device> is now the one for all devices".
- "Delete older backups" stays per device and manual (never automatic). The PC's Settings adds: "Pixel 8 still has N backups under the old password" - counted by header salt, which is plaintext.

### 3.7 Restore
- Any restore on a device with sync on pauses sync on that device and asks one question:
  - **"Make this the vault on all devices"**: new `epoch` (`id`, HLC). Other devices, on seeing a newer epoch whose `vaultId` matches, REPLACE their shared state with it; their local changes not in the epoch's parent state become conflict copies (never lost). Restores the thief-deleted items and keeps them restored.
  - **"Merge it in"**: plain merge. Deleted items stay deleted (tombstones win over the older restored state); only missing-but-never-deleted items come back. Said in the confirm.
- A restored vault with a different `vaultId` (someone else's file, an unrelated vault) can only be the first choice or "sync off".
- Two concurrent epochs: higher HLC wins; the loser device's state was already kept as its `-before-restore` snapshot.

### 3.8 What syncs and what never syncs

| Syncs (merged) | Never syncs (device-local top-level field, or outside the vault) |
|---|---|
| `spaces`, `entries`, `sync.meta`, `sync.gone`, `sync.histFloor`, `sync.keys`, `sync.epoch`, `sync.devices` (a device record has no rename clock: the record added later - by `addedAt` - wins whole; the earliest `revokedAt` stands; a `nameAt` would be needed if renames arrive) | `cloud` (endpoint, bucket, keys, `auto`), `olderBackupsPending`, `syncLog`, `lastSyncAt` (shown from R2 `LastModified`), Hello / Keystore records, `settings.json`, `installId` |

R2 key rotation = each device types its new keys; a 401/403 on a device prompts "Your R2 keys changed. Type the new ones." Recommend one R2 API token per device, so revoking a lost phone's token does not touch the PC.

### 3.9 Sync loop rules
- One sync at a time, mutually exclusive with `restores.restore` and `changeMaster`.
- Download and decrypt happen off the session; the COMMIT is synchronous: re-check the session is the same one (a generation counter bumped by `start()`), merge the remote into the CURRENT `session.data` (not the copy taken before the download), `persist()`. Session changed or locked: discard and retry later. A save during a download is never lost.
- Sync's own save never triggers sync. A merge whose canonical shared-state hash equals the pre-merge hash writes nothing and uploads nothing.
- Unlock never waits on sync; sync runs after `unlocked()`.
- **Mass-change gate:** a merge that would tombstone more than 5 items, or more than 10% of entries when that is 3 or more, replace an epoch, adopt a new key, or change secret groups on more than 20 items shows a review ("Pixel 8 wants to delete 143 items") before it commits.
- Revoke device (PC Settings): `devices[id].revokedAt`; its snapshots are never merged again. The phone's biometric prompt uses BIOMETRIC_STRONG with a CryptoObject, no device-credential fallback.
- Settings shows a short fingerprint of the canonical shared state (first 8 hex of its SHA-256) on both devices. After "Sync now" on both, they must match.
- The trust page (TrustSheet) gains the sentence that the app now downloads its own snapshots automatically - in the same commit as the behaviour, including under Air Wall (the courier's curl carries downloads as it carries uploads; downloads come back on curl's stdout and are never written to disk).
- PC: `electron/sync.cjs` runs the loop (after unlock, 3 s after a user save, Sync now); a restore pauses it until Sync now (persisted until the restore question is answered). The fingerprint is the "Check code" in the Sync sheet.

### 3.10 What changed and why

| Change | Closes |
|---|---|
| Per-group dotted version vectors instead of one `rev` per item; groups from the table | 1 |
| Deterministic conflict-copy ids + pure merge (no `today()`/`Date.now()`/`randomUUID()`) | 1, 2 |
| Stamping by diff in `persist()`; `lastUsedAt` unversioned; no-op merge writes nothing; sync save never triggers sync | 2 |
| HLC + 24h future cap; server `LastModified` picks the newest snapshot | 3 |
| Restore pauses sync and asks: new epoch vs merge; `vaultId` lineage | 4 |
| Decrypt with the session key; `sync.keys` history; adopt-remote-salt flow; biometric off on adoption; per-device old-key count | 5 |
| Metadata and tombstones outside `entries`; tombstones kept forever; repair-on-open for old writers; skip dead devices | 6 |
| `cloud`, `olderBackupsPending`, `lastSyncAt` device-local; mass-change gate; revoke device; per-device R2 token; BIOMETRIC_STRONG only | 7 |
| Payee `pay` group + conflict copy unconfirmed; `histFloor`; codes OR; `gone` absorbing | 1 (field classes the plan never listed) |
| Commit re-merges into current session under a generation check; mutual exclusion with restore/changeMaster | 1 (lost update inside one device) |

### 3.11 Pre-launch checklist (before task 1 writes anything to the installed PC vault)
1. **Opener survives the new shape.** Load a vault with `sync` + `local` + conflict copies into every Opener version already in R2 and in a saved-copy folder. Walk away (change the data layout, not the Opener) if any row, count or field changes versus the same vault without `sync`.
2. **Metadata size.** Generate the owner's real item count x 3 devices x 2,000 deletes of metadata and measure the vault. Walk away from "tombstones forever" (design a checked GC instead) if `sync` exceeds 2 MB or pushes a real vault within 25% of `MAX_VAULT_BYTES`.
3. **scrypt on the target phone.** One N=2^17 derive in the WebView on the owner's actual phone. Above 3 s, the native scrypt plugin goes in before the phone app; above 10 s even native, walk away from the WebView core for crypto.
4. **R2 `LastModified` and token scope.** One list call on the real bucket returns `LastModified` per key, and a second token can be created. Walk away from "server clock picks newest" if `LastModified` is missing (fall back to a per-device sequence number in the object name, which then needs the snapshot regex changed).
5. **Merge properties green** (test list below, 10,000 random runs) before any UI. If commutativity or idempotence cannot be made to hold for 3-device conflicts, walk away from conflict copies and use "loser goes to a per-item `conflicts[]` field" instead.

### 3.12 Tests that prove each rule
Property tests (`node --test`, a seeded generator in the repo - no new dependency; flag it if fast-check is wanted), over random vaults of 3 devices with random edits, deletes, moves, code marks, lifecycle changes, clears, merges and skewed clocks:
- **Commutative:** `canon(merge(a,b)) === canon(merge(b,a))`.
- **Associative outside kept losers:** `merge(merge(a,b),c) === merge(a,merge(b,c))` once conflict copies, `history` rows and tombstone-only removals are set aside - the order three states meet in can still choose which loser is kept as a copy or a history row, but never which values survive as the live item.
- **Idempotent:** `merge(a,a) === a`; `merge(merge(a,b),b) === merge(a,b)` - including zero new conflict copies.
- **Convergence:** any order of pairwise syncs until quiescent gives identical `canon` on all devices.
- **No silent loss:** every value any device typed into any group is, in the result, the winner, a `history` entry, or inside a conflict copy - unless a causally later write on the same group replaced it, or it was below a `histFloor`, or it was deleted by a tombstone that saw it.
- **Causality beats clocks:** a device at wall clock -1 year that edits after seeing a remote change still wins that group.

Example tests:
- Sequential edits on two devices produce no conflict copy.
- Disjoint concurrent edits (PC lifecycle, phone password) keep both, with no conflict copy.
- The same concurrent conflict resolved on both devices gives one conflict copy with the same id.
- `touch()` after a real edit elsewhere does not win.
- Ten alternating no-change syncs make 0 PUTs on the fake R2.
- Stale snapshot after a delete: no resurrection. Concurrent delete + edit: item kept.
- Old-writer repair: an edit and a removal made by the pre-sync build are stamped and tombstoned on open.
- Clock: a remote HLC +5 years pauses that device; a snapshot named 2030 with an older `LastModified` is not picked.
- Master change on the PC: phone biometric unlock, then sync prompts once, adopts the salt, turns biometric off, and the next PC sync opens phone snapshots with no prompt. The lagging device is skipped with no prompt. Fork tie-break.
- Restore "everywhere": the other device replaces, and its unsynced edit becomes a conflict copy. Restore "merge": deletes stay deleted. Foreign `vaultId`: refused.
- Corrupted newest snapshot (one byte flipped, and a truncated body): falls back to the next, logs, and never treats it as empty.
- `cloud` rotated on the PC: the phone keeps its own; a 403 prompts. Disconnect on one device leaves the other on.
- Payee conflict copy has no `confirmedAt`. Cleared history does not come back. Codes marked used on both devices stay used. A gone login stays gone and the concurrent password goes to a copy.
- A save during a sync download survives. Sync is refused during a restore or a master password change.
- Mass-change gate fires at 6 tombstones. A revoked device is never merged.
- Duplicate `installId` is detected and regenerated.
- Two-device e2e: PC e2e + emulator against the fake R2 for all of the above; the fingerprint matches after Sync now on both.

---

## 4. The adversary

The person who gains from this failing is whoever holds the owner's phone, or any of their R2 tokens.

- **Where I would attack:** the merge's trust in anything that decrypts. With the phone unlocked, or the PIN plus a prompt that allows device credential, I hold the vault key, so every snapshot I write is "authentic". I do not need to steal anything off the PC - sync carries my changes there.
- **The week of launch:** delete everything in Personal and Clients on the phone, and edit every payee's `number` to mine with a fresh `confirmedAt` - item-level LWW carries `confirmedAt` along, so the PC shows my GCash number as "confirmed by call". Set the phone date to 2030 first, so my values beat every later PC edit (plan as written). Then let the phone sync once.
- **The move you would never see coming:** do nothing destructive. Keep the phone, and use its R2 token (inside the vault I can open) from a laptop to delete the PC's install-id folder slowly - one snapshot a day, which looks like retention - until the only surviving backups are ones I wrote. Tokens are per bucket, not per prefix, so the phone's token can do this. When the owner restores, they restore my version. The defences are the mass-change gate, `pay` conflict copies being unconfirmed, the 24h clock cap, per-device tokens revoked on loss, BIOMETRIC_STRONG only, and, if R2 supports it on this bucket, a bucket lock / retention rule on `kapevault/snapshots/` (still open: whether R2 offers one for this bucket, and how it would meet `snapshotsToPrune`'s deletes).

---

## 5. Tripwires

The timeline has no dates, so "Week N" counts from the day the phone app is first installed on the owner's real phone (task 7). The rows need the `syncLog` counts and the state fingerprint from 3.9.

| # | Failure mode | Signal (measurable) | Check when | Threshold = act |
|---|---|---|---|---|
| 1 | LWW data loss / copy storm | conflict copies created (syncLog) vs same-item edits on both devices | end of week 1, then weekly for 4 weeks | any conflict copy without a matching real concurrent edit, or any copy of a copy = pause sync on both, reproduce as a property-test case |
| 2 | Upload loop | snapshots per install id per day (R2 list) | day 1, day 3 | more than 20 on a day with 5 or fewer edits = pause auto sync, find the write that stamps |
| 3 | Clock | max(name time - `LastModified`) per device; syncLog "clock ahead" pauses | week 1, then after any phone reboot with no network | any gap over 10 min, or any merged HLC over now + 1 min = investigate that device's clock path |
| 4 | Restore undone | item count before a restore vs after the first sync following it | first real or drilled restore (drill it in week 2 on a copy) | count drops back = restore flow is broken, sync off until fixed |
| 5 | Master change strands | snapshots under a non-newest salt, per device, 7 days after a change | 7 days after any master password change (drill one in week 3) | any left after both devices were unlocked = adoption flow failed |
| 6 | Tombstones / old writers | Opener blank rows; a deleted id present again; `sync` size in bytes | week 1 (Opener), monthly (size) | any resurrection = stop sync; `sync` over 2 MB = revisit GC with a checked design |
| 7 | Device-local leak / theft path | backup errors on device B within 24h of a Settings > Cloud change on A; mass-change gate fires | every Cloud settings change; any gate firing | any cross-device backup error = the `local` split leaked; any unexpected gate = treat the phone as lost (revoke, rotate token, change master) |
| all | Divergence | state fingerprint on PC vs phone after Sync now on both | after every sync in weeks 1-2, then weekly | any mismatch = sync off on both, capture both vaults' `sync` blocks |

**Check first:** the day-1 check of row 2 (snapshots per install id per day). It fires first, it is a single R2 list call, and it is the one failure that silently eats the restore history the other fixes depend on.
