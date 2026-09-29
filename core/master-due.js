// The 14-day master password rule behind Windows Hello and Touch ID (electron/biometric-record.cjs) and the
// phone's fingerprint unlock (mobile host/biometric.ts): a key-only unlock still asks for the master
// password every 14 days. The record's dates are sealed by the host (HMAC of the vault key); this is
// only what they mean.

const DAY_MS = 24 * 60 * 60 * 1000;
export const MASTER_EVERY_MS = 14 * DAY_MS;

/**
 * The master password is due after `everyMs` since it was last typed, for a masterAt in the future, for a
 * clock more than a day behind the latest time the record has seen (set back to stretch the 14 days), and
 * for an old v1 record, whose dates were never sealed.
 * @param {{ version: number, masterAt: number, highWater: number }} record @param {number} now
 * @param {number} [everyMs] tests shorten it
 */
export function masterDue(record, now, everyMs = MASTER_EVERY_MS) {
  return record.version !== 2 || now - record.masterAt > everyMs || record.masterAt > now + 60 * 1000 || now < record.highWater - DAY_MS;
}
