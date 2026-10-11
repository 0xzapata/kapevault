// Cloud backup to the user's own Cloudflare R2 bucket. Only the encrypted vault file, exactly as it
// sits on disk, is uploaded - R2 never sees a key or plaintext; a backup opens only with the master
// password it was saved under. Each backup is a new timestamped snapshot; old ones are thinned out.
// Beside them, once per app version, the Forever Opener page (no vault data in it).
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createR2Client, parseR2Url, OVERSIZED } = require("./r2-client.cjs");
const { parseVaultFile } = require("./vault-crypto.cjs");
const { writeFileAtomic } = require("./atomic-write.cjs");
const { SNAPSHOT_PREFIXES, readSnapshotKey, snapshotKey, snapshotsToPrune } = require("../core/index.js");

const RETRY_MS = 60 * 1000; // a failed auto-backup tries again while the vault stays unlocked
// kapevault/snapshots/<install id>/<time>.kapevault. Snapshots from before install ids (no folder)
// still list and restore, but are never thinned out automatically. Pre-rename bovault/... snapshots
// are read the same way, so old backups stay restorable and get thinned out with the new ones. Keys
// are named, read and thinned out in core (core/sync/snapshots.js), which the phone shares.

// Time a snapshot was taken, from its name; null for anything that is not one of ours.
function snapshotTime(key) {
  return readSnapshotKey(key)?.time ?? null;
}

// The install that made a snapshot; null for one from before install ids.
function snapshotOwner(key) {
  return readSnapshotKey(key)?.owner ?? null;
}

// Every object under both snapshot folders (the current name and the pre-rename one).
async function listSnapshots(r2) {
  const lists = [];
  for (const prefix of SNAPSHOT_PREFIXES) lists.push(...(await r2.list(prefix)));
  return lists;
}

// Settings form -> a checked config. A blank secret keeps the saved one - only while the bucket and key ID
// stay the same, so a changed URL or key ID never sends the saved secret to a place it was not saved for.
function configFromInput(input, saved) {
  const target = parseR2Url(input?.url);
  if (!target) throw new Error("Paste the bucket's S3 API URL, like https://<account-id>.r2.cloudflarestorage.com/<bucket>.");
  const accessKeyId = String(input.accessKeyId ?? "").trim();
  const sameTarget = saved && saved.endpoint === target.endpoint && saved.bucket === target.bucket && saved.accessKeyId === accessKeyId;
  const secretAccessKey = String(input.secretAccessKey ?? "").trim() || (sameTarget ? saved.secretAccessKey : "") || "";
  if (!accessKeyId || !secretAccessKey) throw new Error("Enter the access key ID and secret access key.");
  return { ...target, accessKeyId, secretAccessKey, auto: saved?.auto ?? true };
}

// What Settings > Backup > Add a phone shows as a QR code, exactly as the phone reads it
// (mobile/src/app/host/setup-code.ts): the saved bucket's S3 API URL and both keys.
function setupCode(config) {
  return JSON.stringify({ kapevault: "r2", v: 1, url: `${config.endpoint}/${config.bucket}`, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey });
}

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// Downloaded bytes must be a KAPEVault file before they may replace the local vault.
function checkBackupBytes(bytes) {
  if (!parseVaultFile(bytes)) throw new Error("That backup is not a KAPEVault file.");
  return bytes;
}

// vault: the session (cloudConfig/status). endpoint: test override for the R2 origin.
// installId(): this install's id - a PC only ever thins out snapshots it made itself. "" when
// settings.json could not be read this run: snapshots then go up un-named, like before install ids.
// opener: { key, html() } - this version's Forever Opener, kept beside the snapshots.
// transport: a stand-in courier for unit tests (default: the system curl).
/** @param {{ vault: any, endpoint?: string, delayMs?: number, installId: () => string, opener?: any, transport?: any }} options */
function createCloudBackup({ vault, endpoint, delayMs, installId, opener, transport }) {
  let timer = null;
  /** @type {Promise<any>} */
  let queue = Promise.resolve();
  let last = { state: "idle" };
  const openerIn = new Set(); // buckets known to hold this version's opener
  let openerReplaced = false; // a changed opener was found in the bucket this run (Settings says so)

  // A backup still owed (a change waiting, or an upload that failed) is also noted in a file beside the
  // vault, so a crash or a killed app does not forget it. It holds nothing about the vault. Best
  // effort: a marker that cannot be written never fails a save.
  const owedFile = path.join(path.dirname(vault.status().path), "backup-pending");
  let owed = fs.existsSync(owedFile);
  function setOwed(on) {
    if (on === owed) return;
    try {
      if (on) writeFileAtomic(owedFile, "");
      else fs.rmSync(owedFile, { force: true });
      owed = on;
    } catch {
      // tried again on the next change
    }
  }

  // The snapshot keys this install put in the bucket (SYNC.md 3.5): a key under its own id that it never
  // put there means two installs share the id - a KAPEVault folder copied to a second PC. Kept beside the
  // vault (key names only). None yet, or unreadable: the next listing starts it from what is there, so
  // an install older than this list never takes its own snapshots for another's. A key joins before
  // its PUT, since a listing meanwhile may already show it.
  const sentFile = path.join(path.dirname(vault.status().path), "sent-snapshots.json");
  let sent = readSent();
  const sending = new Set();
  let lastSentHash = null; // of the bytes this run last uploaded
  function readSent() {
    try {
      const keys = JSON.parse(fs.readFileSync(sentFile, "utf8"));
      return Array.isArray(keys) ? new Set(keys.filter((k) => typeof k === "string")) : null;
    } catch {
      return null;
    }
  }
  function keepSent(keys) {
    sent = new Set(keys);
    try {
      writeFileAtomic(sentFile, JSON.stringify([...sent]));
    } catch {
      // kept in memory for this run
    }
  }
  function notSentHere(objects) {
    const me = installId();
    const mine = me ? objects.map((o) => o.key).filter((k) => snapshotOwner(k) === me) : [];
    if (!sent) {
      keepSent([...mine, ...sending]);
      return [];
    }
    return mine.filter((k) => !(/** @type {Set<string>} */ (sent)).has(k) && !sending.has(k));
  }

  // Plain http is allowed only for the test override (a fake R2 on 127.0.0.1).
  // A config also comes out of a synced or restored vault (cleanVault checks it there too): never sign and
  // send for anything but an R2 bucket. The test override is exempt.
  const clientFor = (config) => {
    const target = parseR2Url(`${config.endpoint}/${config.bucket}`);
    if (!endpoint && (target?.endpoint !== config.endpoint || target?.bucket !== config.bucket)) throw new Error("The saved backup is not an R2 bucket. Connect to R2 again in Settings.");
    return createR2Client({ ...config, endpoint: endpoint || config.endpoint, allowHttp: Boolean(endpoint), transport });
  };

  // The opener is not secret: it holds no vault data. Once per bucket per run it is read back and
  // compared byte for byte - a page someone changed in the bucket must not sit beside the backups as
  // ours - and put back when it is missing or different (anything larger than the real page is).
  // Then every other object in the opener folder (earlier app versions' pages, which nothing re-checks
  // and an older Emergency Kit may still point at) is deleted. Best effort, once per run: a refused
  // delete (a Bucket Lock) or a failed listing never fails a backup.
  // Not awaited by a backup, so a slow upload never holds up quitting or a restore; a failure is
  // forgotten and the next backup tries again.
  function sendOpener(r2, config) {
    const bucket = `${config.endpoint}/${config.bucket}`;
    if (!opener || openerIn.has(bucket)) return;
    openerIn.add(bucket);
    (async () => {
      const real = Buffer.from(opener.html(), "utf8");
      const there = await r2.find(opener.key, real.length).catch((e) => {
        if (e.message !== OVERSIZED) throw e;
        return "larger";
      });
      if (!(Buffer.isBuffer(there) && there.equals(real))) {
        await r2.put(opener.key, real);
        if (there !== null) openerReplaced = true;
      }
      try {
        const folder = opener.key.slice(0, opener.key.lastIndexOf("/") + 1);
        for (const o of await r2.list(folder)) if (o.key !== opener.key && o.key.startsWith(folder)) await r2.del(o.key).catch(() => {});
      } catch {
        // left for the next run
      }
    })().catch(() => openerIn.delete(bucket));
  }

  async function upload(config, bytes, note) {
    const r2 = clientFor(config);
    const me = installId();
    const key = snapshotKey(new Date(), me, note);
    sending.add(key);
    try {
      if (sent) keepSent([...sent, key]);
      await r2.put(key, bytes);
      lastSentHash = sha256(bytes);
      sendOpener(r2, config);
      // Thinning is housekeeping: a failed delete leaves an extra snapshot, never a missing one. Only
      // snapshots this install sent count: anyone with the R2 keys can put objects under its id, and
      // 20 planted ones used to push every real snapshot out of the newest 20.
      try {
        const mine = (await listSnapshots(r2)).map((o) => o.key).filter((k) => snapshotOwner(k) === me && (!sent || (/** @type {Set<string>} */ (sent)).has(k)));
        const pruned = new Set(snapshotsToPrune(mine, Date.now()));
        for (const old of pruned) await r2.del(old);
        const left = mine.filter((k) => !pruned.has(k));
        keepSent(sent ? left.filter((k) => (/** @type {Set<string>} */ (sent)).has(k)) : left);
      } catch {}
    } finally {
      sending.delete(key);
    }
    return key;
  }

  // Config and bytes are read before the first await, so a lock straight after cannot strand the
  // upload. async so a read error (file held by antivirus) rejects instead of throwing into lock/quit.
  async function backupNow(note = "") {
    clearTimeout(timer);
    timer = null;
    const config = vault.cloudConfig();
    if (!config) throw new Error("Cloud backup is not set up.");
    const bytes = fs.readFileSync(vault.status().path);
    // Other devices merge what goes up, so a file this session cannot open itself never does (SYNC.md 3.5).
    const readable = Boolean(vault.openSnapshot(bytes)?.data);
    const run = readable ? queue.then(() => upload(config, bytes, note)) : Promise.reject(new Error("The vault file here does not open with this vault's key, so it was not uploaded."));
    const done = run.then(
      () => {
        last = { state: "ok", at: Date.now() };
        if (queue === done && !timer) setOwed(false); // nothing newer is waiting or queued behind it
      },
      (e) => {
        last = { state: "error", at: Date.now(), error: e.message };
        setOwed(true);
      },
    );
    queue = done;
    return run;
  }

  // After every save; bursts of edits become one upload. Offline, it keeps retrying until the lock.
  // Auto backup off: a backup already waiting is cancelled too, or turning it off would upload once.
  function schedule(delay = delayMs) {
    clearTimeout(timer);
    timer = null;
    if (!vault.cloudConfig()?.auto) {
      if (vault.status().unlocked) setOwed(false); // nothing goes up by itself; locked, what is owed stays owed
      return;
    }
    setOwed(true);
    timer = setTimeout(() => backupNow().catch(() => schedule(RETRY_MS)), delay);
  }

  // A manual sync with automatic backup off sends the vault up itself - unless this run already sent
  // these exact bytes.
  async function sendIfChanged() {
    if (lastSentHash !== sha256(fs.readFileSync(vault.status().path))) await backupNow();
  }

  // After every unlock: a backup owed from before (an upload that failed, or a change the app was
  // closed or killed on before it went up) goes up now.
  function onUnlocked() {
    if (owed || last.state === "error") schedule();
  }

  // Start a waiting backup now (before a lock wipes the credentials); resolves once every upload
  // in flight has finished, so quitting never cuts one off.
  function flush() {
    if (timer) backupNow().catch(() => {});
    return queue;
  }

  // After a master password change, older snapshots still open with the OLD password. This uploads
  // a fresh one under the new password, then deletes every snapshot older than it.
  async function forgetOlder() {
    const config = vault.cloudConfig();
    if (!config) throw new Error("Cloud backup is not set up.");
    const cutoff = snapshotTime(await backupNow());
    const r2 = clientFor(config);
    const me = installId();
    // This install's older snapshots, plus ones from before install ids - their maker cannot be told
    // apart, and after a password change an old copy is exactly what this is meant to remove. Another
    // PC's named snapshots are left alone.
    const older = (await listSnapshots(r2))
      .map((o) => o.key)
      .filter((k) => snapshotTime(k) !== null && /** @type {number} */ (snapshotTime(k)) < /** @type {number} */ (cutoff) && [me, null].includes(snapshotOwner(k)));
    // A Bucket Lock (SYNC.md) refuses deleting a snapshot still inside its retention: skip it and go on
    // with the rest, then say how many are left, so one locked object never keeps the others.
    let refused = 0;
    for (const key of older) {
      try {
        await r2.del(key);
      } catch {
        refused++;
      }
    }
    return { deleted: older.length - refused, refused };
  }

  // input = credentials typed on the lock screen; without it the saved config is used.
  async function list(input) {
    const config = input ? configFromInput(input, vault.cloudConfig()) : vault.cloudConfig();
    if (!config) throw new Error("Cloud backup is not set up.");
    const me = installId();
    // Newest by R2's own clock, not the time in the name (which the uploader chose). A key under this
    // install's id that it never sent was put there by someone else: it is not "this device".
    const planted = (key) => snapshotOwner(key) === me && sent !== null && !sent.has(key) && !sending.has(key);
    return (await listSnapshots(clientFor(config)))
      .filter((o) => snapshotTime(o.key) !== null)
      .map((o) => ({ key: o.key, size: o.size, at: o.lastModified ?? snapshotTime(o.key), otherDevice: ![me, null].includes(snapshotOwner(o.key)) || planted(o.key) }))
      .sort((a, b) => b.at - a.at);
  }

  const configFor = (input) => {
    const saved = vault.cloudConfig();
    const config = input ? configFromInput(input, saved) : saved;
    if (!config) throw new Error("Cloud backup is not set up.");
    return config;
  };

  // Restore is three steps, run by main: download (checked to be a KAPEVault file), open it with the
  // backup's own master password, then saveBeforeRestore - so a wrong password or a bad file never
  // costs the current vault, and a restore can always be undone.
  async function download(key, input) {
    if (snapshotTime(key) === null) throw new Error("Unknown backup.");
    return checkBackupBytes(await clientFor(configFor(input)).get(key));
  }

  // Sync's reads, with the saved keys only: every snapshot object (with R2's LastModified), and one
  // snapshot's bytes as stored - the caller opens them (vault.openSnapshot), which checks them.
  const syncListing = async () => listSnapshots(clientFor(configFor()));
  async function fetchSnapshot(key) {
    if (snapshotTime(key) === null) throw new Error("Unknown backup.");
    return clientFor(configFor()).get(key);
  }

  // Only ever to the SAVED bucket. Keys typed for a restore may be someone else's bucket, and
  // uploading there would hand them this vault's ciphertext to guess at. With no saved keys (locked,
  // or cloud backup off) main keeps a local copy instead (vault.keepReplacedCopy).
  async function saveBeforeRestore() {
    if (!vault.status().exists) return; // a new PC has nothing to keep
    const config = vault.cloudConfig();
    if (!config) throw new Error("The current vault cannot be backed up to R2 first (it is locked, or cloud backup is off), so nothing was restored.");
    // In the upload queue, like every backup: raced beside an auto-backup, that one's prune could drop
    // this key from sent-snapshots.json, and it would then list as another device's and never be pruned.
    const bytes = fs.readFileSync(vault.status().path);
    const run = queue.then(() => upload(config, bytes, "before-restore"));
    queue = run.catch(() => {});
    try {
      await run;
    } catch (e) {
      throw new Error(`Could not back up the current vault first, so nothing was restored. ${e.message}`);
    }
  }

  return { schedule, onUnlocked, flush, backupNow, sendIfChanged, forgetOlder, list, download, syncListing, fetchSnapshot, notSentHere, saveBeforeRestore, configFromInput, status: () => last, openerReplaced: () => openerReplaced };
}

module.exports = { createCloudBackup, snapshotKey, snapshotTime, snapshotOwner, snapshotsToPrune, configFromInput, checkBackupBytes, setupCode };
