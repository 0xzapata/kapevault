# KAPEVault vault file format

One page, so a vault stays readable if KAPEVault is ever gone. The code is the authority:
`electron/vault-crypto.cjs` (write, read), `core/vault-format.js` (`checkVaultFile`), `electron/vault-session.cjs` (the
decrypted data), `core/sync/snapshots.js` (R2 names). `KAPEVault Opener.html` (the Forever
Opener, `electron/opener/`) implements this page in a browser.

## The file

`vault.kapevault` (in `%APPDATA%\KAPEVault`, or any saved copy) is UTF-8 JSON:

```json
{
  "format": "kapevault",
  "version": 1,
  "kdf": { "name": "scrypt", "N": 131072, "r": 8, "p": 1, "salt": "<base64, 16 bytes>" },
  "iv": "<base64, 12 bytes>",
  "tag": "<base64, 16 bytes>",
  "data": "<base64 ciphertext>"
}
```

| Field | Meaning |
|---|---|
| `format` | `"kapevault"`. `"bovault"` is the same format written before the rename (2026-09-26) and still opens. |
| `version` | `1`. A number above 1 is a newer file and is refused as such (Newer files, below); anything else is refused as damaged. |
| `kdf` | scrypt settings for this file. Written as N = 2^17, r = 8, p = 1 with a random 16-byte salt. |
| `iv` | AES-GCM nonce, 12 random bytes, new on every save. |
| `tag` | AES-GCM authentication tag, 16 bytes. |
| `data` | The encrypted vault JSON. |

Before any key derivation a reader must check the header (`checkVaultFile`): a known `format`,
`version` 1 (a newer one is told apart first), `kdf.name` `"scrypt"`, N exactly 2^17, r exactly 8, p exactly 1, and salt, iv, tag and
data as canonical base64 (padded, no other characters, re-encoding gives the same text), with salt,
iv and tag decoding to 16, 12 and 16 bytes. The settings come from the file, so without this a planted file (p = 2^20) would
make unlocking run for hours. (Before 2026-09-29 readers took N from 2^14 to 2^17; KAPEVault has
only ever written 2^17.) The header is NOT covered by the tag - see `keySalt` below.

## Key and cipher

1. `key = scrypt(password, salt, N, r, p, 32 bytes)`, where `password` is the master password
   normalised to Unicode NFC and encoded as UTF-8.
2. `plaintext = AES-256-GCM-decrypt(key, iv, data, tag)`. A wrong password and an altered file both
   fail the tag check - there is no other password check. (WebCrypto wants `data || tag` as one buffer.)
3. `plaintext` is UTF-8 JSON (below).

The whole vault is one ciphertext; every save rewrites the file atomically (`.tmp`, fsync, rename)
with a new IV under the same key. A master password change makes a new salt and key.

Why scrypt and not Argon2id, the plan for raising the KDF settings later, and why there is one key and
no separate data key: [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md#cryptography-choices).

## The decrypted JSON

```json
{
  "spaces": [{ "id": "<uuid>", "name": "Personal", "kind": "personal" }],
  "entries": [{ "id": "<uuid>", "spaceId": "<uuid>", "kind": "login", "title": "...", "...": "..." }],
  "minReader": 1,
  "cloud": { "endpoint": "...", "bucket": "...", "accessKeyId": "...", "secretAccessKey": "...", "auto": true },
  "olderBackupsPending": true
}
```

- `spaces`: `kind` is `"personal"` (one) or `"client"`. Optional `photo`: a JPEG data URL of at most 32 KB
  shown in place of the space's initials (a larger or non-JPEG one is dropped when the vault opens).
- `entries`: every item has `id`, `spaceId`, `kind`, `title`, `tags`, `favorite`, `notes`,
  `updatedAt` (YYYY-MM-DD, local), and may have `brand`, `lastUsedAt` (ms since 1970), `heldFor`
  (the name of the person the item is kept for, e.g. `"Mama"`; missing = the owner's own) and
  `trashedAt` (since 2026-10-04: a UTC ISO timestamp, e.g. `"2026-10-04T03:12:09.000Z"`; the item was
  deleted and sits in the Trash, with every field intact. Missing = a normal item. KAPEVault removes it
  for good 30 days after `trashedAt`. A reader that lists items should leave a trashed one out. An
  older KAPEVault does not know the field: it keeps it but shows the item as a normal one, and an edit
  there takes it out of the Trash). Per kind:
  - `login`: `username`, `password`, `url`, `signIn` (`password`, `google`, `microsoft`, `apple`,
    `github`, `facebook`, `email-link`, `sso`), `viaEntryId`, `totp` (an `otpauth://` URI),
    `history` (`[{ password, changedAt }]`, newest first, up to 10; `changedAt` a UTC ISO timestamp, a local YYYY-MM-DD in rows from before 2026-09-28), `passwordChangedAt` (YYYY-MM-DD),
    `recoveryCodes` (backup codes: `{ codes: [{ code, used }], setAt, paper: [{ where, printedAt,
    outdatedAt }] }` - 4 to 20 codes, each as the site printed it; `setAt`, `printedAt` and
    `outdatedAt` are YYYY-MM-DD; `outdatedAt` is set on a paper copy when a new set replaced its codes),
    `questions` (security questions: `[{ question, answer }]`, up to 10; the answer is a secret and is
    often made up on purpose), `lifecycle` (closing the account on purpose: `{ state, requestedAt,
    followUpAt, goneAt }`, `state` one of `dormant`, `deletion-requested` (an erasure request sent on
    `requestedAt`, follow up on `followUpAt`, 30 days on) or `gone`; dates YYYY-MM-DD; missing = in
    use). A `gone` login is a tombstone: every secret was wiped and only `id`, `spaceId`, `kind`,
    `title`, `url`, `username`, `brand`, `notes`, `updatedAt` and `lifecycle` (with `goneAt`) remain.
  - `note`: `body`.
  - `key`: `keyId`, `secret`, `url`, `expires` (YYYY-MM-DD).
  - `link`: `linkType` (`web`, `drive`, `folder`, `doc`), `location` (a URL or a local path).
  - `thing`: a physical thing and where it is kept - `room` (optional, e.g. `"Bedroom"`), `spot`
    (the exact place), `grab` (`1` grab first, `2` if there is time, `3` leave it), `expires`
    (YYYY-MM-DD, optional - an ID's expiry, e.g. a passport or driver's license).
  - `device`: a router, CCTV box, phone or laptop and what its sticker says - `type` (`router`,
    `cctv`, `phone`, `laptop`, `other`), and optionally `model`, `serial`, `imei` (15 digits, the last
    a Luhn check digit), `mac` (`AA:BB:CC:DD:EE:FF`), `adminUrl` (a URL or a bare address such as
    `192.168.1.1`, opened over http), `adminUser`, `adminPassword`, `ssid` (the Wi-Fi name),
    `wifiPassword` and `photo` (the label photo: a `data:image/jpeg;base64,...` URL, at most 150 KB of
    JPEG). The two passwords and the photo are secrets; the photo shows what the passwords are.
  - `id`: an identity card - `idType` (its name: one of `Passport`, `Driver's license`,
    `National ID (PhilSys)`, `UMID`, `SSS`, `PhilHealth`, `Pag-IBIG`, `TIN`, `Postal ID`,
    `Voter's ID`, `PRC license`, `Senior citizen`, `PWD`, `Student ID`, `Company ID`, or any other
    name, up to 60 characters), and optionally `idNumber` (as printed, up to 64 characters) and `photo`
    (a `data:image/jpeg;base64,...` URL, at most 150 KB of JPEG, like a device's). The number and the
    photo are secrets. Photos of every item share one 16 MB budget.
  - `due` (removed 2026-09-26): read only, converted to a note on open (`dueToNotes`,
    `core/due-to-note.js`). The Forever Opener still reads an old `due` item directly (schedule,
    agency, receipts) - it is a separate, standalone page and does not run the conversion.
  - `payee` (removed 2026-10-09): `who`, `relation`, `provider`, `number`, `accountName`, `confirmedAt`
    (YYYY-MM-DD). Read only, converted to a note on open (`payeeToNotes`, `core/payee-to-note.js`): the
    same id, title, space, tags, `heldFor`, `favorite` and dates; `body` holds one line per field that
    had a value (`Name:`, `Relation:`, `Wallet or bank:`, `Number:`, `Account name:`, `Confirmed:`),
    then a blank line and the item's `notes`, which become empty (a note shows no notes field). The
    number is part of the secret body now. The Forever Opener still reads an old `payee` item directly.
  Newer versions add kinds and optional fields; a reader should show fields it does not know.
- `sync` (optional, since sync-ready data): version vectors, tombstones and key history for PC <-> phone
  sync (SYNC.md 3.1). Content-free: no item's fields or secrets. `spaces` and `entries` are unchanged by
  it; readers that do not sync ignore it. Every other top-level field (`cloud`, `olderBackupsPending`)
  belongs to the device that wrote it.
- `minReader` (since 2026-10-09): the oldest reader version that may open this data (`READER_VERSION`, 1
  today). Every save writes it. A vault without one is read as 1. See Newer files below.
- `cloud` (optional): the R2 bucket and API token for cloud backup - the secret lives only here.
- `olderBackupsPending` (optional): after a master password change, older cloud snapshots still open
  with the old password until "Delete older backups" runs.
- `syncLog` (optional): this device's last 50 sync results; never merged, ignored by the Opener.
- `genHistory` (optional, since 2026-10-09): the password generator's recent values, `[{ value, at }]`,
  newest first. A value is recorded when it leaves the generator (copied, or put into a form field),
  before the item is saved, so a lock that throws the open form away cannot lose a password already
  pasted into a site. `value` is the generated text (a secret, up to 256 characters); `at` is a UTC ISO
  timestamp. At most 20 rows, and a row older than 90 days is dropped at the next save; the same value is
  one row, with its first time. A reader that lists items may show it as one more masked item (the
  Forever Opener does). It belongs to the device that wrote it and is never merged (SYNC.md 3.8).
- `keySalt` (optional, since 2026-09-29): the header's `kdf.salt` as last proven by a master password
  (every open that derives the key from the password marks it). A key-only unlock (Windows Hello,
  Touch ID, a fingerprint) is refused when the header's salt differs, because the tag does not cover
  the header: an edited salt would otherwise be saved back and lock the master password out.

Every reader in the app treats the decrypted JSON as untrusted (`core/clean-vault.js`, run inside
decryption on the PC and the phone): an item's known field of the wrong type is dropped, a `photo`
that is not a JPEG data URL is dropped, items with a missing, reserved or repeated `id` are dropped,
and a vault nested deeper than 24 levels is refused. Unknown fields and kinds are kept.

## Newer files and the forward policy

Two numbers say what a reader must understand: the header `version` (the file's outer shape and KDF)
and `minReader` (the decrypted data's shape, below). `core/vault-format.js` exports `READER_VERSION`
(1 today) and `NewerVaultError`.

A reader refuses, with "This vault was saved by a newer KAPEVault. Update this app to open it.", a vault
whose header `version` is a number above 1, whose `minReader` is an integer above its `READER_VERSION`, or
whose `sync.v` is a number above its own (SYNC.md 3.2). It never repairs such a vault, never replaces its
`sync` object with a new one and never saves over it, so an old app cannot quietly drop what a newer one
added. A snapshot like that in the cloud (its `minReader` or `sync.v`, read after it decrypts with the vault
key) is skipped by sync and the device that wrote it is named in the sync status. A header that only claims a
newer `version` is treated as unreadable, never as a newer device. Missing or malformed values keep the old behaviour (repair, or a new `sync` object).

Policy for raising the KDF or changing the format later:

- A stronger KDF ships as a **new header `version`** with its own exact parameter set. Version 1 keeps
  its exact settings (N = 2^17, r = 8, p = 1) forever: that exact check is what stops a planted file
  from making unlock run for hours, so it is never loosened to a range.
- The version is read before the KDF settings, so an old reader says "newer", not "damaged", for a file
  whose parameters it does not know.
- A change to the decrypted data that an old reader would break on raises `minReader`. Writers stamp the
  lowest `minReader` the data needs; today every writer stamps `1`.
- A reader keeps opening every older version. The frozen files in `core/fixtures/` (README there) are
  tests of it and must never be regenerated.

## Known-answer test vector

This is a real vault file (`core/fixtures/vault-v1.kapevault`, written by the app on 2026-10-09 with
mock data). Master password: `mock kettle harbor pass orbit gazelle`. Derive the key as above, decrypt with
AES-256-GCM, and the plaintext must equal `core/fixtures/vault-v1.expected.json` exactly. The PC, the
phone and the Forever Opener each have a test that does this (`electron/golden-vault.test.cjs`,
`mobile/src/app/host/golden-vault.test.mjs`); a reader that cannot open it cannot open a real vault.
Two older files written by earlier commits sit beside it (`bovault-pre-rename.bovault`,
`vault-pre-sync-due.kapevault`).

```json
{"format":"kapevault","version":1,"kdf":{"name":"scrypt","N":131072,"r":8,"p":1,"salt":"6mfeCJYhepjU17uQsc9UiA=="},"iv":"8A3gJDkDC+mlucJK","tag":"PQmbZ8j/iwHtwBDRqmskAQ==","data":"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"}
```

## Cloud backup names (Cloudflare R2)

- Snapshots: `kapevault/snapshots/<install id>/<UTC time>[-before-restore|-backup-only].kapevault`,
  the time written as `2026-09-25T07-15-02-123Z` (`-backup-only`: a phone without KAPEVault Pro,
  restorable but never merged). Each is the vault file above, byte for byte. Older
  snapshots may have no `<install id>/` folder, and pre-rename ones live under
  `bovault/snapshots/...bovault`; both still list and restore.
- The Forever Opener, once per app version: `kapevault/opener/kapevault-opener-<version>.html`.
  It holds no vault data, and snapshot listing, thinning and restore never match it. A copy of the
  Opener beside a saved vault copy is trusted by its bytes only: a page that is not this app version's exact
  bytes is replaced, whatever version it claims, and any other file by that name is first renamed aside
  with `.txt` added. Settings > Backup > Check my Opener compares the one in the linked folder with the
  app's own.
