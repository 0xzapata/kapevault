// Unlock with Touch ID on macOS - same contract as windows-hello.cjs, so main.cjs can pick one.
// The vault key is encrypted with Electron's safeStorage (an AES key kept in the macOS Keychain that
// only this app's code signature may read) and stored in <dataDir>/touchid.json. Touch ID then gates
// the decrypt through systemPreferences.promptTouchID.
// Limit, stated plainly: the Keychain item is not bound to biometrics. promptTouchID is a UI gate, so
// code running as this app (or a user who approves a Keychain prompt) can decrypt without a finger.
// Binding the item to kSecAccessControlUserPresence needs a native module; this is the standard
// Electron trade-off. The 14-day master password rule still applies, its dates sealed to the vault
// key the same way as Windows Hello's.
const path = require("node:path");
const crypto = require("node:crypto");
const { createBiometricRecord, HelloError, sealOk, KEY_BYTES, DAY_MS, MASTER_EVERY_MS } = require("./biometric-record.cjs");

// The record fields the seal covers, in order.
const SEALED = ["version", "wrapped", "masterAt", "highWater"];
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const REASON = "unlock KAPEVault";

function messages(masterEveryMs) {
  const days = Math.max(1, Math.round(masterEveryMs / DAY_MS));
  return {
    unsupported: "Touch ID is not set up on this Mac.",
    "not-enabled": "Touch ID is off for KAPEVault.",
    canceled: "Touch ID was cancelled.",
    "master-required": `Enter your master password - KAPEVault asks for it every ${days} days.`,
    "locked-out": "Touch ID is locked. Use your master password.",
    changed: "Touch ID changed on this Mac. Unlock with your master password, then turn it on again in Settings.",
    failed: "Touch ID did not work. Use your master password.",
  };
}

// Fakes for tests on any OS: safeStorage is AES-GCM under a fixed key (reversible, detects
// tampering like a failed Keychain decrypt); promptTouchID approves or cancels.
function fakeSafeStorage() {
  const key = crypto.createHash("sha256").update("kapevault-fake-touchid").digest();
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(buf) {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12), { authTagLength: 16 });
      decipher.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
}

function fakeSystemPreferences(mode) {
  return {
    canPromptTouchID: () => true,
    promptTouchID: async () => {
      if (mode !== "approve") throw new Error("User canceled");
    },
  };
}

// touchid.json's shape: a v1 or v2 record with a wrapped key, and a v2 one with its seal.
function validRecord(r) {
  const v2 = r.version === 2;
  if (!(v2 || r.version === 1) || !Number.isFinite(r.masterAt) || typeof r.wrapped !== "string" || !B64.test(r.wrapped)) return false;
  if (v2 && !(Number.isFinite(r.highWater) && typeof r.seal === "string" && B64.test(r.seal) && Buffer.from(r.seal, "base64").length === 32)) return false;
  return true;
}

function createTouchId({ dataDir, fake, now = () => Date.now(), masterEveryMs = MASTER_EVERY_MS, safeStorage, systemPreferences }) {
  const file = path.join(dataDir, "touchid.json");
  const store = fake ? fakeSafeStorage() : safeStorage;
  const prefs = fake ? fakeSystemPreferences(fake) : systemPreferences;
  const MSG = messages(masterEveryMs);
  const fail = (code) => new HelloError(code, MSG[code]);
  // The record itself (read with retry, sealed dates, stale check): biometric-record.cjs.
  const { remove, read, needsMaster, masterAt, writeSealed, status, isStale, touchMaster } = createBiometricRecord({ file, sealed: SEALED, valid: validRecord, fail, now, masterEveryMs });
  let busy = false;

  const onMac = () => fake || process.platform === "darwin";

  function canPrompt() {
    try {
      return onMac() && store.isEncryptionAvailable() && prefs.canPromptTouchID();
    } catch {
      return false;
    }
  }

  // One Touch ID sheet at a time; a second request while one is open fails instead of stacking.
  async function prompt() {
    if (!canPrompt()) throw fail("unsupported");
    if (busy) throw fail("failed");
    busy = true;
    try {
      await prefs.promptTouchID(REASON);
    } catch {
      // Electron rejects with a plain Error for cancel, fallback and lockout alike.
      throw fail("canceled");
    } finally {
      busy = false;
    }
  }

  async function isSupported() {
    return canPrompt();
  }

  // lastMasterAt: see windows-hello.cjs - re-enabling never restarts the 14 days.
  async function enable(vaultKey, lastMasterAt = now()) {
    if (!Buffer.isBuffer(vaultKey) || vaultKey.length !== KEY_BYTES) throw fail("failed");
    await prompt();
    let wrapped;
    try {
      // The base64 string cannot be wiped from memory; the caller still owns and wipes vaultKey.
      wrapped = store.encryptString(vaultKey.toString("base64"));
    } catch {
      throw fail("failed");
    }
    const t = now();
    writeSealed(vaultKey, { wrapped: wrapped.toString("base64"), masterAt: Math.min(lastMasterAt, t), highWater: t });
  }

  async function unlock() {
    const record = read();
    if (record === undefined) throw fail("not-enabled");
    if (record === null) {
      remove();
      throw fail("changed");
    }
    if (needsMaster(record)) throw fail("master-required");

    await prompt();
    let key;
    try {
      // safeStorage hands back a string, which cannot be wiped; the key buffer made from it can.
      const text = store.decryptString(Buffer.from(record.wrapped, "base64"));
      key = Buffer.from(text, "base64");
      if (key.length !== KEY_BYTES || key.toString("base64") !== text) throw new Error("not a key");
    } catch {
      key?.fill(0);
      // Keychain key gone or replaced, or the file was altered: Touch ID is off until re-enabled.
      remove();
      throw fail("changed");
    }
    try {
      // Edited dates: the master password is asked for, and typing it seals them again (touchMaster).
      if (!sealOk(key, record, SEALED)) throw fail("master-required");
      writeSealed(key, { ...record, highWater: Math.max(record.highWater, now()) });
      return key;
    } catch (err) {
      key.fill(0);
      throw err instanceof HelloError ? err : fail("failed");
    }
  }

  async function disable() {
    // The safeStorage Keychain item is shared app-wide, so only our file goes.
    remove();
  }

  return { status, isSupported, enable, unlock, disable, touchMaster, isStale, masterAt };
}

module.exports = { createTouchId };
