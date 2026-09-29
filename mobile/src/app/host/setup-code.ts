import type { R2Keys, Result } from "./types";

// The PC's Settings > Backup > Add a phone QR: JSON with a marker and the three R2 values.
// {"kapevault":"r2","v":1,"url":"https://<account>.r2.cloudflarestorage.com/<bucket>","accessKeyId":"...","secretAccessKey":"..."}
export function parseSetupCode(text: string): Result<{ keys: R2Keys }> {
  const bad = { ok: false as const, error: "That is not a KAPEVault code. On your PC: Settings > Backup > Add a phone." };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return bad;
  }
  if (!data || typeof data !== "object") return bad;
  const d = data as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const keys = { url: str(d.url), accessKeyId: str(d.accessKeyId), secretAccessKey: str(d.secretAccessKey) };
  if (d.kapevault !== "r2" || d.v !== 1 || !/^https:\/\//.test(keys.url) || !keys.accessKeyId || !keys.secretAccessKey) return bad;
  return { ok: true, keys };
}
