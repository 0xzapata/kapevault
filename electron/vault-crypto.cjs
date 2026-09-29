// Vault file encryption. Master password -> scrypt key -> AES-256-GCM over the whole vault JSON.
// GCM's auth tag means a wrong password and a tampered file both fail loudly instead of decoding garbage.
const crypto = require("node:crypto");
// The header rule, the KDF settings and the size limit are core/vault-format.js (shared with the phone).
const { cleanVault, checkVaultFile, parseVaultFile, MAX_VAULT_BYTES, VAULT_KDF: KDF } = require("../core/index.js");

const KEY_BYTES = 32;
const MAX_MEM = 256 * 1024 * 1024; // must exceed 128 * N * r bytes (~128 MB)

function deriveKey(password, salt, kdf = KDF) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize("NFC"), salt, KEY_BYTES, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: MAX_MEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

function encryptWithKey(key, kdf, salt, data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return {
    format: "kapevault",
    version: 1,
    kdf: { ...kdf, salt: salt.toString("base64") },
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: body.toString("base64"),
  };
}

// Returns the decoded vault, or null when the password is wrong, the file was altered, or what it holds
// is not a usable vault (cleanVault: every open reads the contents as untrusted).
function decryptWithKey(key, file) {
  try {
    // Pin the tag length so a truncated (forgeable) tag is rejected, not accepted.
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(file.iv, "base64"), { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from(file.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(file.data, "base64")), decipher.final()]);
    return cleanVault(JSON.parse(plain.toString("utf8")));
  } catch {
    return null;
  }
}

async function createKey(password) {
  const salt = crypto.randomBytes(16);
  return { key: await deriveKey(password, salt), kdf: KDF, salt };
}

async function openFile(password, file) {
  checkVaultFile(file);
  const salt = Buffer.from(file.kdf.salt, "base64");
  const kdf = { name: file.kdf.name, N: file.kdf.N, r: file.kdf.r, p: file.kdf.p };
  const key = await deriveKey(password, salt, kdf);
  const data = decryptWithKey(key, file);
  if (data === null) {
    key.fill(0);
    return null;
  }
  return { key, kdf, salt, data };
}

// Opens the file with a key that is already derived (Windows Hello unwraps it). null = wrong key.
function openFileWithKey(key, file) {
  checkVaultFile(file);
  const data = decryptWithKey(key, file);
  if (data === null) return null;
  const kdf = { name: file.kdf.name, N: file.kdf.N, r: file.kdf.r, p: file.kdf.p };
  return { key, kdf, salt: Buffer.from(file.kdf.salt, "base64"), data };
}

module.exports = { createKey, openFile, openFileWithKey, encryptWithKey, checkVaultFile, parseVaultFile, MAX_VAULT_BYTES };
