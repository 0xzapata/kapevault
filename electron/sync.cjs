// The sync loop on the PC (SYNC.md 3.5-3.9). One run: list the bucket, download each other device's
// newest snapshot, open it with the session key, merge it in (core), and commit - or hold the merge for
// the user's review when it would change too much. The upload after it is the normal backup of the
// merged vault. The rules live in core/ (shared with the phone); this is the PC's host around them.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../core/index.js");
const { compare } = require("../core/sync/hlc.js");
const { writeFileAtomic } = require("./atomic-write.cjs");

const SYNC_DELAY_MS = 3000; // after a save: a burst of edits syncs once
const BUSY = { restore: "A restore is already running.", master: "The master password is being changed. Try again in a moment.", sync: "Sync is running. Try again in a moment." };
const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
// How the page names another device: never its install id.
const refOf = (id) => sha256(`device:${id}`).slice(0, 16);

// vault: the session; cloud: cloud-backup (listing, downloads, the upload after a commit);
// installId(): this install's; renewInstallId(): a new one when another install shares it; device:
// { name, platform } for sync.devices. throttledUnlock(attempt): main's, for a password typed here.
// onStatus(status): after every change the page should see; onMerged(): the vault changed under the
// page; onRekeyed(): another device's master password is now this vault's (Windows Hello goes off).
function createSync({ vault, cloud, installId, renewInstallId = () => "", device, delayMs = SYNC_DELAY_MS, now = Date.now, throttledUnlock = (attempt) => attempt(), onStatus = (_status) => {}, onMerged = () => {}, onRekeyed = () => {} }) {
  let holder = null; // "sync" | "restore" | "master": one of the three at a time
  let running = null; // the run in flight
  let timer = null;
  let review = null; // a merge held for the user: { generation, revision, remotes, data, view, rekey? }
  let error = ""; // the last run's failure, in plain words
  let problems = []; // devices the last run could not merge, and why
  let newMaster = null; // a device under a master password this vault has not seen: { device, key, name }
  let lastSeen = new Map(); // device -> R2 LastModified of its newest snapshot, from the last listing
  let merged = new Map(); // device -> the snapshot key this session already has in it
  let unopened = new Set(); // snapshotStamp()s that would not open: not downloaded again until the object changes
  let newer = new Set(); // snapshotStamp()s a newer KAPEVault wrote (said inside the ciphertext): named on every run, downloaded once until the object changes
  let ownChecked = new Set(); // snapshotStamp()s under this install's id it never sent, read and found to be no other install's
  let mergedIn = 0; // the session generation `merged` belongs to
  let print = { revision: -1, code: "" }; // the shared state's fingerprint, worked out once per save

  // After a restore nothing syncs until the user says what the restore means for the other devices
  // (SYNC.md 3.7): their newer state would undo part of it. Noted in a file beside the vault (it holds
  // nothing), so a relaunch or a lock does not forget it.
  const heldFile = path.join(path.dirname(vault.status().path), "sync-after-restore");
  let held = fs.existsSync(heldFile);
  function hold(on) {
    held = on;
    try {
      if (on) writeFileAtomic(heldFile, "");
      else fs.rmSync(heldFile, { force: true });
    } catch {
      // holds in memory for this run; tried again on the next answer or restore
    }
    publish();
  }

  const publish = () => onStatus(status());

  // Why sync cannot run at all. Automatic backup off is not one: Sync now still syncs, only the
  // automatic runs wait (automatic()).
  function offReason() {
    if (!vault.status().unlocked) return "locked";
    if (!vault.cloudConfig()) return "no-cloud";
    const me = installId();
    if (!me) return "no-id"; // settings.json unreadable this run: there is no "me" to sync as
    if (held) return "restored";
    if (vault.syncBase().data.sync.devices[me]?.revokedAt) return "removed"; // another device removed this one
    return null;
  }

  // After unlock and saves: only with automatic backup on (nothing goes up by itself otherwise), and not
  // while a new master password waits for Apply (a run cannot open it again without the password).
  const automatic = () => !offReason() && vault.cloudConfig().auto && !review?.rekey;

  // Restore and master password change run through here too. Either waits for a sync in flight; a
  // second of them is refused. A sync while one of them runs just does not start.
  async function exclusive(what, fn) {
    while (running) await running.catch(() => {});
    if (holder) return { ok: false, error: BUSY[holder] };
    holder = what;
    try {
      return await fn();
    } finally {
      holder = null;
    }
  }

  function run(explicit) {
    clearTimeout(timer);
    timer = null;
    if (running || holder || offReason() || (!explicit && !automatic())) return running ?? Promise.resolve();
    holder = "sync";
    running = attempt(explicit).finally(() => {
      running = null;
      holder = null;
      publish();
    });
    publish();
    return running;
  }

  async function attempt(explicit) {
    const { generation } = vault.syncBase();
    try {
      const objects = await cloud.syncListing();
      if ((await sharesThisId(objects)) && renewInstallId()) keepLog({ at: now(), with: [], renewedId: true });
      const devices = vault.syncBase().data.sync.devices;
      const all = core.pickSnapshots(objects, { installId: installId(), devices, now: now(), failed: unopened });
      const stamps = new Map(objects.map((o) => [o.key, core.snapshotStamp(o)]));
      lastSeen = new Map(all.map((p) => [p.device, p.lastSeen]));
      const picks = all.filter((p) => explicit || !p.dead);
      if (mergedIn !== generation) [merged, mergedIn] = [new Map(), generation];
      const remotes = [];
      const found = [];
      newMaster = null;
      for (const pick of picks) {
        if (merged.get(pick.device) === pick.keys[0]) continue; // nothing new from it since
        const name = core.nameOf(devices, pick.device);
        const got = await download(pick, name, Boolean(devices[pick.device]), stamps);
        if (got.newKey) newMaster ??= { device: pick.device, key: got.newKey, name };
        if (got.problem) found.push(got.problem);
        else if (got.data) remotes.push({ device: pick.device, key: got.key, data: got.data, salt: got.salt });
      }
      const upToDate = picks.filter((p) => merged.get(p.device) === p.keys[0]).map((p) => p.device);
      settle(remotes, upToDate, found, generation);
      error = "";
    } catch (e) {
      if (!vault.status().unlocked) return; // locked mid-run: nothing to say
      error = e.message;
      keepLog({ at: now(), error });
    }
  }

  // Another install has this install's id (a copied app data folder): a snapshot under this id that it
  // never uploaded opens with the vault key and holds a change made under this id that this vault never
  // made. Anything else there - junk, a stranger's file, a copy of its own snapshot - may be planted by
  // anyone holding the bucket keys, and taking a new id for it abandoned the old folder's thinning out
  // (SYNC.md 3.5). The three newest unread a run; each is read once until it changes.
  async function sharesThisId(objects) {
    const strangers = new Set(cloud.notSentHere(objects));
    const unread = objects
      .filter((o) => strangers.has(o.key) && !ownChecked.has(core.snapshotStamp(o)) && !(Number(o.size) > core.MAX_VAULT_BYTES))
      .sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0))
      .slice(0, 3);
    for (const object of unread) {
      const opened = vault.openSnapshot(await cloud.fetchSnapshot(object.key));
      if (opened?.data && core.writesAsThisInstall(vault.syncBase().data.sync, opened.data, opened.salt, installId())) return true;
      ownChecked.add(core.snapshotStamp(object));
    }
    return false;
  }

  // A device's newest snapshot that opens; an older one when the newest will not (every older
  // snapshot is a safe subset of a newer one - never read as an empty vault). newKey: it is under a
  // master password this vault has never had - the user types it once (adoptKey), and only a known
  // device is asked for it: from an unknown one it counts as unopenable. A newKey snapshot does not
  // hide the device's older ones: anyone holding the bucket keys can plant one (no vault key needed), so
  // the next that opens is still merged, with newKey beside it for the prompt. One that will not open
  // is remembered (unopened), so the next run does not download it again. A header that only claims a
  // newer version is one that will not open: the header is not covered by the tag, so anyone holding the
  // bucket keys can write it (SYNC.md 3.5). Only a newer minReader or sync.v inside a snapshot that opened
  // with the vault key says the device runs a newer KAPEVault.
  async function download(pick, name, known, stamps) {
    let newKey = null;
    for (const key of pick.keys) {
      // A device on a newer KAPEVault: its older snapshots are stale, so none of them is merged either.
      if (newer.has(stamps.get(key))) return { problem: core.newerProblem(name) };
      const bytes = await cloud.fetchSnapshot(key);
      const opened = vault.openSnapshot(bytes);
      if (opened?.data && core.isNewerData(opened.data)) {
        newer.add(stamps.get(key));
        return { problem: core.newerProblem(name) };
      }
      if (opened?.otherKey && known) {
        if (opened.behind) return newKey ? { newKey } : { problem: `${name} still uses the old master password. Unlock it there.` };
        newKey ??= key;
        continue;
      }
      if (opened && !opened.otherKey && Array.isArray(opened.data.entries) && Array.isArray(opened.data.spaces)) return { key, data: opened.data, salt: opened.salt, newKey };
      unopened.add(stamps.get(key));
    }
    return newKey ? { newKey } : { problem: `${name}'s newest backups cannot be opened.` };
  }

  // Everything from here to the commit is synchronous, on the vault as it is now: a save made during
  // the downloads is merged, never overwritten. rekey: the key of another device's newer master password,
  // adopted with this merge - always after a review.
  /** @param {{ key: Buffer, kdf: any, salt: Buffer } | null} [rekey] */
  function settle(remotes, upToDate, found, generation, rekey = null) {
    const base = vault.syncBase();
    if (base.generation !== generation) return rekey?.key.fill(0); // locked and opened again meanwhile: that unlock syncs
    const result = mergeAll(base.data, remotes);
    problems = [...found, ...result.problems];
    const changes = core.syncChanges(base.data, result.data);
    const reasons = core.reviewReasons(changes, base.data.entries.length, { epoch: result.epoch, key: Boolean(rekey), removed: result.removed });
    const done = { remotes: result.merged, upToDate };
    dropReview();
    if (reasons.length) {
      review = { generation, revision: base.revision, remotes: result.merged, data: result.data, rekey, view: core.reviewView(base.data, result, changes, reasons) };
      keepLog(core.logEntry(now(), done, { review: true }));
      return;
    }
    commit(base, result.data, done, changes);
  }

  const mergeAll = (local, remotes) => core.mergeRemotes(local, remotes, { installId: installId(), device, now: now(), sha256 });

  // Written as sync's own save (never stamped, never another sync), then backed up as usual. Nothing
  // new: nothing written, nothing uploaded - the result only joins the log in memory.
  function commit(base, data, done, changes, rekey = null) {
    const entry = core.logEntry(now(), done, { added: changes.added.length, changed: changes.changed.length, deleted: changes.deleted.length, copies: changes.copies.length });
    if (data === base.data && !rekey) keepLog(entry);
    else if (vault.commitSync({ ...data, syncLog: core.withEntry(base.data.syncLog, entry) }, base.revision, rekey)) {
      onMerged();
      if (rekey) onRekeyed();
    } else return;
    for (const remote of done.remotes) merged.set(remote.device, remote.key);
  }

  // A held review is replaced or dropped: a master password key it carried is wiped.
  function dropReview() {
    review?.rekey?.key.fill(0);
    review = null;
  }

  // Apply on a held review. A save since then: the held snapshots are merged again into the vault as
  // it is now (the user has said yes to them) - the save is kept, never overwritten.
  async function apply() {
    await running?.catch(() => {});
    const held = review;
    if (!held || holder) return status();
    review = null;
    const base = vault.syncBase();
    if (base.generation === held.generation) {
      const data = base.revision === held.revision ? held.data : mergeAll(base.data, held.remotes).data;
      commit(base, data, { remotes: held.remotes, upToDate: [] }, core.syncChanges(base.data, data), held.rekey);
    } else held.rekey?.key.fill(0);
    publish();
    return status();
  }

  // The master password another device set, typed here once (SYNC.md 3.6). It opens that device's
  // snapshot through the unlock throttle; the merge then waits for a review. When that device's change
  // is the later one, Apply writes this vault under its key too; otherwise (the change made here is the
  // later one) the merge keeps this vault's key and the other device adopts it instead.
  async function adoptKey(master) {
    await running?.catch(() => {});
    const ask = newMaster;
    if (!ask || holder || offReason()) return { ok: false, error: holder ? BUSY[holder] : "Nothing to open. Sync again." };
    holder = "sync";
    try {
      const { generation } = vault.syncBase();
      const bytes = await cloud.fetchSnapshot(ask.key);
      const opened = await throttledUnlock(() => vault.openWithPassword(bytes, master));
      if (!opened.ok) return { ok: false, error: opened.damaged || opened.newer ? opened.error : `That is not the master password set on ${ask.name}.` };
      const { key, kdf, salt, data } = opened.opened;
      let theirs;
      try {
        theirs = core.readSync(data, salt.toString("base64"));
      } catch (e) {
        key.fill(0); // a newer app's vault: its key must not outlive the refusal
        throw e;
      }
      const rekey = core.isNewerKey(theirs, vault.syncBase().data.sync) ? { key, kdf, salt } : (key.fill(0), null);
      newMaster = null;
      settle([{ device: ask.device, key: ask.key, data, salt: salt.toString("base64") }], [], [], generation, rekey);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      holder = null;
      publish();
    }
  }

  // The answer after a restore (SYNC.md 3.7). everywhere: this vault becomes the one on all devices (a
  // new epoch the others adopt); otherwise it is merged with them like any sync - what they deleted
  // stays deleted.
  async function answerRestore(everywhere) {
    if (offReason() !== "restored") return status();
    if (everywhere && !saved(() => vault.startEpoch(crypto.randomUUID()))) return status(); // still paused: ask again
    hold(false);
    return syncNow();
  }

  // Another device, by the ref the page was given: its snapshots are never merged again. Not during a
  // restore: it carries the removals it read before its upload, and one made meanwhile would be lost.
  function revoke(ref) {
    if (holder === "restore") {
      error = BUSY.restore;
      publish();
      return status();
    }
    const me = installId();
    const id = [...new Set([...Object.keys(vault.syncBase().data.sync.devices), ...lastSeen.keys()])].find((d) => d !== me && refOf(d) === ref);
    if (id && saved(() => vault.revokeDevice(id))) lastSeen.delete(id);
    publish();
    return status();
  }

  // Back in sync after another device removed this one (SYNC.md 3.9): the vault's own master password,
  // proven on the vault file through the unlock throttle, then a new install id. The removed id stays
  // removed on every device (a removal is never lifted); the new one joins like any new device. One locked
  // out with a new master password since cannot open the others' snapshots until it is typed here too (the
  // new-master prompt, then a review). Joining needs nothing a removed device lacked before: one that holds
  // the key and the bucket token could always write under a new id - only a new master password locks out.
  async function rejoin(master) {
    await running?.catch(() => {});
    if (holder) return { ok: false, error: BUSY[holder], status: status() };
    if (offReason() !== "removed") return { ok: false, error: "This device is not removed from sync.", status: status() };
    holder = "sync";
    try {
      const proof = await throttledUnlock(() => vault.proveCopy(vault.status().path, String(master ?? "")));
      if (!proof.ok) return { ok: false, error: proof.newer ? proof.error : "Wrong master password.", status: status() };
      if (offReason() !== "removed") return { ok: false, error: "Nothing to join. Sync again.", status: status() }; // locked meanwhile
      if (!renewInstallId()) return { ok: false, error: "This device's settings cannot be saved right now. Try again in a moment.", status: status() };
      [merged, lastSeen, problems] = [new Map(), new Map(), []];
      keepLog({ at: now(), with: [], renewedId: true });
    } finally {
      holder = null;
    }
    return { ok: true, status: await syncNow() };
  }

  // A save the page asked for; one the disk refused is said on the sync line, and nothing changed.
  function saved(save) {
    try {
      save();
      return true;
    } catch (e) {
      error = e.message;
      return false;
    }
  }

  // An explicit sync also reads devices silent for 180 days, and sends the merged vault straight up -
  // with automatic backup off too (this is then the only way anything goes up).
  async function syncNow() {
    await run(true);
    if (!offReason() && !vault.cloudConfig().auto) {
      await cloud.sendIfChanged().catch((e) => {
        error = e.message;
      });
    } else await cloud.flush();
    publish();
    return status();
  }

  // The newest result first; a quiet run replaces the quiet run before it, so the log keeps what happened.
  function keepLog(entry) {
    vault.keepSyncLog(core.withEntry(vault.syncBase().data.syncLog, entry));
  }

  function status() {
    const off = offReason();
    if (off === "locked") return { state: "off", off, manual: false, error: "", problems: [], newMaster: null, thisDevice: device.name, lastSync: null, devices: [], lockOut: [], needsLook: [], review: null, fingerprint: "" };
    const { data, revision } = vault.syncBase();
    // SYNC.md 3.9: two devices that have synced show the same code; a difference means they diverged.
    if (print.revision !== revision) print = { revision, code: sha256(core.sharedState(data)).slice(0, 8) };
    const devices = data.sync.devices;
    const me = installId();
    const last = (data.syncLog ?? []).find((e) => e.with?.length);
    // Removed devices that still hold a working key: no master password change since they were removed.
    // Removing alone only stops their folder from merging (SYNC.md 3.9); the new key is what locks them out.
    const lockOut = Object.entries(devices)
      .filter(([id, d]) => id !== me && d.revokedAt && !data.sync.keys.some((k) => compare(k.at, d.revokedAt) > 0))
      .map(([id]) => ({ ref: refOf(id), name: core.nameOf(devices, id) }));
    const others = new Set([...Object.keys(devices).filter((id) => id !== me && !devices[id].revokedAt), ...lastSeen.keys()]);
    return {
      state: off ? "off" : running ? "running" : review ? "review" : "idle",
      off,
      manual: vault.cloudConfig()?.auto === false,
      error,
      problems,
      newMaster: newMaster?.name ?? null,
      thisDevice: device.name,
      lastSync: last ? { at: last.at, with: last.with.map((id) => core.nameOf(devices, id)) } : null,
      devices: [...others].map((id) => ({ ref: refOf(id), name: core.nameOf(devices, id), platform: devices[id]?.platform ?? "", lastSeen: lastSeen.get(id) ?? null })),
      lockOut,
      needsLook: data.entries.filter((e) => core.isConflictCopy(e.title) && e.lifecycle?.state !== "gone" && !core.isTrashed(e)).map((e) => ({ id: e.id, title: e.title })),
      review: review?.view ?? null,
      fingerprint: print.code,
    };
  }

  return {
    status,
    exclusive,
    apply,
    adoptKey,
    answerRestore,
    revoke,
    rejoin,
    syncNow,
    // Unlock never waits on sync.
    afterUnlock: () => run(false),
    afterSave() {
      if (!automatic()) return;
      clearTimeout(timer);
      timer = setTimeout(() => run(false), delayMs);
    },
    // Right after a restore is written. Lasts until the user answers the restore question.
    pauseAfterRestore: () => hold(true),
    locked() {
      clearTimeout(timer);
      timer = null;
      dropReview();
      [error, problems, newMaster, lastSeen, unopened, newer, ownChecked] = ["", [], null, new Map(), new Set(), new Set(), new Set()];
    },
  };
}

module.exports = { createSync };
