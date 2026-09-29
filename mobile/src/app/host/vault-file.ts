// The vault file (FORMAT.md), byte-compatible with the PC's electron/vault-crypto.cjs: master password
// (NFC, UTF-8) -> scrypt N=2^17 r=8 p=1 -> AES-256-GCM over the whole vault JSON. WebCrypto for AES
// and the Opener's scrypt. vault-file.test.mjs proves files go both ways with the PC's code. The header
// rule (checkVaultFile, before ANY key derivation), the KDF settings and the size limit are core's
// (core/vault-format.js), the same as the PC's.
import { MAX_VAULT_BYTES, VAULT_KDF as KDF, checkVaultFile, cleanVault, parseVaultFile } from "@core";
import { scrypt, type ScryptStep } from "./scrypt";

export { MAX_VAULT_BYTES, checkVaultFile, parseVaultFile };
const KEY_BYTES = 32;

export interface Kdf {
  name: "scrypt";
  N: number;
  r: number;
  p: number;
}
export interface VaultFile {
  format: string;
  version: 1;
  kdf: Kdf & { salt: string };
  iv: string;
  tag: string;
  data: string;
}
// The decrypted JSON. core/ owns its rules; the host only carries it.
export type VaultData = { spaces: any[]; entries: any[]; [field: string]: any };

// An open vault: the raw key (for the fingerprint wrap and the seal; wiped on lock), the same key as a
// non-extractable AES key, and the header it was opened with.
export interface OpenVault {
  raw: Uint8Array;
  key: CryptoKey;
  kdf: Kdf;
  salt: Uint8Array;
  data: VaultData;
}

export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export function fromBase64(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  try {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

const aesKey = (raw: Uint8Array) => crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);

export function deriveKey(password: string, salt: Uint8Array, kdf: Kdf, step?: ScryptStep) {
  return scrypt(new TextEncoder().encode(password.normalize("NFC")), salt, kdf, KEY_BYTES, step);
}

export async function encryptWithKey(key: CryptoKey, kdf: Kdf, salt: Uint8Array, data: VaultData): Promise<VaultFile> {
  const iv = randomBytes(12);
  // WebCrypto returns the ciphertext with the 16-byte tag appended; the file keeps them apart.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, new TextEncoder().encode(JSON.stringify(data))));
  return {
    format: "kapevault",
    version: 1,
    kdf: { name: kdf.name, N: kdf.N, r: kdf.r, p: kdf.p, salt: toBase64(salt) },
    iv: toBase64(iv),
    tag: toBase64(sealed.subarray(sealed.length - 16)),
    data: toBase64(sealed.subarray(0, sealed.length - 16)),
  };
}

// The decoded vault, or null when the key is wrong, the file was altered (GCM's tag), or what it holds is
// not a usable vault (cleanVault: every open reads the contents as untrusted, as the PC does).
export async function decryptWithKey(key: CryptoKey, file: VaultFile): Promise<VaultData | null> {
  const body = fromBase64(file.data);
  const tag = fromBase64(file.tag);
  if (!body || !tag) return null;
  const sealed = new Uint8Array(body.length + tag.length);
  sealed.set(body);
  sealed.set(tag, body.length);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(file.iv) as BufferSource, tagLength: 128 }, key, sealed);
    return cleanVault(JSON.parse(new TextDecoder().decode(plain))) as VaultData;
  } catch {
    return null;
  }
}

const kdfOf = (file: VaultFile): Kdf => ({ name: "scrypt", N: file.kdf.N, r: file.kdf.r, p: file.kdf.p });

// With the master password. null = wrong password (or an altered file); throws on a file that is not one.
export async function openFile(password: string, file: VaultFile, step?: ScryptStep): Promise<OpenVault | null> {
  checkVaultFile(file);
  const salt = fromBase64(file.kdf.salt) as Uint8Array;
  const raw = await deriveKey(password, salt, kdfOf(file), step);
  const opened = await openFileWithKey(raw, file);
  if (!opened) raw.fill(0);
  return opened;
}

// With a key already derived (the fingerprint unwraps it, or the open session's). null = wrong key.
export async function openFileWithKey(raw: Uint8Array, file: VaultFile): Promise<OpenVault | null> {
  checkVaultFile(file);
  const key = await aesKey(raw);
  const data = await decryptWithKey(key, file);
  return data ? { raw, key, kdf: kdfOf(file), salt: fromBase64(file.kdf.salt) as Uint8Array, data } : null;
}

// A new master password: a new random salt and key.
export async function createKey(password: string, step?: ScryptStep) {
  const salt = randomBytes(16);
  const raw = await deriveKey(password, salt, KDF, step);
  return { raw, key: await aesKey(raw), kdf: { ...KDF } as Kdf, salt };
}
