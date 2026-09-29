// Just enough S3 for Cloudflare R2 - put, get, list, delete - signed with AWS Signature V4 over
// WebCrypto. The canonical request, the URL, error replies and listing pages are core/r2.js, the same as
// the PC's electron/r2-client.cjs; the request itself goes through a Transport: native HTTP in the app
// (native.ts), fetch in the tests.
import { R2_LIST_BYTES, R2_LIST_PAGES, R2_TOO_MANY_OBJECTS, listQuery, parseR2Url, r2Error, readListPage, sigV4Headers, sigV4Request, sigV4StringToSign } from "@core";
import { MAX_VAULT_BYTES } from "./vault-file";

export { parseR2Url };

export interface R2Target {
  endpoint: string; // https://<account>.r2.cloudflarestorage.com
  bucket: string;
}
// Where this phone backs up. Kept inside the encrypted vault as its top-level `cloud` field, which is
// this device's own and never syncs (SYNC.md 3.8).
export interface CloudConfig extends R2Target {
  accessKeyId: string;
  secretAccessKey: string;
  auto: boolean;
  apart?: boolean; // backup only: the bucket holds another vault, so nothing is merged from it
}
export interface R2Object {
  key: string;
  size: number;
  lastModified: number | null; // R2's own clock, ms
}

export interface HttpRequest {
  method: "GET" | "PUT" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body?: string;
}
export type Transport = (request: HttpRequest) => Promise<{ status: number; body: string }>;

const text = new TextEncoder();

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (data: string) => hex(await crypto.subtle.digest("SHA-256", text.encode(data)));
async function hmac(key: Uint8Array, data: string) {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, text.encode(data)));
}

interface SignInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  service?: string;
  now?: Date;
}

// The headers to send: the given ones plus x-amz-date, x-amz-content-sha256 and authorization. Host is
// signed but left out - the HTTP stack sets it from the same URL.
export async function signRequest({ method, url, headers = {}, body = "", accessKeyId, secretAccessKey, region = "auto", service = "s3", now = new Date() }: SignInput) {
  const request = sigV4Request({ method, url, headers, payloadHash: await sha256(body), now, region, service });
  const key = await hmac(await hmac(await hmac(await hmac(text.encode(`AWS4${secretAccessKey}`), request.day), region), service), "aws4_request");
  const signature = hex((await hmac(key, sigV4StringToSign(request, await sha256(request.canonical)))).buffer as ArrayBuffer);
  return sigV4Headers(request, accessKeyId, signature);
}

export type R2Client = ReturnType<typeof createR2Client>;

export function createR2Client({ endpoint, bucket, accessKeyId, secretAccessKey, transport }: R2Target & { accessKeyId: string; secretAccessKey: string; transport: Transport }) {
  async function send(method: HttpRequest["method"], key: string, { query = "", body, maxBytes }: { query?: string; body?: string; maxBytes?: number } = {}) {
    const url = `${endpoint}/${bucket}${key ? `/${key}` : ""}${query ? `?${query}` : ""}`;
    const headers = await signRequest({ method, url, body: body ?? "", accessKeyId, secretAccessKey });
    let res;
    try {
      res = await transport({ method, url, headers, body });
    } catch {
      throw new Error("Could not reach R2. Check the internet connection and the S3 API URL.");
    }
    if (res.status < 200 || res.status > 299) throw r2Error(res.status, res.body);
    // The native HTTP stack reads the whole reply before we see it: the cap is checked after.
    if (maxBytes && res.body.length > maxBytes) throw new Error("R2 sent an unexpectedly large reply.");
    return res.body;
  }

  return {
    async put(key: string, body: string) {
      await send("PUT", key, { body });
    },
    get: (key: string) => send("GET", key, { maxBytes: MAX_VAULT_BYTES }),
    async del(key: string) {
      await send("DELETE", key);
    },
    // Every page of the listing (up to 1000 keys a page, in key order), so the newest backups never
    // fall off the end. lastModified is R2's time, unlike the time in a snapshot's name.
    async list(prefix: string): Promise<R2Object[]> {
      const items: R2Object[] = [];
      let token = "";
      for (let page = 0; page < R2_LIST_PAGES; page++) {
        const read = readListPage(await send("GET", "", { query: listQuery(prefix, token), maxBytes: R2_LIST_BYTES }));
        items.push(...read.items);
        token = read.token;
        if (!token) return items;
      }
      // Cut short, the real snapshots could be the part not read: pruning, sync and restore must not act on it.
      throw new Error(R2_TOO_MANY_OBJECTS);
    },
  };
}
