// Windows Hello / Touch ID: status, turning it on and off, and unlocking with it.
const { HelloError } = require("../biometric-record.cjs");

// lastMasterAt / setLastMasterAt: when the master password was last typed (main's state).
// setPrompting: the prompt has focus, so quick search must not hide for it. biometricKeyChanged: the
// one way it is turned off (a refused disable leaves a stale record, which Settings shows).
function register({ handle, attempt, vault, biometric, biometricName, biometricKeyChanged, unlocked, lastMasterAt, setLastMasterAt, setPrompting, windows }) {
  let supportedCache = null;

  // Windows Hello / Touch ID. stale: unlocked, a record this vault's key did not seal - it cannot open
  // this vault, and Settings says to turn it on again.
  async function biometricStatus() {
    if (supportedCache === null) supportedCache = await biometric.isSupported();
    let stale = false;
    if (vault.status().unlocked) {
      const key = vault.keyCopy();
      stale = biometric.isStale(key);
      key.fill(0);
    }
    return { name: biometricName, supported: supportedCache, ...biometric.status(), stale };
  }

  handle("biometric:status", () => biometricStatus());
  handle("biometric:enable", () =>
    attempt(async () => {
      const key = vault.keyCopy();
      try {
        await biometric.enable(key, lastMasterAt() ?? 0);
      } finally {
        key.fill(0);
      }
      return { status: await biometricStatus() };
    }),
  );
  // Turning it off is Settings' (unlocked); the lock screen never calls it.
  handle("biometric:disable", async () => {
    if (!vault.status().unlocked) throw new Error("Unlock the vault first.");
    await biometricKeyChanged();
    return biometricStatus();
  });
  handle("vault:unlockBiometric", async () => {
    let key;
    const helloMasterAt = biometric.masterAt(); // this session's master date, carried by the Hello record
    setPrompting(true);
    try {
      key = await biometric.unlock();
    } catch (e) {
      const code = e instanceof HelloError ? e.code : "failed";
      return { ok: false, code, error: e.message };
    } finally {
      setPrompting(false);
      const quickWin = windows.quick();
      if (quickWin?.isVisible()) quickWin.focus();
    }
    const result = vault.unlockWithKey(key);
    if (result.masterRequired) return { ok: false, code: "master-required", error: result.error };
    if (result.newer) return { ok: false, code: "failed", error: result.error }; // the key still fits: Hello stays on
    if (!result.ok) {
      await biometricKeyChanged();
      return { ok: false, code: "changed", error: `${biometricName} no longer opens this vault. Unlock with your master password, then turn it on again in Settings.` };
    }
    setLastMasterAt(helloMasterAt);
    return unlocked(result);
  });
}

module.exports = { register };
