// The current 2FA code for a stored otpauth:// URI (RFC 6238). Parsing the URI is core's (parseTotp);
// the HMAC is Node's.
const crypto = require("node:crypto");
const { parseTotp, base32Decode } = require("../core/index.js");

// RFC 4226 HOTP over the RFC 6238 time step.
function totpCode(uri, nowMs = Date.now()) {
  const { secret, algorithm, digits, period } = parseTotp(uri);
  const counter = Math.floor(nowMs / 1000 / period);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac(algorithm.toLowerCase(), base32Decode(secret)).update(msg).digest();

  // Dynamic truncation: low nibble of the last byte picks a 31-bit window.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  const code = String(binary % 10 ** digits).padStart(digits, "0");
  return { code, period, expiresAt: (counter + 1) * period * 1000 };
}

module.exports = { totpCode };
