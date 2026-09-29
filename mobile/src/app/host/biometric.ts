// Fingerprint unlock, the phone's Windows Hello (electron/windows-hello.cjs). The VaultKeystore plugin
// wraps the 32-byte vault key with an Android Keystore key only a strong biometric can use; this file
// keeps the rest: the master password is still asked for every 14 days, and the dates that decide it
// (fingerprint.json) are sealed with an HMAC keyed from the vault key - the PC's v2 seal - so editing
// them needs the vault key. A seal, not part of the wrap: re-wrapping would need a fingerprint prompt
// every time the master password is typed.
import { MASTER_EVERY_MS, masterDue } from "@core";
import { fromBase64, toBase64 } from "./vault-file";
import type { Store } from "./storage";
import type { BiometricErrorCode, BiometricResult, BiometricStatus } from "./types";

// The native plugin (mobile/android/.../VaultKeystorePlugin.kt). Rejects with one of BiometricErrorCode.
export interface Keystore {
  isAvailable(): Promise<{ available: boolean; enabled: boolean }>;
  enable(options: { key: string }): Promise<void>;
  unlock(): Promise<{ key: string }>;
  disable(): Promise<void>;
}

export { MASTER_EVERY_MS }; // the 14 days (core/master-due.js)
const FILE = "fingerprint.json";
const SEAL_INFO = "kapevault-master-dates-v2"; // = biometric-record.cjs
export const SEALED = ["version", "masterAt", "highWater"] as const; // the fields the seal covers, in order
const CODES: BiometricErrorCode[] = ["not-enabled", "canceled", "locked-out", "changed", "unsupported", "failed"];

export const MASTER_DUE = "Enter your master password - KAPEVault asks for it every 14 days.";
const MESSAGES: Record<BiometricErrorCode, string> = {
  unsupported: "This phone cannot use fingerprint unlock.",
  "not-enabled": "Fingerprint unlock is off.",
  canceled: "Fingerprint unlock was cancelled.",
  "locked-out": "Too many tries. Use your master password.",
  changed: "Fingerprints changed on this phone. Unlock with your master password, then turn fingerprint unlock on again.",
  failed: "Fingerprint unlock did not work. Use your master password.",
  "master-required": "Enter your master password to unlock this time.",
};

interface DatesRecord {
  version: 2;
  masterAt: number; // when the master password was last typed
  highWater: number; // the latest time this record has seen: a clock set back a day past it counts as due
  seal: string;
}

const fail = (code: BiometricErrorCode, error = MESSAGES[code]) => ({ ok: false as const, code, error });
const codeOf = (e: unknown): BiometricErrorCode => {
  const code = (e as { code?: string })?.code;
  return CODES.includes(code as BiometricErrorCode) ? (code as BiometricErrorCode) : "failed";
};

async function macKey(vaultKey: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", vaultKey as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(SEAL_INFO) },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}
const sealed = (record: Omit<DatesRecord, "seal">) => new TextEncoder().encode(JSON.stringify(SEALED.map((f) => record[f])));

// = sealOf(vaultKey, record, SEALED) on the PC.
export async function sealOf(vaultKey: Uint8Array, record: Omit<DatesRecord, "seal">) {
  return toBase64(new Uint8Array(await crypto.subtle.sign("HMAC", await macKey(vaultKey), sealed(record))));
}
// Constant-time, by WebCrypto's verify.
async function sealOk(vaultKey: Uint8Array, record: DatesRecord) {
  const seal = fromBase64(record.seal);
  return Boolean(seal) && crypto.subtle.verify("HMAC", await macKey(vaultKey), seal as BufferSource, sealed(record));
}

export function createBiometric({ keystore, store, now }: { keystore: Keystore; store: Store; now: () => number }) {
  // null: none, or not a record this app wrote.
  async function read(): Promise<DatesRecord | null> {
    try {
      const r = JSON.parse((await store.read(FILE)) ?? "");
      return r?.version === 2 && Number.isFinite(r.masterAt) && Number.isFinite(r.highWater) && typeof r.seal === "string" ? r : null;
    } catch {
      return null;
    }
  }
  async function write(vaultKey: Uint8Array, dates: { masterAt: number; highWater: number }) {
    const record = { version: 2 as const, ...dates };
    await store.write(FILE, JSON.stringify({ ...record, seal: await sealOf(vaultKey, record) }));
  }
  const enabled = async () => (await keystore.isAvailable().catch(() => ({ available: false, enabled: false }))).enabled;

  async function disable() {
    await keystore.disable().catch(() => {});
    await store.remove(FILE).catch(() => {});
  }

  return {
    disable,

    async status(): Promise<BiometricStatus> {
      const { available, enabled } = await keystore.isAvailable().catch(() => ({ available: false, enabled: false }));
      if (!enabled) return { available, enabled: false, needsMaster: false };
      const record = await read();
      return { available, enabled: true, needsMaster: !record || masterDue(record, now()) };
    },

    // Unlocked only. lastMasterAt: when the master password was last typed - turning fingerprint off
    // and on again keeps that date, so it can never restart the 14 days without the master password.
    async enable(vaultKey: Uint8Array, lastMasterAt: number): Promise<BiometricResult> {
      try {
        await keystore.enable({ key: toBase64(vaultKey) });
      } catch (e) {
        return fail(codeOf(e));
      }
      const t = now();
      try {
        await write(vaultKey, { masterAt: Math.min(lastMasterAt, t), highWater: t });
      } catch {
        await disable(); // a wrap with no dates would ask for the master password forever
        return fail("failed");
      }
      return { ok: true };
    },

    // Unwraps the vault key and opens the vault with it (open: null when it does not open), then checks
    // the seal - in that order, so a wrap of another key (the vault was re-keyed) reads "changed" and is
    // turned off, and only edited dates read "master password due". open's result carries the key.
    async unlock<T>(open: (key: Uint8Array) => Promise<T | null>): Promise<{ ok: true; opened: T; masterAt: number } | Extract<BiometricResult, { ok: false }>> {
      if (!(await enabled())) return fail("not-enabled");
      const record = await read();
      if (!record || masterDue(record, now())) return fail("failed", MASTER_DUE);
      let wrapped: string;
      try {
        ({ key: wrapped } = await keystore.unlock());
      } catch (e) {
        const code = codeOf(e);
        if (code === "changed") await disable(); // the plugin already dropped its key; the dates go too
        return fail(code);
      }
      const key = fromBase64(wrapped);
      if (key?.length !== 32) return fail("failed");
      const opened = await open(key).catch(() => null);
      if (!opened) {
        key.fill(0);
        await disable();
        return fail("changed", "Fingerprint unlock no longer opens this vault. Unlock with your master password, then turn it on again in Settings.");
      }
      try {
        // Edited dates: the master password is asked for, and typing it seals them again (touchMaster).
        if (!(await sealOk(key, record))) {
          await write(key, { masterAt: 0, highWater: record.highWater });
          key.fill(0);
          return fail("failed", MASTER_DUE);
        }
        await write(key, { masterAt: record.masterAt, highWater: Math.max(record.highWater, now()) });
      } catch {
        key.fill(0);
        return fail("failed");
      }
      return { ok: true, opened, masterAt: record.masterAt };
    },

    // The master password was just typed (vaultKey = the key it opened): the 14 days and the latest time
    // seen start again, sealed. Dates this key did not seal belong to a key the wrap no longer holds
    // (a restore or password change whose disable failed) or were edited: fingerprint unlock is turned
    // off and Settings shows it off. Never throws - an unlock must not fail over this.
    async touchMaster(vaultKey: Uint8Array) {
      try {
        const [on, record] = await Promise.all([enabled(), read()]);
        if (!on && !record) return;
        if (on && record && (await sealOk(vaultKey, record))) await write(vaultKey, { masterAt: now(), highWater: now() });
        else await disable();
      } catch {
        // left as it was
      }
    },
  };
}
