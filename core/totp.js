// TOTP (RFC 6238) setup keys for 2FA entries. parseTotp normalizes whatever the user pasted into one
// otpauth:// URI (the stored form). The code itself needs an HMAC, so the host makes it (totpCode).

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ALGORITHMS = ["SHA1", "SHA256", "SHA512"];

const ERR_HOTP = "Counter-based (HOTP) codes are not supported.";
const ERR_MIGRATION = "Google Authenticator export codes are not supported. Use the setup key instead.";
const ERR_KEY = "That is not a valid 2FA setup key.";
const ERR_SHORT = "That setup key is too short.";
const ERR_SETTINGS = "Unsupported 2FA settings.";

// Google shows keys as "abcd efgh ..." groups; some sites add hyphens or "=" padding.
function normalizeSecret(raw) {
  const secret = String(raw || "").replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!secret || !/^[A-Z2-7]+$/.test(secret)) throw new Error(ERR_KEY);
  return secret;
}

// RFC 4648 base32 decode. Leftover bits (< 8) at the end are padding and get dropped.
/** @returns {Uint8Array} */
export function base32Decode(secret) {
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const ch of secret) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function parseUri(text) {
  const m = /^otpauth:\/\/([^/?#]*)\/?([^?#]*)(?:\?([^#]*))?/i.exec(text);
  if (!m) throw new Error(ERR_KEY);
  const type = m[1].toLowerCase();
  if (type === "hotp") throw new Error(ERR_HOTP);
  if (type !== "totp") throw new Error(ERR_KEY);

  // Param names are matched case-insensitively; first occurrence wins.
  const params = {};
  for (const [k, v] of new URLSearchParams(m[3] || "")) {
    const key = k.toLowerCase();
    if (!(key in params)) params[key] = v.trim();
  }

  const label = safeDecode(m[2]).trim();
  const colon = label.indexOf(":");
  const labelIssuer = colon >= 0 ? label.slice(0, colon).trim() : "";
  let account = colon >= 0 ? label.slice(colon + 1).trim() : label;
  const issuer = params.issuer || labelIssuer;
  // A bare label that just repeats the issuer is not an account name.
  if (colon < 0 && account === issuer) account = "";

  return { secret: params.secret, issuer, account, algorithm: params.algorithm, digits: params.digits, period: params.period };
}

function parseSettings(algorithm, digits, period) {
  const algo = (algorithm || "SHA1").toUpperCase().replace("-", "");
  const d = digits === undefined || digits === "" ? 6 : /^\d+$/.test(digits) ? Number(digits) : NaN;
  const p = period === undefined || period === "" ? 30 : /^\d+$/.test(period) ? Number(period) : NaN;
  if (!ALGORITHMS.includes(algo) || !(d >= 6 && d <= 8) || !(p >= 15 && p <= 120)) throw new Error(ERR_SETTINGS);
  return { algorithm: algo, digits: d, period: p };
}

function buildUri({ secret, issuer, account, algorithm, digits, period }) {
  const label = issuer && account ? `${issuer}:${account}` : issuer || account || "KAPEVault";
  const query = [`secret=${secret}`];
  if (issuer) query.push(`issuer=${encodeURIComponent(issuer)}`);
  query.push(`algorithm=${algorithm}`, `digits=${digits}`, `period=${period}`);
  return `otpauth://totp/${encodeURIComponent(label)}?${query.join("&")}`;
}

/** @returns {{ uri: string, secret: string, issuer: string, account: string, algorithm: string, digits: number, period: number }} */
export function parseTotp(input) {
  if (typeof input !== "string") throw new Error(ERR_KEY);
  const text = input.trim();
  const lower = text.toLowerCase();
  if (lower.startsWith("otpauth-migration:")) throw new Error(ERR_MIGRATION);

  const fields = lower.startsWith("otpauth:") ? parseUri(text) : { secret: text, issuer: "", account: "" };
  const secret = normalizeSecret(fields.secret);
  if (base32Decode(secret).length < 10) throw new Error(ERR_SHORT);
  const settings = parseSettings(fields.algorithm, fields.digits, fields.period);

  const result = { secret, issuer: fields.issuer, account: fields.account, ...settings };
  return { uri: buildUri(result), ...result };
}
