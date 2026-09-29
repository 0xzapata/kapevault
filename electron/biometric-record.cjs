// The record Windows Hello (hello.json) and Touch ID (touchid.json) keep beside the vault: the wrapped
// vault key and the dates of the 14-day master password rule, sealed to the vault key. The two differ
// only in how the key is wrapped; storing, reading, sealing and checking the record is shared here.
const fs = require("node:fs");
const crypto = require("node:crypto");
const { writeFileAtomic } = require("./atomic-write.cjs");
const { readFileRetry } = require("./read-retry.cjs");
const { MASTER_EVERY_MS, masterDue } = require("../core/index.js");

const KEY_BYTES = 32;
const DAY_MS = 24 * 3600 * 1000;
const SEAL_INFO = "kapevault-master-dates-v2";

class HelloError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HelloError";
    this.code = code;
  }
}

// hello.json and touchid.json are plain JSON, so their dates are sealed with an HMAC keyed from the
// vault key: an edited masterAt or highWater no longer matches, and only someone who already holds
// the vault key can make a new seal. (Binding the dates into the wrap itself would need a Hello
// prompt every time the master password is typed, since only Hello can re-make the wrap key.)
function sealOf(vaultKey, record, fields) {
  const macKey = Buffer.from(crypto.hkdfSync("sha256", vaultKey, Buffer.alloc(0), SEAL_INFO, KEY_BYTES));
  try {
    return crypto.createHmac("sha256", macKey).update(JSON.stringify(fields.map((f) => record[f]))).digest();
  } finally {
    macKey.fill(0);
  }
}

// A v1 record has no seal, so nothing proves which vault key it belongs to.
const sealOk = (vaultKey, record, fields) => record.version === 2 && crypto.timingSafeEqual(sealOf(vaultKey, record, fields), Buffer.from(record.seal, "base64"));

// file: the record's path. sealed: the record fields the seal covers, in order. valid(record): the
// record's own shape check (each kind wraps the key its own way). fail(code): that kind's HelloError.
function createBiometricRecord({ file, sealed, valid, fail, now, masterEveryMs }) {
  function remove() {
    fs.rmSync(file, { force: true });
  }

  // undefined = no file; null = file there but unusable; otherwise a checked record. A file that cannot
  // be read right now (antivirus, a sync tool) is neither missing nor unusable: after a brief retry the
  // call fails as "failed", and nothing removes the record or calls it stale.
  function read() {
    let raw;
    try {
      raw = readFileRetry(file);
    } catch {
      throw fail("failed");
    }
    if (raw === null) return undefined;
    try {
      const r = JSON.parse(raw);
      return valid(r) ? r : null;
    } catch {
      return null;
    }
  }

  const needsMaster = (record) => masterDue(record, now(), masterEveryMs); // core: the 14-day rule
  // The calls below that never throw: a record that cannot be read right now is left as it is.
  const readOr = (busy) => {
    try {
      return read();
    } catch {
      return busy;
    }
  };
  const masterAt = () => readOr(null)?.masterAt ?? null;

  // Every write is a v2 record with its dates sealed to the vault key.
  function writeSealed(vaultKey, fields) {
    const record = { ...fields, version: 2 };
    writeFileAtomic(file, JSON.stringify({ ...record, seal: sealOf(vaultKey, record, sealed).toString("base64") }));
  }

  function status() {
    const record = readOr(null); // busy: on, and the unlock reads it again
    if (record === undefined) return { enabled: false, needsMaster: false };
    return { enabled: true, needsMaster: record !== null && needsMaster(record) };
  }

  // A record this vault key did not seal: one left from before a restore or a master password change
  // (its disable failed), an edited one, a damaged one or an old v1 record. It cannot unlock this
  // vault; Settings says Hello needs turning on again.
  const sealedWith = (vaultKey, record) => Boolean(record) && sealOk(vaultKey, record, sealed);
  function isStale(vaultKey) {
    const record = readOr(undefined); // busy: not known to be stale
    return record !== undefined && !sealedWith(vaultKey, record);
  }

  // The master password was just typed (vaultKey = the key it opened): the 14 days and the latest
  // time seen start again, sealed. Only a record this key sealed is sealed again - sealing a stale one
  // would bind it to a key it does not wrap, and Hello would answer "master-required" forever - so a
  // stale one is removed. Never throws: a failed write (or a read antivirus holds up) must not fail the
  // unlock that called it. The record then stays as it was: its dates do not move, and a stale one
  // fails as "changed" when used.
  function touchMaster(vaultKey) {
    try {
      const record = read();
      if (record === undefined) return;
      const t = now();
      if (sealedWith(vaultKey, record)) writeSealed(vaultKey, { ...record, masterAt: t, highWater: t });
      else remove();
    } catch {
      // left as it was, see above
    }
  }

  return { remove, read, needsMaster, masterAt, writeSealed, status, sealedWith, isStale, touchMaster };
}

module.exports = { createBiometricRecord, HelloError, sealOf, sealOk, masterDue, KEY_BYTES, DAY_MS, MASTER_EVERY_MS };
