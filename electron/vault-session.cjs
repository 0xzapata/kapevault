// The unlocked vault lives here, in the main process. The renderer only ever gets publicView():
// secrets (passwords, 2FA keys, secure note bodies, API key secrets, old passwords, backup codes,
// security question answers, a device's admin and Wi-Fi passwords and label photo, an ID's number and
// photo) are stripped and handed out one at a time through getSecret() (the backup code grid:
// getRecoveryCodes()).
// The vault's data rules live in core/ (shared with the phone); this file is the PC's host around
// them: the key, the file on disk, and the steps that need Node.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const core = require("../core/index.js");
const { createKey, openFile, openFileWithKey, encryptWithKey, parseVaultFile, MAX_VAULT_BYTES } = require("./vault-crypto.cjs");
const { totpCode } = require("./totp.cjs");
const { isInside, isNetworkPath } = require("./file-access.cjs");
const { GRAB_NAMES } = require("./evacuation.cjs");
const { writeFileAtomic } = require("./atomic-write.cjs");

const TOO_BIG = "The vault would be too big to back up (over 64 MB), so this was not saved. Remove some photos or long notes first.";
const SIGN_IN_NAMES = { google: "Google", microsoft: "Microsoft", apple: "Apple", github: "GitHub", facebook: "Facebook", "email-link": "Email link", sso: "SSO" };
const DEVICE_NAMES = { router: "Router", cctv: "CCTV / NVR", phone: "Phone", laptop: "Laptop", other: "Other" };

const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

// An import file can come from someone else: a drive or home folder would open far more to previews
// than anyone means to share. Core has already refused network folders by name, so this path is local.
function checkImportFolder(location, where) {
  if (tooWide(location)) throw new Error(`${where}: a whole drive or home folder cannot be imported. Link a folder inside it.`);
}

// A whole drive, the home folder or one of its parents: every file on it would open to previews and
// files:readText. Judged by the real path; only for paths already known not to be network paths.
// A value a name map does not name prints nothing (as before) - never an inherited member such as "constructor".
const named = (map, value) => (Object.hasOwn(map, value) ? map[value] : undefined);

function tooWide(location) {
  const real = path.isAbsolute(location) && realFolder(path.resolve(location));
  // isInside compares case-insensitively on Windows and also catches C:\Users (an ancestor of home).
  return Boolean(real) && (path.parse(real).root === real || isInside(real, realFolder(os.homedir())));
}

// Where a local path really leads, so a junction (C:\Documents and Settings) or an 8.3 short name
// (C:\Users\EXAMPL~1) is judged as the folder it opens. A path that does not exist yet is judged by
// its nearest existing parent. Only for paths already known not to be network paths.
function realFolder(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    const parent = path.dirname(p);
    return parent === p ? p : path.join(realFolder(parent), path.basename(p));
  }
}

// onPersist({ bySync }) runs after every write to disk that should reach the cloud backup; bySync:
// sync's own save, which must not start another sync.
// installId(): this install's id, which sync stamps changes with ("" when settings.json could not be
// read this run: nothing is stamped, and the next open's repair catches up).
function createVaultSession(filePath, { onPersist = () => {}, installId = () => "" } = {}) {
  let session = null; // { key, kdf, salt, data } while unlocked
  // session.data as last opened or saved. Changes replace its top-level fields (entries, spaces, cloud,
  // sync) and never edit them in place, so this shallow copy is the whole state a failed save goes back to.
  let saved = null;
  // For sync's commit: generation counts sessions (every open, restore and re-key starts one), revision
  // counts sessions and saves - a merge read at one revision may only be written at that revision.
  let generation = 0;
  let revision = 0;
  // Every salt each vault closed this run has had (vaultId -> Set), recorded as its session ends. An older
  // snapshot of a vault lists no master password set after it, yet a copy of the vault (the folder copy)
  // may be under one - after a restore from the lock screen too. Keyed by vaultId, so it never vouches
  // for another vault's file. Salts are not secret (every file header carries one).
  const seenSalts = new Map();

  const stampContext = () => ({ installId: installId(), now: Date.now(), sha256 });

  // Every session starts from a file just read or written. Any previous key is wiped first. Every
  // caller has proven the key belongs to this header's salt (a master password derived it, or
  // unlockWithKey checked keySalt first): core.openedVault marks it, opens due dates as notes and reads
  // and repairs the sync object.
  function start(opened) {
    lock();
    const data = core.openedVault(opened.data, opened.salt.toString("base64"), stampContext());
    session = { ...opened, data };
    saved = { ...session.data };
    generation++;
    revision++;
  }

  function requireOpen() {
    if (!session) throw new Error("Vault is locked");
    return session.data;
  }

  function findEntry(id) {
    return core.findEntry(requireOpen(), id);
  }

  // Write to a temp file, then swap it in - a crash never leaves half a vault. No .bak on purpose:
  // an old copy would still open with a changed master password and keep deleted secrets alive.
  // backup: false for bookkeeping only (recently used) - it is saved, but does not upload a snapshot.
  // Every save stamps what changed since the last one, here and nowhere else, so no change can reach
  // the disk unstamped. Stamping replaces `sync`, so a failed save rolls it back with the rest.
  // bySync: sync's own save writes the merged vault as it is - merge never stamps, and restamping it
  // as this device's edit would win conflicts it never took part in.
  function persist({ backup = true, bySync = false } = {}) {
    try {
      settleBeforeWrite();
      if (!bySync) session.data.sync = core.stamp(saved, session.data, stampContext());
      const contents = JSON.stringify(encryptWithKey(session.key, session.kdf, session.salt, session.data));
      // Bigger than any restore or the Forever Opener would read back: refused like a failed write.
      if (Buffer.byteLength(contents) > MAX_VAULT_BYTES) throw new Error(TOO_BIG);
      writeFileAtomic(filePath, contents);
    } catch (e) {
      // A change that did not reach the disk is dropped from memory too, so the page never shows it
      // and no later save carries it: a retried add is not doubled, a failed delete never happens later.
      session.data = { ...saved };
      throw e;
    }
    saved = { ...session.data };
    revision++;
    if (backup) onPersist({ bySync });
  }

  // --- Sync's side of the session: read, open a peer's snapshot, commit (sync.cjs runs the loop).

  function syncBase() {
    return { generation, revision, data: requireOpen() };
  }

  // A snapshot, opened with this session's key: no scrypt, no password (SYNC.md 3.5). otherKey: written
  // under another master password - behind when it is one this vault had before (that device has not
  // caught up yet). null: not a KAPEVault file, damaged, or made with another key on this salt.
  function openSnapshot(bytes) {
    requireOpen();
    const file = parseVaultFile(bytes);
    if (!file) return null;
    if (file.kdf.salt !== session.salt.toString("base64")) return { otherKey: true, behind: hadSalt(file.kdf.salt) };
    const opened = openFileWithKey(session.key, file);
    return opened ? { data: opened.data, salt: file.kdf.salt } : null;
  }

  // A file of this vault: made under its master password now or an earlier one. False for another
  // vault's file and for anything that is not a vault file.
  function ownsFile(bytes) {
    requireOpen();
    const file = parseVaultFile(bytes);
    return Boolean(file) && ownSalts().includes(file.kdf.salt);
  }

  // Every master password this vault has had: now, its key history, and any seen earlier this run.
  function ownSalts() {
    const { data, salt } = session;
    return [salt.toString("base64"), ...data.sync.keys.map((k) => k.salt), ...(seenSalts.get(data.sync.vaultId) ?? [])];
  }

  const hadSalt = (salt) => session.data.sync.keys.some((k) => k.salt === salt);

  // A snapshot under a master password this vault has not seen (SYNC.md 3.6), opened with that
  // password - scrypt with the snapshot's own settings, checked first. The caller runs it through the
  // unlock throttle: a wrong password is a guess.
  async function openWithPassword(bytes, master) {
    requireOpen();
    const file = parseVaultFile(bytes);
    if (!file) return { ok: false, damaged: true, error: "That backup cannot be opened." };
    const opened = await openFile(String(master), file);
    return opened ? { ok: true, opened } : { ok: false, error: "Wrong master password." };
  }

  // The merged vault replaces this one only while nothing was saved since the merge read it; written
  // as it is. False when the vault changed or locked meanwhile: nothing is written.
  // rekey: another device's master password is adopted with the merge (SYNC.md 3.6) - { key, kdf, salt }
  // from openWithPassword. The file is written under it before the session switches to it, as
  // changeMaster does, and this device's older backups are flagged. The session keeps that key; a
  // failed write wipes it.
  function commitSync(data, readAt, rekey = null) {
    if (!session || readAt !== revision) {
      rekey?.key.fill(0);
      return false;
    }
    if (!rekey) {
      session.data = data;
      persist({ bySync: true });
      return true;
    }
    const rekeyed = core.withKeySalt(data.cloud ? { ...data, olderBackupsPending: true } : data, rekey.salt.toString("base64"));
    try {
      settleBeforeWrite();
      const contents = JSON.stringify(encryptWithKey(rekey.key, rekey.kdf, rekey.salt, rekeyed));
      if (Buffer.byteLength(contents) > MAX_VAULT_BYTES) throw new Error(TOO_BIG);
      writeFileAtomic(filePath, contents);
    } catch (e) {
      rekey.key.fill(0);
      throw e;
    }
    start({ key: rekey.key, kdf: rekey.kdf, salt: rekey.salt, data: rekeyed });
    onPersist({ bySync: true });
    return true;
  }

  // "Make this the vault on all devices" after a restore (SYNC.md 3.7): a new epoch, saved and backed up
  // like any change. id: a fresh one for it.
  function startEpoch(id) {
    commit((data) => {
      data.sync = core.newEpoch(data.sync, { id, installId: installId(), now: Date.now() });
    });
  }

  // Another device removed from sync: its snapshots are never merged again, here or on any device this
  // reaches.
  function revokeDevice(id) {
    commit((data) => {
      data.sync = core.revokeDevice(data.sync, { id, installId: installId(), now: Date.now() });
    });
  }

  // Sync results kept on this device (never merged). In memory until the next write carries them.
  function keepSyncLog(log) {
    requireOpen().syncLog = log;
  }

  // One change core makes to the open vault, saved, then the page's new view.
  function commit(change) {
    change(requireOpen());
    persist();
    return publicView();
  }

  function publicView() {
    const data = requireOpen();
    return core.publicView(data, core.findIssues(data.entries, core.today(), sha256));
  }

  function status() {
    return { exists: fs.existsSync(filePath), unlocked: session !== null, path: filePath };
  }

  async function create(master) {
    if (fs.existsSync(filePath)) return { ok: false, error: "A vault already exists." };
    const problem = core.masterProblem(master);
    if (problem) return { ok: false, error: problem };
    start({ ...(await createKey(master)), data: core.newVaultData() });
    try {
      persist();
    } catch (e) {
      lock(); // not on disk, so not a vault
      throw e;
    }
    return { ok: true, vault: publicView() };
  }

  function readFile() {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  async function unlock(master) {
    const file = readFile();
    if (!file) return { ok: false, error: "The vault file is missing or damaged." };
    const opened = await openFile(master, file);
    if (!opened) return { ok: false, error: "Wrong master password." };
    const unmarked = !core.keySaltMatches(opened.data, file.kdf.salt);
    start(opened);
    // A vault from before keySalt (or one a key unlock refused) gets it on disk now, so the next
    // Windows Hello / Touch ID unlock works. A refused write only means the master is asked again.
    if (unmarked) {
      try {
        persist({ backup: false });
      } catch {
        // written with the next save
      }
    }
    return { ok: true, vault: publicView() };
  }

  // Windows Hello hands back the vault key itself. A key that no longer fits (the vault was restored
  // or re-keyed elsewhere) fails like a wrong password; the caller turns Hello off.
  function unlockWithKey(key) {
    const file = readFile();
    let opened = null;
    try {
      opened = file && openFileWithKey(key, file);
    } catch {
      opened = null;
    }
    if (!opened) {
      key.fill(0);
      return { ok: false, error: "The vault file is missing or damaged." };
    }
    // The key opens the data, but the header's salt may have been edited (it is not covered by the
    // tag): saving now would write a header the master password no longer opens. masterRequired:
    // the key still fits, so the caller keeps Hello on and asks for the master password.
    if (!core.keySaltMatches(opened.data, file.kdf.salt)) {
      key.fill(0);
      return { ok: false, masterRequired: true, error: "Enter your master password to unlock this time." };
    }
    start(opened);
    return { ok: true, vault: publicView() };
  }

  function lock() {
    if (session) {
      seenSalts.set(session.data.sync.vaultId, new Set(ownSalts()));
      session.key.fill(0);
    }
    session = null;
    saved = null;
  }

  // A copy of the live key for Windows Hello to wrap. The caller zeroes it when done.
  function keyCopy() {
    requireOpen();
    return Buffer.from(session.key);
  }

  // A folder link typed by hand follows the import's rule (audit finding L5, SECURITY-AUDIT-2026-09-28.md):
  // never a whole drive or the home folder. A network folder stays allowed - it lists only after a
  // click. A link saved before this rule keeps working until its folder is changed.
  function saveEntry(input) {
    const stored = requireOpen().entries.find((e) => e.id === input?.id);
    const location = core.cleanText(input?.location);
    if (input?.kind === "link" && input.linkType === "folder" && location !== stored?.location) {
      // \\?\C:\Users\me and \\.\C: are this PC's own disk under a network-looking prefix, and
      // \\localhost\C$ (or any X$ admin share) is a whole drive: refused by name, before any disk call.
      if (/^[\\/]{2}[?.][\\/]/.test(location) || /^[\\/]{2}(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)([\\/]|$)/i.test(location) || /^[\\/]{2}[^\\/]+[\\/][a-z]\$([\\/]|$)/i.test(location)) {
        throw new Error("Use a normal folder path, like C:\\Users\\you\\Documents\\Clients.");
      }
      if (!isNetworkPath(location) && tooWide(location)) throw new Error("A whole drive or your home folder cannot be linked. Link a folder inside it.");
    }
    const id = core.upsertEntry(requireOpen(), input);
    persist();
    return { vault: publicView(), id };
  }

  // Bulk add from an import file (core's importEntries: all or nothing). A failed write rolls memory
  // back in persist.
  function importEntries(file) {
    const result = core.importEntries(requireOpen(), file, checkImportFolder);
    persist();
    return { ...result, vault: publicView() };
  }

  function deleteEntry(id) {
    return commit((data) => core.removeEntries(data, new Set([id])));
  }

  function toggleFavorite(id) {
    return commit((data) => core.toggleFavorite(data, id));
  }

  function moveEntry(id, spaceId) {
    return commit((data) => core.moveEntry(data, id, spaceId));
  }

  function confirmPayee(id, number) {
    return commit((data) => core.confirmPayee(data, id, number));
  }

  function setRecoveryCodes(id, codes) {
    return commit((data) => core.setRecoveryCodes(data, id, codes));
  }

  function markRecoveryCode(id, index, used) {
    return commit((data) => core.markRecoveryCode(data, id, index, used));
  }

  function addPaperCopy(id, where, printedAt) {
    return commit((data) => core.addPaperCopy(data, id, where, printedAt));
  }

  function removePaperCopy(id, index) {
    return commit((data) => core.removePaperCopy(data, id, index));
  }

  function setLifecycle(id, state) {
    return commit((data) => core.setLifecycle(data, id, state));
  }

  function confirmGone(id, clearNotes) {
    return commit((data) => core.confirmGone(data, id, clearNotes));
  }

  function followUpsDue() {
    return session ? core.followUpsDue(session.data) : 0;
  }

  function getRecoveryCodes(id) {
    return core.listRecoveryCodes(requireOpen(), id);
  }

  // Using an item feeds "Recently used". Saved without a backup upload: it is bookkeeping.
  function touch(id) {
    if (!core.touchEntry(requireOpen(), id)) return publicView();
    persist({ backup: false });
    return publicView();
  }

  function addSpace(name) {
    const id = core.addSpace(requireOpen(), name);
    persist();
    return { vault: publicView(), id };
  }

  function renameSpace(id, name) {
    return commit((data) => core.renameSpace(data, id, name));
  }

  function deleteSpace(id, moveToId) {
    return commit((data) => core.deleteSpace(data, id, moveToId));
  }

  // Folders saved as file links - the only places the file browser may read. Empty while locked.
  function linkedFolders() {
    if (!session) return [];
    return session.data.entries.filter((e) => e.kind === "link" && e.linkType === "folder" && path.isAbsolute(e.location)).map((e) => e.location);
  }

  // What "Open" opens for an item: a file link's location, a login's / API key's website, or a
  // device's admin page. A website saved without a scheme ("google.com") is a website, never a path
  // on this PC; a device's bare address (192.168.1.1) is http, as routers serve their admin page.
  function openTarget(id) {
    const entry = findEntry(String(id));
    const raw = core.cleanText(entry.kind === "link" ? entry.location : entry.kind === "device" ? entry.adminUrl : entry.kind === "note" ? "" : entry.url);
    if (!raw) throw new Error("This item has no link");
    // A path from either OS stays a path: a Windows folder link opened on a Mac is not a website.
    if (entry.kind === "link" && (path.win32.isAbsolute(raw) || path.posix.isAbsolute(raw))) return { kind: "path", target: raw };
    const url = /^[a-z][a-z0-9+.-]+:/i.test(raw) ? raw : `${entry.kind === "device" ? "http" : "https"}://${raw}`;
    return { kind: "url", target: url };
  }

  // "Hand back": every item kept for one person (heldFor, any case), as label/value rows for the
  // printout. Secrets are read only when the page's tick box asked for them.
  function handBack(person, withSecrets) {
    const data = requireOpen();
    const name = core.cleanText(person).toLowerCase();
    const entries = data.entries.filter((e) => name && core.cleanText(e.heldFor).toLowerCase() === name);
    if (!entries.length) throw new Error("Nothing is held for that person");
    const spaceName = (id) => data.spaces.find((s) => s.id === id)?.name ?? "";
    const items = [...entries]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((e) => {
        const rows = [];
        const add = (label, value, secret = false) => {
          if (value && (withSecrets || !secret)) rows.push({ label, value, secret });
        };
        if (e.kind === "login") {
          add("Website", e.url);
          add("Signs in with", named(SIGN_IN_NAMES, e.signIn));
          add("Username", e.username);
          add("Password", e.password, true);
          add("2FA setup key", withSecrets && e.totp ? core.parseTotp(e.totp).secret : "", true);
          add("Backup codes", (e.recoveryCodes?.codes ?? []).filter((c) => !c.used).map((c) => c.code).join("\n"), true);
          for (const q of e.questions ?? []) {
            add("Security question", q.question);
            add("Answer", q.answer, true);
          }
        } else if (e.kind === "key") {
          add("Website", e.url);
          add("Key ID", e.keyId);
          add("Secret", e.secret, true);
        } else if (e.kind === "link") {
          add("Location", e.location);
        } else if (e.kind === "note") {
          add("Note", e.body, true);
        } else if (e.kind === "payee") {
          add("Provider", e.provider);
          add("Number", e.number);
          add("Account name", e.accountName);
        } else if (e.kind === "thing") {
          add("Room", e.room);
          add("Where", e.spot);
          add("In a hurry", named(GRAB_NAMES, e.grab));
          add("Expires", e.expires);
        } else if (e.kind === "device") {
          add("Type", named(DEVICE_NAMES, e.type));
          add("Model", e.model);
          add("Serial number", e.serial);
          add("IMEI", e.imei);
          add("MAC address", e.mac);
          add("Admin page", e.adminUrl);
          add("Admin username", e.adminUser);
          add("Admin password", e.adminPassword, true);
          add("Wi-Fi name", e.ssid);
          add("Wi-Fi password", e.wifiPassword, true);
        } else if (e.kind === "id") {
          add("ID", e.idType);
          add("ID number", e.idNumber, true);
        }
        add("Notes", e.notes);
        return { title: e.title, space: spaceName(e.spaceId), rows };
      });
    return { person: core.cleanText(entries[0].heldFor), items };
  }

  // One secret on reveal/copy/edit; the fields are listed at core's secretOf.
  function getSecret(id, field, index) {
    return core.secretOf(findEntry(id), field, index);
  }

  function getPassword(id) {
    const entry = requireOpen().entries.find((e) => e.id === id);
    return entry && entry.kind === "login" ? entry.password ?? "" : "";
  }

  function getTotpCode(id) {
    const entry = findEntry(id);
    if (entry.kind !== "login" || !entry.totp) throw new Error("No 2FA code for this item");
    return totpCode(entry.totp);
  }

  function clearHistory(id) {
    return commit((data) => core.clearHistory(data, id));
  }

  async function changeMaster(current, next) {
    requireOpen();
    const problem = core.masterProblem(next);
    // rule: the new password was refused before the current one was tried - not a guess to count.
    if (problem) return { ok: false, error: problem, rule: true };
    const file = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const check = await openFile(current, file);
    if (!check) return { ok: false, error: "Current password is wrong." };
    check.key.fill(0);

    const fresh = await createKey(next);
    // Auto-lock can fire during the awaits above; re-check before touching the session.
    const data = requireOpen();
    // Write with the new key BEFORE switching to it: if the write fails, the session keeps the
    // password that is actually on disk instead of one the user was told did not take.
    // Cloud snapshots made before now still open with the OLD password; Settings keeps offering to
    // delete them until that is done - flagged only in the copy that is written, so a failed change
    // flags nothing.
    const rekeyed = core.withKeySalt({ ...data, sync: core.addKey(data.sync, { salt: fresh.salt.toString("base64"), installId: installId(), now: Date.now() }) }, fresh.salt.toString("base64"));
    if (data.cloud) rekeyed.olderBackupsPending = true;
    try {
      settleBeforeWrite();
      writeFileAtomic(filePath, JSON.stringify(encryptWithKey(fresh.key, fresh.kdf, fresh.salt, rekeyed)));
    } catch (e) {
      fresh.key.fill(0);
      throw e;
    }
    start({ ...fresh, data: rekeyed });
    onPersist({ bySync: false });
    return { ok: true };
  }

  // R2 credentials live inside the encrypted vault. Main gets the full config; the page only
  // ever sees cloudView(), which has no secret.
  function cloudConfig() {
    return session?.data.cloud ?? null;
  }

  function cloudView() {
    const c = cloudConfig();
    return c ? { url: `${c.endpoint}/${c.bucket}`, accessKeyId: c.accessKeyId, auto: c.auto, olderBackups: Boolean(session.data.olderBackupsPending) } : null;
  }

  // The older backups were deleted: stop offering it.
  function clearOlderBackups() {
    const data = requireOpen();
    if (!data.olderBackupsPending) return;
    delete data.olderBackupsPending;
    persist({ backup: false });
  }

  // config comes checked from cloud-backup's configFromInput; null disconnects.
  function setCloud(config) {
    const data = requireOpen();
    data.cloud = config ?? undefined;
    persist();
  }

  function setCloudAuto(auto) {
    const data = requireOpen();
    if (!data.cloud) throw new Error("Cloud backup is not set up.");
    data.cloud = { ...data.cloud, auto: Boolean(auto) };
    persist();
  }

  // Restore (a saved copy or a cloud snapshot), in two steps so the caller can save the current vault in between:
  // verifyBackup opens the backup with its master password WITHOUT touching this PC's vault,
  // commitRestore then swaps it in. A wrong file or password never costs the current vault.
  async function verifyBackup(text, master) {
    const file = parseVaultFile(text);
    let opened;
    try {
      if (!file) throw new Error("not a vault");
      opened = await openFile(String(master), file);
    } catch {
      return { ok: false, error: "That file is not a KAPEVault vault." };
    }
    if (!opened) return { ok: false, error: "Wrong master password for that backup." };
    return { ok: true, opened };
  }

  // Write first: if the disk refuses (full, antivirus, a sync lock), the current session stays
  // exactly as it was and the backup's key is wiped.
  // cloud: this device's R2 setup, read by the caller BEFORE it uploaded the replaced vault (the vault
  // may lock meanwhile). R2 keys are this device's setup, not vault content: an unlocked restore keeps
  // this device's (keptCloud, so the page can say so) rather than quietly backing up to the backup's
  // bucket. Locked, there are none to keep and the backup's own come with it.
  // slot: when the backup IS the replaced copy - "staged" moves the vault it replaced (stageReplacedCopy)
  // into the slot, "clear" deletes the slot while it still holds the restored backup (the replaced
  // vault went to R2) - never a vault another restore put there meanwhile. Only after the write, and
  // never thrown: the restore has happened. slotOk: false when that last step failed.
  // A "staged" restore is written only while the staged copy is still the vault byte for byte - the
  // proof settleStagedCopy relies on. Any other restore settles a staged copy first, like every write.
  function commitRestore(text, opened, { cloud = null, slot } = {}) {
    let contents = text;
    try {
      if (slot !== "staged") settleBeforeWrite();
      else if (!stagedIsLive()) throw new Error("The vault changed while it was being restored, so nothing was replaced. Try again.");
      if (cloud) {
        opened.data = { ...opened.data, cloud };
        contents = JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, opened.data));
      }
      writeFileAtomic(filePath, contents);
    } catch (e) {
      opened.key.fill(0);
      try {
        if (slot === "staged" && stagedIsLive()) fs.rmSync(stagedPath); // unused: it only repeats the vault
      } catch {
        // dropped by the settle before the next write, which waits for it
      }
      throw e;
    }
    start(opened);
    let slotOk = true;
    try {
      if (slot === "staged") fs.renameSync(stagedPath, replacedPath);
      if (slot === "clear" && fs.existsSync(replacedPath) && fs.readFileSync(replacedPath).equals(Buffer.from(text))) fs.rmSync(replacedPath);
    } catch {
      slotOk = false; // the staged vault stays on disk as replaced-next.kapevault
    }
    return { ok: true, vault: publicView(), keptCloud: Boolean(cloud), slotOk };
  }

  // A restore made while locked cannot upload the vault it replaces (no saved R2 keys, and typed keys
  // may be someone else's bucket), so the file is kept here first, as it is: still encrypted, opening
  // only with its own master password. One slot - a later restore never replaces it (keepReplacedCopy)
  // - and Settings can restore it or delete it. Nothing to keep when there is no vault here (a new PC).
  const replacedPath = path.join(path.dirname(filePath), "replaced.kapevault");
  const stagedPath = path.join(path.dirname(filePath), "replaced-next.kapevault");

  // An occupied slot is never overwritten (code "slot-taken"): after a lock-screen restore of someone's
  // own file it holds the real vault, and a second restore would wipe it without any password. The
  // caller offers to replace the vault with no copy kept instead; deleting the slot needs its password.
  // A staged vault still waiting for the slot counts as a kept one: nothing else may take the slot first.
  function keepReplacedCopy() {
    if (!fs.existsSync(filePath)) return;
    settleStagedCopy();
    if (fs.existsSync(replacedPath) || fs.existsSync(stagedPath)) throw Object.assign(new Error("A replaced vault is already kept."), { code: "slot-taken" });
    writeFileAtomic(replacedPath, fs.readFileSync(filePath));
  }

  // Restoring the replaced copy itself: the slot holds the backup being restored, so the current vault
  // waits beside it until the restore is written (commitRestore slot "staged"), then takes the slot.
  // A staged vault that could not be settled is never overwritten either.
  function stageReplacedCopy() {
    settleStagedCopy();
    if (fs.existsSync(stagedPath)) throw Object.assign(new Error("A replaced vault is still waiting to be kept."), { code: "slot-taken" });
    writeFileAtomic(stagedPath, fs.readFileSync(filePath));
  }

  function stagedIsLive() {
    try {
      return fs.readFileSync(stagedPath).equals(fs.readFileSync(filePath));
    } catch {
      return false;
    }
  }

  // A slot restore whose last move failed (or that died before it) leaves the vault it replaced as
  // replaced-next.kapevault. The copy is made from the vault file, the restore is written only while
  // the two still match (commitRestore), and every other write to the vault file settles first
  // (settleBeforeWrite). So a copy equal to the vault is one the restore never used (dropped), and one
  // that differs means the restore WAS written - saves may have followed. The slot then holds the
  // restored backup or nothing (keepReplacedCopy and staging wait while a copy is here), so the copy
  // takes it. A move that fails is tried again at the next start, save or restore; a file it cannot
  // read, or an unused copy it cannot drop, is thrown (see settleBeforeWrite). Never lost.
  function settleStagedCopy() {
    let staged;
    try {
      staged = fs.readFileSync(stagedPath);
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    if (staged.equals(fs.readFileSync(filePath))) return fs.rmSync(stagedPath, { force: true });
    try {
      fs.renameSync(stagedPath, replacedPath);
    } catch {
      // the restore is written, so this copy is proven: it waits for the slot, blocking any other copy
    }
  }

  // Before the vault file changes: once it changes, an unused staged copy (equal to it now) would read
  // as a written restore. So one that cannot be settled first stops the write.
  function settleBeforeWrite() {
    try {
      settleStagedCopy();
    } catch {
      throw new Error("Another program is holding a file in the KAPEVault folder, so nothing was changed. Try again in a moment.");
    }
  }

  // Whether a picked file is the slot, by file identity - however the path to it was spelled.
  function isReplacedCopy(file) {
    try {
      const a = fs.statSync(file, { bigint: true });
      const b = fs.statSync(replacedPath, { bigint: true });
      return a.dev === b.dev && a.ino === b.ino;
    } catch {
      return false;
    }
  }

  // Proof of owning a kept copy (the replaced vault, the old BOVault vault) before it is deleted: its
  // OWN master password opens it. Unlocked is not enough - a restore of someone's own file at the lock
  // screen leaves them unlocked in it. Nothing is kept: the key is wiped at once.
  async function proveCopy(file, master) {
    let opened;
    try {
      if (fs.statSync(file).size > MAX_VAULT_BYTES) throw new Error("too big");
      const parsed = parseVaultFile(fs.readFileSync(file));
      if (!parsed) throw new Error("not a vault");
      opened = await openFile(String(master), parsed);
    } catch {
      return { ok: false, error: "That file is not a KAPEVault vault." };
    }
    if (!opened) return { ok: false, error: "Wrong master password for that vault." };
    opened.key.fill(0);
    return { ok: true };
  }

  // null only when there is none: a delete skips the password proof for a missing copy, so a stat that
  // fails any other way (antivirus holding it) is an error, never "nothing there".
  function replacedCopyInfo() {
    try {
      const { mtimeMs, size } = fs.statSync(replacedPath);
      return { path: replacedPath, at: mtimeMs, size };
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw new Error("The replaced vault cannot be read right now. Try again in a moment.");
    }
  }

  function deleteReplacedCopy() {
    fs.rmSync(replacedPath, { force: true });
  }

  return {
    status,
    create,
    unlock,
    unlockWithKey,
    lock,
    keyCopy,
    publicView,
    linkedFolders,
    openTarget,
    handBack,
    saveEntry,
    importEntries,
    deleteEntry,
    toggleFavorite,
    confirmPayee,
    setRecoveryCodes,
    markRecoveryCode,
    addPaperCopy,
    removePaperCopy,
    getRecoveryCodes,
    setLifecycle,
    confirmGone,
    followUpsDue,
    moveEntry,
    touch,
    addSpace,
    renameSpace,
    deleteSpace,
    getPassword,
    getSecret,
    getTotpCode,
    clearHistory,
    changeMaster,
    cloudConfig,
    cloudView,
    clearOlderBackups,
    setCloud,
    setCloudAuto,
    verifyBackup,
    commitRestore,
    syncBase,
    openSnapshot,
    ownsFile,
    openWithPassword,
    commitSync,
    startEpoch,
    revokeDevice,
    keepSyncLog,
    keepReplacedCopy,
    stageReplacedCopy,
    settleStagedCopy,
    isReplacedCopy,
    proveCopy,
    replacedCopyInfo,
    deleteReplacedCopy,
  };
}

module.exports = { createVaultSession };
