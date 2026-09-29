import { base32Decode, parseTotp } from "@core";
import type { TotpCode } from "./types";

// RFC 6238 over WebCrypto: core parses the stored otpauth URI, the HMAC happens here. Shared by the
// mock and the real host.
export async function totpCode(uri: string, now = Date.now()): Promise<TotpCode> {
  const t = parseTotp(uri);
  const counter = Math.floor(now / 1000 / t.period);
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(base32Decode(t.secret)), { name: "HMAC", hash: t.algorithm.replace("SHA", "SHA-") }, false, ["sign"]);
  const message = new ArrayBuffer(8);
  new DataView(message).setUint32(0, Math.floor(counter / 2 ** 32));
  new DataView(message).setUint32(4, counter >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const at = mac[mac.length - 1] & 15;
  const binary = ((mac[at] & 0x7f) << 24) | (mac[at + 1] << 16) | (mac[at + 2] << 8) | mac[at + 3];
  return { code: String(binary % 10 ** t.digits).padStart(t.digits, "0"), period: t.period, expiresAt: (counter + 1) * t.period * 1000 };
}
