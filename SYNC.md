# KAPEVault sync: how the PC and the phone stay in step

Backup and sync between KAPEVault devices, as the code does it. The code is the authority: the merge
and its rules in `core/sync/` (shared by both apps), the sync loop in `electron/sync.cjs` (PC) and
`mobile/src/app/host/sync.ts` (phone), the R2 upload, listing and pruning in `electron/cloud-backup.cjs`
and `mobile/src/app/host/cloud.ts`. The vault file itself is in [FORMAT.md](FORMAT.md). What an attacker
holding the bucket or a device can and cannot do is in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

## 1. Overview

There is no server. Each device uploads its own encrypted vault file to the user's Cloudflare R2 bucket
as a snapshot, under its own install id. To sync, a device lists the bucket, downloads the newest
snapshot of every other device, decrypts it with the key it already holds, merges it into its own
vault, saves, and uploads the result. Sync runs after unlock, 3 seconds after a user save, on resume
(phone) and on Sync now. On Android, merging another device's snapshot needs KAPEVault Pro; without it
the phone uploads backup-only snapshots that any device can restore but none merges.

## 2. Goals

- Nothing a user typed is silently dropped. A value that loses a real conflict is kept: as the winner, in
  a login's password history, or in a conflict copy.
- Device clocks may be wrong. A wrong clock can change which of two truly concurrent values is shown
  first. It can never make an edit lose to one that did not see it.
- Any snapshot in the bucket may be stale, foreign, damaged or planted. The merge knows what kind of state
  it is reading before it merges it.
- Two devices that have both synced agree byte for byte on the shared state, and can check it (3.9).

## 3. Design

### 3.1 Data (inside the encrypted JSON; header unchanged, still `version: 1`)

`spaces` and `entries` keep their exact shape. **No sync field goes into an entry, and no tombstone goes
into `entries`.** All sync metadata lives in one top-level object, which readers that do not sync (and
every Forever Opener) ignore; the app carries unknown top-level fields through every save.

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
cloud: { ... }, olderBackupsPending: true  // device-local top-level fields, never merged
```

Core defines `SHARED_FIELDS = ["spaces", "entries", "sync"]` (`core/sync/shape.js`). Every other top-level
field is device-local and never merged: `cloud`, `olderBackupsPending`, `genHistory` (the password
generator's recent values, FORMAT.md; a device's own, so a password generated on the PC is not copied to the
phone's vault by sync), and `syncLog`, this device's last 50 results, `[{ at, with: [installId], added, changed, deleted, copies, review?, error? }]`.

`HLC = [ms, counter, installId]`, compared in that order. `vaultId` is the Personal space's id (made once
with the vault, never deleted), so two devices that migrate the same pre-sync vault agree on it. A new
or migrated vault starts with `epoch: { id: vaultId, at: [0,0,""] }`, `keys: [{ salt, n: 1, at: [0,0,""],
by: "" }]`, and empty `meta`, `gone`, `histFloor` and `devices`. `h` = SHA-256 of
`canonical(splitGroups(entry))` (a space: `canonical({ core: space minus id })`). A group with no entry in
`g` has not been written since migration.

### 3.2 Stamping - one place, derived, not per write path

- Every save goes through `persist()`, and every change replaces objects rather than editing them.
  Stamping diffs the previous saved state against the new one, by object identity and then by group
  value: for each changed group, it bumps this device's counter in `vv`, sets that group's `dot` and
  `at`, and updates `h`. No write path can forget to stamp (`core/sync/stamp.js`).
- **A newer sync object is never reset.** `sync.v` above 1, or a vault `minReader` above this app's reader
  version (FORMAT.md), makes `readSync` throw `NewerVaultError` instead of returning a new object: an older
  app that replaced it would drop the tombstones, device removals and key history. Locally the vault is
  refused and nothing is written. A remote snapshot like that is skipped by `mergeRemotes` (its device is
  named in `problems`: "<device> runs a newer KAPEVault. Update this app."), and so is one whose decrypted
  `minReader` is above this app's (each host's download). Both claims are inside the ciphertext, so only a
  holder of the vault key can make them. A file header whose `version` is above 1 is NOT taken as a newer
  device: the header is not covered by the tag, and anyone holding the bucket keys can write
  `{"format":"kapevault","version":2}` (35 bytes) as a device's newest object. It is passed over like any
  snapshot that will not open (3.5): remembered, not downloaded again until it changes, and the device's
  next snapshot that opens is merged. A missing or malformed `sync.v` keeps the old behaviour: a new sync
  object.
- `lastUsedAt` is outside every group: merged by max, never bumps `vv`, never causes a conflict.
- A delete (`removeEntries`, `deleteSpace`, a Trash purge) writes `gone[id] = { vv: meta.vv + own tick, at }`
  and removes `meta[id]`. Closing an account (`confirmGone`) is not a delete. The `viaEntryId` cascade in
  `removeEntries` is not stamped on the other entries; a `viaEntryId` pointing at a gone or missing id
  is treated as unset at read time.
- **Repair on open (older app versions):** an entry whose content hash differs from `meta.h` was edited
  by a version without sync, and is stamped as a local edit. An id in `meta` with no entry and no `gone`
  was deleted by such a version, and gets a tombstone (`repair`, run by `core/opened-vault.js`). Repair
  cannot know which group an old version changed, so it stamps every group the item has or had.
- Migration never stamps: an entry with no `meta` has `vv: {}`. Two devices holding the same legacy
  entry with the same content never conflict.
- The merge itself never stamps and never reads the clock or makes random ids. It is a pure function of
  its two inputs.
- Stamping sets `histFloor[id]` when a login's `history` group goes from present to absent. A change that
  writes no group (`lastUsedAt`, a dead sign-in link dropped) only refreshes `h`. With no install id
  (settings unreadable this run) nothing is stamped; the next open's repair catches up.

### 3.3 Field groups and their merge rules

Groups are defined in `core/sync/groups.js`, the rules in `core/sync/merge.js`.

| Class | Groups | Rule |
|---|---|---|
| Plain content | `core` (title, tags, notes, heldFor, brand, updatedAt, and each kind's non-secret fields), `fav`, `space` | per-group causal LWW (below); loser -> conflict copy |
| Password | login `pw` (password + passwordChangedAt) | causal LWW; loser's password -> `history` with `changedAt` = loser's HLC date; no conflict copy if password is the only group that conflicted |
| History | login `history` | union, dedupe by password, drop entries at or below `histFloor[id]` (compared at day granularity: the UTC day of a row's `changedAt`; rows from before 2026-09-28 carry only a local date), sort by (changedAt, password) desc, cap 10 |
| Other secrets | `totp`, `qa` (questions), key `secret`, note `body`, device `dpw`, `wifi`, ID `idnum` (idNumber), `photo` (a device's label photo or an ID's) | causal LWW; loser -> conflict copy |
| Recovery codes | `codes` | same set (hash of the code list) on both sides: `used` = OR per code, `paper` = causal LWW; different sets: causal LWW on the `codes` group's HLC (not `setAt`, a plain display date), loser -> conflict copy |
| Lifecycle | `life` | causal LWW; a losing `life` write is dropped with no conflict copy (nobody types it, so there is nothing to preserve) - except `gone`, which is absorbing: a gone login stays the tombstone shape from `confirmGone`; any concurrent secret-group change goes to a conflict copy titled "changed after closing", which holds the title, the space and only those secrets; a title edit, a move or a star makes no copy |
| Trash | `trash` = `trashedAt` (a UTC ISO timestamp; missing = not in the Trash) | causal LWW; a losing `trash` write is dropped with no conflict copy (a trash, a restore and a trash on another device are not typed content). A trash on one device shows as trashed on the other, a restore restores it, and a trash beside an edit of the same item keeps both (the edit is in the Trash). The 30 days start at the later of `trashedAt` and the time of the `trash` group's sync stamp (`core/trash.js`): `trashedAt` is the trashing device's wall clock, and a phone months behind would otherwise purge a fresh trash on every device; its hybrid clock never trails what it had last synced. A local clock set ahead cannot be told from 30 quiet days, so it can delete only on that device: its purge is stamped with the same clock, and every other device refuses a snapshot whose clock is over a day ahead (3.4). A purge (30 days, "Delete now", "Empty Trash") is an ordinary delete: a tombstone, so a restore made without seeing the purge keeps the item as that version alone, like any edit that a delete never saw |
| Bookkeeping | `lastUsedAt` | max; not versioned |
| Spaces | `s:<id>` core (name) | causal LWW; a deleted space is a tombstone; entries whose space is gone show in Personal at read time (no stamp) |

**A new kind needs every syncing device to know it.** `groupOf` puts a field of a kind a build does not
know into `core`, so a build without the ID kind folds an ID's `idNumber` and `photo` into `core`: its
stamps and a concurrent change on a device that has the kind no longer meet in the same group, and one
of the two changes can be lost. Every device that syncs a vault must run a build that knows a kind
before items of that kind are created there. The same holds for any later kind with its own groups.

**Causal LWW per group** (dotted version vectors): for group `g`, side A's value was written by
`A.g.dot = [d, n]`. If `B.vv[d] >= n`, B has seen that write, so B's value is the same or a successor -
take B. Symmetric for A. Same dot - identical. Neither has seen the other's dot - a real conflict:
winner = higher `at` (HLC, then installId), loser preserved per the table. Result `vv` = element-wise
max. Clock skew can therefore only pick which of two truly concurrent values is shown first; it can
never make an edit lose to one that did not see it.

**Conflict copy:** id = a v8 UUID derived from `sha256(canonical([id, loser dot, copy content]))`
(deterministic: two devices resolving the same conflict independently produce the same bytes, so a
second sync is a no-op), content = the loser side's whole item, title + " (conflict copy, <device name>,
<UTC day of loser HLC>)", meta = `vv: { [dot.dev]: dot.n }`, every group's dot = the loser dot. The title
date is the UTC calendar day of the HLC's ms, never a local date. A dropped password's `history`
`changedAt` is the loser HLC's ms as a UTC ISO timestamp, as a device writes its own history rows.

**Delete vs edit:** `gone[id].vv >= item vv` - deleted. Item has events the tombstone never saw (edited
concurrently or after) - the item stays alive (edit wins), the tombstone stays for the record, and the
syncLog notes it. Absence of an id in a snapshot never deletes anything.

**Commutative, idempotent and convergent, but not associative for kept losers:** three devices merging
in a different order always agree on which values are alive, but can disagree on which loser a conflict
copy or a `history` row preserves - the order two states meet in decides which one is called the loser.
This is accepted: the live data always converges, only the shape of the record of what lost does not.

### 3.4 Clock rule

- Local stamp: `ms = max(Date.now(), clock.ms)`; if equal to `clock.ms`, `counter = clock.counter + 1`,
  else 0. `clock` = the stamp (`core/sync/hlc.js`).
- On merge: `clock = max(clock, remote.clock)` only if `remote.clock.ms <= Date.now() + 24h`. Otherwise
  the snapshot is not merged and sync pauses for that device: "<device>'s clock is N days ahead. Fix its
  date, then Sync now." (`core/sync/run.js`). A read sync object's `clock` is raised to the highest time
  it holds (`validSync`, `core/sync/shape.js`), so this one check covers every group's `at`.
- The HLC never feeds the Windows Hello / Touch ID / fingerprint 14-day dates; those stay on this
  device's clock.
- `updatedAt`, `passwordChangedAt` and `setAt` stay local YYYY-MM-DD display dates (from
  the winning side), never used for ordering.

### 3.5 Which snapshot to read

Snapshot names are in [FORMAT.md](FORMAT.md) (Cloud backup names). Selection is `pickSnapshots` in
`core/sync/snapshots.js`.

- "Newest for device X" = the highest R2 `LastModified` among the keys in X's folder, never the time in
  the name.
- Skipped: this install's own folder; `-before-restore`; `-backup-only` (a phone without KAPEVault Pro:
  listed and restorable, never merged); snapshots with no install id folder and pre-rename `bovault/`
  keys; revoked devices; objects larger than a vault can be (`MAX_VAULT_BYTES`, never downloaded);
  devices whose newest object is older than 180 days (listed as "not seen since", merged only by an
  explicit Sync now).
- Devices the vault does not know yet are read only up to 8 per run, newest first (`MAX_NEWCOMERS`):
  anyone with write access to the bucket can plant device folders.
- Before merging: `checkVaultFile`, then decrypt with the **session key** when the header `kdf` and salt
  equal the local ones (no scrypt, no stored password). If the newest will not open, the next-newest of
  that device is tried (an older snapshot is a safe subset of a newer one, never read as an empty vault);
  three that will not open = a visible error for that device. An object that would not open is
  remembered and not downloaded again until it changes. A header that claims a newer version is one that
  will not open (3.2): only a claim inside a snapshot that opened with the vault key stops a device.
- `vaultId` differs: never merged; the device shows that the bucket holds a different vault.
- `epoch` differs: see 3.7.
- Before upload: the bytes read from disk must decrypt with the session key (GCM tag check). A device
  never uploads a file it cannot read.
- Duplicate install id (a copied app data folder on a second PC): a snapshot under this install's own id
  that it never uploaded (`sent-snapshots.json`), that opens with the vault key, and that holds a change made
  under this id that this vault never made (an item version or a device record,
  `core/sync/run.js` `writesAsThisInstall`) means two installs share an id; the install id is regenerated
  and logged (PC). Anything else in that folder - junk, a header, a stranger's vault, a copy of one of this
  install's own snapshots - is what anyone holding the bucket keys can plant, and changes nothing: a new id
  would leave the old folder un-thinned and show this device as a new one. The three newest unread objects
  are read per run, each once until it changes. Sync refuses to run while the install id cannot be read.
- Downloads come back on the courier's stdout (PC) or in memory (phone) and are never written to disk.

### 3.6 Master password change

- `changeMaster` appends `{ salt, n: prev.n + 1, at, by }` to `sync.keys`. The new salt is the one salt
  every device adopts: devices share `kdf` and salt, so one key opens all current snapshots.
- A remote header salt that is in this device's `sync.keys` but not the newest: that device is behind.
  It is skipped, with "<device> still uses the old master password - unlock it there".
- A remote salt unknown to this device, from a known device: a newer (or forked) change. The user is asked
  once for "the master password set on <device>", through the unlock throttle. If it opens the snapshot,
  this device merges its local state into it, re-encrypts its file under the remote salt and key, adopts
  its `sync.keys`, turns Windows Hello / Touch ID / fingerprint unlock off (the key changed) and sets its
  own `olderBackupsPending`. Adopting a key always goes through the review (3.9).
- An unknown-salt snapshot does not hide that device's other snapshots: anyone holding the bucket keys can
  plant one without the vault key. The next snapshot of that device that opens is still merged, and the
  prompt is shown beside it. From a device the vault does not know, an unknown-salt snapshot counts as
  one that will not open.
- Fork (both `n` equal, different salts): the higher HLC wins and both devices adopt it.
- "Delete older backups" stays per device and manual. It uploads a fresh snapshot under the new
  password, then deletes this install's older snapshots and those from before install ids; other
  devices' snapshots are left alone. A bucket lock rule may refuse some deletes; the rest go ahead and
  the notice says how many are still locked (`electron/cloud-backup.cjs` `forgetOlder`).

### 3.7 Restore

- Any restore on a device with sync on pauses sync on that device and asks one question:
  - **"Make this the vault on all devices"**: a new `epoch` (`id`, HLC). Other devices, on seeing a newer
    epoch whose `vaultId` matches, replace their shared state with it; their local changes not in the
    epoch's parent state become conflict copies (never lost). This is how a mass delete is undone and
    stays undone.
  - **"Merge it in"**: a plain merge. Deleted items stay deleted (tombstones win over the older restored
    state); only missing-but-never-deleted items come back. The confirm says so.
- A restored vault with a different `vaultId` (someone else's file, an unrelated vault) can only be the
  first choice or sync off.
- Two concurrent epochs: the higher HLC wins; the losing device's state was already kept as its
  `-before-restore` snapshot.
- Restore never resets the unlock throttle with a backup's password: only a success on the local vault
  clears the miss count.
- **A restore never undoes a removal or a lock-out** (3.9; `core/sync/merge.js` `carryLockOut`, PC
  `vault-session-backup.cjs` `restoreCarry`, phone `restore.ts`). Restoring over an unlocked vault, every
  device removal of the vault it replaces is written into the restored one (the earliest `revokedAt`
  stands). And when the backup is under a master password a lock-out retired - one set before a device was
  removed, while the vault's own key was set after that removal - the restored vault is written under the
  replaced vault's key, with its key history (the PC's result says `keptKey`, and the restore toast adds
  "The vault keeps your current master password."): it then opens with today's master password, not the
  backup's. Under the backup's key, the removed device's copy of it would open
  everything the restore uploads, and its snapshots under that key would merge again. Both are read before
  the restore's own upload (the vault may lock meanwhile), and Remove from sync is refused while a restore
  runs. A key set after the removal, or a removal with no new key yet, keeps the backup's key: the removed
  device never had it, or it still has today's too.
- **Only the same vault carries anything** (audit run-1 4.1). The carry above, and the PC keeping this
  device's R2 setup through an unlocked restore, apply only when the backup's `sync.vaultId` is the open
  vault's. Unlocked in an unrelated vault (a file someone handed over, or one restored at the lock screen),
  restoring your own vault back takes none of its key, removals or R2 setup, and the replaced-copy slot is
  not cleared. The phone's `restoreCarry` follows the same rule.
- What that leaves: a restore at the lock screen cannot read the vault it replaces, so it carries nothing:
  the restored vault has the backup's key and device list. After restoring a backup from before a lock-out
  there, remove the lost device again and change the master password BEFORE answering the sync question
  (sync stays paused until then, 3.7); answered first, the lost device's snapshots under the backup's key
  merge as they did before the lock-out.

### 3.8 What syncs and what never syncs

| Syncs (merged) | Never syncs (device-local top-level field, or outside the vault) |
|---|---|
| `spaces`, `entries`, `sync.meta`, `sync.gone`, `sync.histFloor`, `sync.keys`, `sync.epoch`, `sync.devices` (a device record has no rename clock: the record added later - by `addedAt` - wins whole; the earliest `revokedAt` stands) | `cloud` (endpoint, bucket, keys, `auto`), `olderBackupsPending`, `genHistory`, `syncLog`, the last sync time (shown from R2 `LastModified`), Hello / Keystore records, `settings.json`, the install id |

**Generated passwords (`genHistory`) stay on the device that made them.** The list is a safety net for one
moment on one device (a lock before a pasted password is saved), not account state: it has no item to
version, nothing to conflict with, and merging it would copy every candidate password to every other
device and into every snapshot those devices upload. So it is outside `SHARED_FIELDS`, merge and
`adoptEpoch` return this device's own list untouched, and stamping never sees it (recording one bumps no
`vv`, so it starts no sync). It does ride in every snapshot this device uploads, encrypted with the rest, so
a restore of that snapshot brings it back; a restore replaces the list with the backup's own (the vault it
replaced is kept with its own list). `core/sync/merge.test.js` holds the rule.

R2 key rotation = each device types its new keys; a 401/403 on a device asks for them. One R2 API token
per device is advised, so revoking a lost device's token does not touch the others. The PC's Add a phone
QR carries the PC's own token; to give the phone its own, create a second token and type it on the phone
instead of scanning. R2 tokens are per bucket, not per folder: any token can write every device's
snapshots.

### 3.9 Sync loop rules

- One sync at a time, mutually exclusive with a restore and a master password change.
- Download and decrypt happen off the session; the commit is synchronous: it re-checks that the session
  is the same one (a generation counter bumped on every open, restore and re-key), merges the remote
  into the current vault (not the copy taken before the download) and saves. Session changed or locked:
  the result is discarded and the next unlock syncs. A save during a download is never lost.
- Sync's own save never triggers sync. A merge whose canonical shared-state hash equals the pre-merge
  hash writes nothing and uploads nothing.
- Unlock never waits on sync; sync runs after unlock.
- **Mass-change gate** (`core/sync/review.js`): a merge that would delete more than 5 items (a move to the
  Trash counts as a delete, and the review lists it with them), or more than
  10% of entries when that is 3 or more, change secret groups on more than 20 items, replace the vault
  with a restored epoch, adopt a new key, or remove THIS device from sync (reason `removed`: after it this
  device syncs no more) shows a review ("<device> wants to delete 143 items") before it commits. The gate judges one merge at a time. It catches a bug or a mistake that would empty a
  vault. It is not a defence against a device that holds the vault key: such a device can stay under
  the limits on every sync.
- **Remove from sync** (PC, Sync sheet): sets `devices[id].revokedAt`; snapshots in that device's folder
  are never merged again. That is all it does. It is not a lock-out: a lost device that still holds the
  vault key (the master password is unchanged) and the R2 token can write a snapshot under a new install
  id, and it opens and merges like any unknown device's. What locks it out is two steps, which the Sync
  sheet walks the user through straight after the removal: (1) change the master password (a new key;
  the Change master password form is shown in the card), and (2) replace the R2 API token (the old one
  can still write to the bucket; Cloudflare, then Settings > Backup > Cloud backup > Disconnect and
  Connect). The status carries `lockOut`: every removed device with no key in `sync.keys` newer than its
  `revokedAt`. The Sync sheet shows a "Finish locking out <device>" card and the sync line shows the same
  words until the master password has changed after the removal. The R2 token step cannot be seen from
  the vault, so the card only states it. The phone has no remove-device screen.
- **Removed, and back** (PC, `electron/sync.cjs` `rejoin`): a removal is never lifted - the earliest
  `revokedAt` stands on every device. A device that learns from a merge that it was removed shows that
  merge as a review first (reason `removed`), so anyone holding the vault key cannot switch a device off
  unseen; after Apply, sync is off on it ("This device was removed from sync"). The way back for a device
  the owner trusts again: Join again with the vault's own master password (proven on the vault file
  through the unlock throttle), typed in the Join again card the Sync sheet shows on a removed PC. The device takes a new install id, the old id stays removed everywhere,
  and the new one joins like any new device. If the owner locked out with a new master password since, the
  device then asks for "the master password set on <device>" (3.6) and adopts it after a review. This gives
  a removed device nothing it lacked before (with the key and the bucket token it could always write under
  a new id); only a new master password locks a device out. Its old folder is no longer thinned out by it.
  The phone shows the same review but has no Join again yet: a removed phone stays removed. The phone's biometric
  prompt uses `BIOMETRIC_STRONG` with a CryptoObject, no device-credential fallback.
- The Sync sheet shows a check code on every device: the first 8 hex of the SHA-256 of the canonical
  shared state. After Sync now on each device, the codes match.
- The trust page says that the app downloads its own snapshots automatically, including under Air Wall
  (the courier's curl carries downloads as it carries uploads).

### 3.10 Why the design looks like this

| Choice | What goes wrong without it |
|---|---|
| Per-group dotted version vectors instead of one timestamp per item | One edit per item carries no causality: a sequential edit on two devices looks like a conflict, and a real conflict drops half of what was typed (a password change wipes a same-day 2FA change). |
| Deterministic conflict-copy ids, a pure merge | Two devices resolving the same conflict make two different copies, then copies of copies. |
| Stamping by diff in one place; `lastUsedAt` unversioned; a no-op merge writes nothing | Copying a password would make a stale item "newer" than a real edit elsewhere, and devices would trigger each other's uploads in a loop that pushes real history out of retention. |
| HLC with a 24-hour future cap; R2 `LastModified` picks the newest | A phone whose clock says 2030 would win every later conflict and keep its frozen snapshot "newest" for years. |
| Restore pauses sync and asks; `vaultId` lineage; epochs | The next sync would undo a restore (the peer's newer deletes win again), and an unrelated vault could be merged in. |
| Session-key decrypt, `sync.keys` history, adopt-remote-salt flow | After a master password change, a device unlocked by fingerprint holds a key, not a password, and could open nothing. |
| Metadata and tombstones outside `entries`; tombstones kept; repair on open | Every reader that lists entries would have to skip tombstone rows, and an older app version would delete without a tombstone, bringing items back. |
| `cloud` and `olderBackupsPending` device-local | Rotating the R2 token on one device would overwrite the other's working keys, and Disconnect on one would turn backup off on both. |
| Removed kinds (`due`, `payee`) become notes on every read, local and remote | A device still on an older version can sync one back. Every reader converts it the same way, so the note is the same item everywhere. |

### 3.11 Checks behind the design

- **The Forever Opener reads a vault with `sync`** exactly as it reads the same vault without it
  (`electron/opener-sync.test.cjs`).
- **Metadata size:** `scripts/sync-size-check.mjs` builds a busy vault through the real stamping and
  reports how much `sync` adds. Tombstones are kept forever in v1.
- **scrypt on a phone:** one N = 2^17 derivation in the WebView, measured at 533-656 ms in the emulator
  (`mobile/README.md`, Prove it). No native plugin.
- **R2 `LastModified`** comes back per key in a listing (`core/r2.js`, used by both apps).
- **Merge properties** hold over 10,000 random 3-device histories with skewed clocks (`core/sync/merge.test.js`).

### 3.12 Tests

- `core/sync/merge.test.js`: property tests, seeded and replayable (`MERGE_SEED`, `MERGE_RUNS`): merge is
  commutative and idempotent; associative outside kept losers and record-less removals; devices converge
  after pairwise syncs in any order. Plus example tests per rule in the table above.
- `core/sync/*.test.js`: stamping and repair, the clock, snapshot selection and pruning, the review gate,
  the sync run. `core/sync/hlc-groups.test.js` covers the clock and the field groups both apps share.
- `electron/sync.test.cjs` and `mobile/src/app/host/sync.test.mjs`: the PC and phone sync loops,
  including planted snapshots, key adoption, revoke and lock-out. The phone's test runs the PC's real
  session, backup and sync code as the other device.
- `scripts/e2e-sync.cjs` (PC window against a fake R2) and `mobile/src/app/host/test/two-device.mjs`
  (the PC code against the headless emulator).

## Protect the bucket

Anyone holding a write key can delete or flood objects in the bucket. The snapshots are encrypted, so
this is about availability and integrity, not secrecy.

- **Scope the token:** create the R2 API token with **Object Read & Write** and select this one bucket
  (not Admin, not all buckets). Use one token per device.
- **Lock the snapshots:** in the bucket's Settings, under **Bucket lock rules**, add a rule on the prefix
  `kapevault/snapshots/` with a retention of 30 days. Locked objects cannot be deleted or overwritten
  until then, so a stolen key cannot wipe recent snapshots. The app's routine thinning of old snapshots
  is refused inside that window; the backup still goes up and the extra snapshots stay. "Delete older
  backups" after a master password change deletes what it can and says how many old-password snapshots
  stay until their lock runs out.
- **Keep the folder copy:** the copy folder on your own disk is the offline fallback if the bucket is ever
  emptied or the account is lost.
