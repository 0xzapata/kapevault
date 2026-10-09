// Unlock with Windows Hello (the Bitwarden desktop design). A TPM-backed Hello key named "KAPEVault"
// signs a stored random challenge; RSA PKCS#1 v1.5 signatures are deterministic, so the signature is
// a stable secret only Hello can produce. HKDF turns it into a wrap key that AES-GCM-encrypts the
// vault key into <dataDir>/hello.json. The master password is still asked for every 14 days, and
// the dates that decide it are sealed to the vault key (sealOf, biometric-record.cjs).
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { runPsJson } = require("./system-tools.cjs");
const { createBiometricRecord, HelloError, sealOk, KEY_BYTES, DAY_MS, MASTER_EVERY_MS } = require("./biometric-record.cjs");

const CREDENTIAL = "KAPEVault";
const HKDF_INFO = "kapevault-hello-v1";
const FAKE_SEED = "kapevault-fake-hello";
// The record fields the seal covers, in order.
const SEALED = ["version", "credential", "challenge", "iv", "tag", "wrapped", "masterAt", "highWater"];

function messages(masterEveryMs) {
  const days = Math.max(1, Math.round(masterEveryMs / DAY_MS));
  return {
    unsupported: "Windows Hello is not set up on this PC.",
    blocked: "This PC's policy blocks Windows Hello for KAPEVault.",
    "not-enabled": "Windows Hello is off for KAPEVault.",
    canceled: "Windows Hello was cancelled.",
    "master-required": `Enter your master password - KAPEVault asks for it every ${days} days.`,
    "locked-out": "Windows Hello is locked. Use your master password.",
    changed: "Windows Hello changed on this PC. Unlock with your master password, then turn it on again in Settings.",
    failed: "Windows Hello did not work. Use your master password.",
  };
}

// --- PowerShell bridge -------------------------------------------------------------------------

const OPS = { supported: 20_000, create: 120_000, sign: 120_000, delete: 20_000 };
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

// Resolves with the script's JSON result. Rejects only on spawn failure, timeout, or unreadable output.
async function runScript(op, challenge = "") {
  if (!Object.hasOwn(OPS, op) || !B64.test(challenge)) throw new Error("Bad Hello request");
  // Electron's fs reads inside app.asar; powershell.exe cannot, so the script travels as command text.
  const body = fs.readFileSync(path.join(__dirname, "windows-hello.ps1"), "utf8").replace(/^\uFEFF/, "");
  const script = `$Op = '${op}'; $Challenge = '${challenge}'\n${body}`;
  try {
    return await runPsJson({ script, timeoutMs: OPS[op] });
  } catch (e) {
    throw new Error(e.timedOut ? "Windows Hello timed out" : "Windows Hello gave no answer");
  }
}

// Fake Hello for tests: "approve" signs deterministically (256 bytes, like RSA-2048), "cancel" cancels.
function fakeSignature(challenge) {
  const parts = [];
  for (let i = 0; parts.length * 32 < 256; i++) {
    parts.push(crypto.createHmac("sha256", FAKE_SEED).update(challenge).update(Buffer.from([i])).digest());
  }
  return Buffer.concat(parts).subarray(0, 256);
}

function fakeBackend(mode) {
  const answer = (challenge) =>
    mode === "approve" ? { status: "Success", signature: fakeSignature(Buffer.from(challenge, "base64")).toString("base64") } : { status: "UserCanceled" };
  return {
    supported: async () => ({ status: "Success", supported: true }),
    create: async (challenge) => answer(challenge),
    sign: async (challenge) => answer(challenge),
    delete: async () => ({ status: "Success" }),
  };
}

const realBackend = {
  supported: () => runScript("supported"),
  create: (challenge) => runScript("create", challenge),
  sign: (challenge) => runScript("sign", challenge),
  delete: () => runScript("delete"),
};

// --- module ------------------------------------------------------------------------------------

// hello.json's shape: a v1 or v2 record for this credential, every binary field the right size.
function validRecord(r) {
  const v2 = r.version === 2;
  const sizes = { challenge: 32, iv: 12, tag: 16, wrapped: KEY_BYTES, ...(v2 && { seal: 32 }) };
  if (!(v2 || r.version === 1) || r.credential !== CREDENTIAL || !Number.isFinite(r.masterAt)) return false;
  if (v2 && !Number.isFinite(r.highWater)) return false;
  for (const [field, size] of Object.entries(sizes)) {
    if (typeof r[field] !== "string" || !B64.test(r[field]) || Buffer.from(r[field], "base64").length !== size) return false;
  }
  return true;
}

// backend: a stand-in for the PowerShell bridge (tests); fake: the approve|cancel stand-in for Hello.
function createWindowsHello({ dataDir, fake, backend = fake ? fakeBackend(fake) : realBackend, now = () => Date.now(), masterEveryMs = MASTER_EVERY_MS }) {
  const file = path.join(dataDir, "hello.json");
  const MSG = messages(masterEveryMs);
  const fail = (code) => new HelloError(code, MSG[code]);
  const { remove, read, needsMaster, masterAt, writeSealed, status: recordStatus, isStale, touchMaster } = createBiometricRecord({ file, sealed: SEALED, valid: validRecord, fail, now, masterEveryMs });
  let busy = false;
  let blocked = false; // the last answer was "Constrained": this PC's policy stops the PowerShell bridge

  function statusError(status, op) {
    if (status === "Constrained") return fail("blocked");
    if (status === "UserCanceled" || status === "UserPrefersPassword") return fail("canceled");
    if (status === "SecurityDeviceLocked") return fail("locked-out");
    if (status === "Unsupported") return fail("unsupported");
    if (status === "NotFound" && op === "sign") return fail("changed");
    return fail("failed");
  }

  function wrapKeyFor(signature, challenge) {
    return Buffer.from(crypto.hkdfSync("sha256", signature, challenge, HKDF_INFO, KEY_BYTES));
  }

  // One Hello prompt at a time; a second request while one is open fails instead of stacking.
  async function prompt(op, challenge) {
    if (!fake && process.platform !== "win32") throw fail("unsupported");
    if (busy) throw fail("failed");
    busy = true;
    try {
      const result = await backend[op](challenge.toString("base64"));
      blocked = result.status === "Constrained";
      if (result.status !== "Success" || typeof result.signature !== "string") throw statusError(result.status, op);
      const signature = Buffer.from(result.signature, "base64");
      if (signature.length < KEY_BYTES) {
        signature.fill(0);
        throw fail("failed");
      }
      return signature;
    } catch (err) {
      throw err instanceof HelloError ? err : fail("failed");
    } finally {
      busy = false;
    }
  }

  async function isSupported() {
    if (fake) return true;
    if (process.platform !== "win32") return false;
    try {
      const result = await backend.supported();
      blocked = result.status === "Constrained";
      return result.status === "Success" && result.supported === true;
    } catch {
      return false;
    }
  }

  // lastMasterAt: when the master password was last typed. Turning Hello off and on again keeps
  // that date, so it can never restart the 14 days without the master password.
  async function enable(vaultKey, lastMasterAt = now()) {
    if (!Buffer.isBuffer(vaultKey) || vaultKey.length !== KEY_BYTES) throw fail("failed");
    const challenge = crypto.randomBytes(32);
    const signature = await prompt("create", challenge);
    const wrapKey = wrapKeyFor(signature, challenge);
    try {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", wrapKey, iv);
      const wrapped = Buffer.concat([cipher.update(vaultKey), cipher.final()]);
      const t = now();
      writeSealed(vaultKey, {
        credential: CREDENTIAL,
        challenge: challenge.toString("base64"),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        wrapped: wrapped.toString("base64"),
        masterAt: Math.min(lastMasterAt, t),
        highWater: t,
      });
    } finally {
      wrapKey.fill(0);
      signature.fill(0);
    }
  }

  async function unlock() {
    const record = read();
    if (record === undefined) throw fail("not-enabled");
    if (record === null) {
      remove();
      throw fail("changed");
    }
    if (needsMaster(record)) throw fail("master-required");

    const challenge = Buffer.from(record.challenge, "base64");
    let signature;
    try {
      signature = await prompt("sign", challenge);
    } catch (err) {
      if (err.code === "changed") remove();
      throw err;
    }
    const wrapKey = wrapKeyFor(signature, challenge);
    // The decipher's own output buffers hold the key too; only the returned copy may keep it.
    let part;
    let last;
    let key;
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", wrapKey, Buffer.from(record.iv, "base64"), { authTagLength: 16 });
      decipher.setAuthTag(Buffer.from(record.tag, "base64"));
      part = decipher.update(Buffer.from(record.wrapped, "base64"));
      last = decipher.final();
      key = Buffer.concat([part, last]);
    } catch {
      // A different key signed (credential replaced) or the file was altered: Hello is off until re-enabled.
      remove();
      throw fail("changed");
    } finally {
      part?.fill(0);
      last?.fill(0);
      wrapKey.fill(0);
      signature.fill(0);
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
    remove();
    if (fake || process.platform !== "win32") return;
    try {
      await backend.delete();
    } catch {
      // best-effort: a credential already gone in Windows settings is fine
    }
  }

  // Once Hello was asked and this PC's policy (Constrained Language Mode) blocked the bridge, the status
  // says so (blockedByPolicy), and Settings can tell that from "not set up". Touch ID has no such state.
  const status = () => ({ ...recordStatus(), ...(blocked && { blockedByPolicy: true }) });

  return { status, isSupported, enable, unlock, disable, touchMaster, isStale, masterAt };
}

// runScript is exported for the Windows-only script test; it is not part of the app contract.
module.exports = { createWindowsHello, HelloError, _runScript: runScript };
