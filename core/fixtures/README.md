# Golden vault files

These files are real ciphertext, frozen. **Never regenerate or edit them.** If a test here fails, the
reader changed in a way that would lock out every vault already written: fix the reader, not the file.

Master password for all three (mock, nothing real is in them): `mock kettle harbor pass orbit gazelle`

| File | Written by | What it covers |
|---|---|---|
| `vault-v1.kapevault` | the writer at `3cf3afb` (2026-10-09), `electron/vault-session.cjs` | The current format: `kapevault` header, `sync` object with stamps and a key history, `keySalt`, `minReader`, a password history, a 2FA key, a payee (opens as a note: `payeeToNotes`), an item in the Trash, non-ASCII text. This is the known-answer vector in FORMAT.md. |
| `bovault-pre-rename.bovault` | the writer at `0efe5c8^` (2026-09-26, the commit before the rename), run unchanged | The `bovault` header name, no `sync`, no `keySalt`: opens, and gets its sync object and `keySalt` on open. |
| `vault-pre-sync-due.kapevault` | the writer at `2487e12^` (2026-09-26, before Due Dates were removed), run unchanged | A `due` item with a receipt and no `sync`: opens as a note (`dueToNotes`) and is repaired. |

Each file has an `.expected.json` beside it: the decrypted JSON, produced by a second decrypt that uses
only `node:crypto`. The PC (`electron/vault-crypto.cjs`), the phone (`mobile/src/app/host/vault-file.ts`)
and the Forever Opener (`electron/opener/opener-crypto.cjs`) must each give back exactly that JSON.

Tests: `electron/golden-vault.test.cjs` and `mobile/src/app/host/golden-vault.test.mjs`.

After a release, add one frozen vault per shipped format change here and to both tests.
