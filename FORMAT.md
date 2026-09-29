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
| `version` | `1`. Anything else is refused. |
| `kdf` | scrypt settings for this file. Written as N = 2^17, r = 8, p = 1 with a random 16-byte salt. |
| `iv` | AES-GCM nonce, 12 random bytes, new on every save. |
| `tag` | AES-GCM authentication tag, 16 bytes. |
| `data` | The encrypted vault JSON. |

Before any key derivation a reader must check the header (`checkVaultFile`): a known `format`,
`version` 1, `kdf.name` `"scrypt"`, N exactly 2^17, r exactly 8, p exactly 1, and salt, iv and tag
as canonical base64 (padded, no other characters, re-encoding gives the same text) decoding to 16,
12 and 16 bytes. The settings come from the file, so without this a planted file (p = 2^20) would
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

## The decrypted JSON

```json
{
  "spaces": [{ "id": "<uuid>", "name": "Personal", "kind": "personal" }],
  "entries": [{ "id": "<uuid>", "spaceId": "<uuid>", "kind": "login", "title": "...", "...": "..." }],
  "cloud": { "endpoint": "...", "bucket": "...", "accessKeyId": "...", "secretAccessKey": "...", "auto": true },
  "olderBackupsPending": true
}
```

- `spaces`: `kind` is `"personal"` (one) or `"client"`.
- `entries`: every item has `id`, `spaceId`, `kind`, `title`, `tags`, `favorite`, `notes`,
  `updatedAt` (YYYY-MM-DD, local), and may have `brand`, `lastUsedAt` (ms since 1970) and `heldFor`
  (the name of the person the item is kept for, e.g. `"Mama"`; missing = the owner's own). Per kind:
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
  - `payee`: `who`, `relation`, `provider` (a name: `GCash`, `BDO`, or any other), `number` (digits
    only; a PH mobile typed with +63 is saved as `09...`), `accountName`, `confirmedAt` (YYYY-MM-DD,
    the day the number was confirmed by a phone call).
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
    `electron/due-to-note.cjs`). The Forever Opener still reads an old `due` item directly (schedule,
    agency, receipts) - it is a separate, standalone page and does not run the conversion.
  Newer versions add kinds and optional fields; a reader should show fields it does not know.
- `sync` (optional, since sync-ready data): version vectors, tombstones and key history for PC <-> phone
  sync (SYNC.md 3.1). Content-free: no item's fields or secrets. `spaces` and `entries` are unchanged by
  it; readers that do not sync ignore it. Every other top-level field (`cloud`, `olderBackupsPending`)
  belongs to the device that wrote it.
- `cloud` (optional): the R2 bucket and API token for cloud backup - the secret lives only here.
- `olderBackupsPending` (optional): after a master password change, older cloud snapshots still open
  with the old password until "Delete older backups" runs.
- `syncLog` (optional): this device's last 50 sync results; never merged, ignored by the Opener.
- `keySalt` (optional, since 2026-09-29): the header's `kdf.salt` as last proven by a master password
  (every open that derives the key from the password marks it). A key-only unlock (Windows Hello,
  Touch ID, a fingerprint) is refused when the header's salt differs, because the tag does not cover
  the header: an edited salt would otherwise be saved back and lock the master password out.

Every reader in the app treats the decrypted JSON as untrusted (`core/clean-vault.js`, run inside
decryption on the PC and the phone): an item's known field of the wrong type is dropped, a `photo`
that is not a JPEG data URL is dropped, items with a missing, reserved or repeated `id` are dropped,
and a vault nested deeper than 24 levels is refused. Unknown fields and kinds are kept.

## Cloud backup names (Cloudflare R2)

- Snapshots: `kapevault/snapshots/<install id>/<UTC time>[-before-restore].kapevault`, the time
  written as `2026-09-25T07-15-02-123Z`. Each is the vault file above, byte for byte. Older
  snapshots may have no `<install id>/` folder, and pre-rename ones live under
  `bovault/snapshots/...bovault`; both still list and restore.
- The Forever Opener, once per app version: `kapevault/opener/kapevault-opener-<version>.html`.
  It holds no vault data, and snapshot listing, thinning and restore never match it.
