// The pure parts of talking to Cloudflare R2 (S3 API), the same on the PC (electron/r2-client.cjs) and the
// phone (mobile host/r2.ts): the bucket URL, AWS Signature V4's canonical request and headers, error
// replies and listing pages. SHA-256 and HMAC stay in each host (core is synchronous, WebCrypto is not);
// the host hashes and signs between these steps, and sends the request.

/** One page of 1000 keys is ~300 KB. */
export const R2_LIST_BYTES = 8 * 1024 * 1024;
/** Past this many pages the listing is refused: cut short, the real snapshots could be the part not read
 * (50,000 junk keys sorting first used to hide every backup, silently). */
export const R2_LIST_PAGES = 50;
export const R2_TOO_MANY_OBJECTS = "The bucket holds too many objects to list. Remove what KAPEVault did not put there.";

/** RFC 3986 encoding, as SigV4 wants it: encodeURIComponent plus ! ' ( ) *. @param {string} value */
export function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * @typedef {{ amzDate: string, day: string, scope: string, canonical: string, names: string[], headers: Record<string, string> }} SigV4Request
 */

/**
 * SigV4's canonical request, for a body whose SHA-256 (hex) the host worked out. The host then hashes
 * `canonical`, signs sigV4StringToSign() with the key it derives, and sends sigV4Headers().
 * @param {{ method: string, url: string, headers?: Record<string, string>, payloadHash: string, now: Date, region?: string, service?: string }} input
 * @returns {SigV4Request}
 */
export function sigV4Request({ method, url, headers = {}, payloadHash, now, region = "auto", service = "s3" }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, ""); // 20130524T000000Z
  const day = amzDate.slice(0, 8);
  /** @type {Record<string, string>} */
  const signed = { host: u.host, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash };
  for (const [name, value] of Object.entries(headers)) signed[name.toLowerCase()] = String(value).trim();
  const names = Object.keys(signed).sort();
  const path = u.pathname.split("/").map((s) => encodeRfc3986(decodeURIComponent(s))).join("/");
  const query = [...u.searchParams]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonical = [method, path, query, names.map((n) => `${n}:${signed[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  return { amzDate, day, scope: `${day}/${region}/${service}/aws4_request`, canonical, names, headers: signed };
}

/** What the signing key signs. @param {SigV4Request} request @param {string} canonicalHash SHA-256 (hex) of request.canonical */
export const sigV4StringToSign = ({ amzDate, scope }, canonicalHash) => ["AWS4-HMAC-SHA256", amzDate, scope, canonicalHash].join("\n");

/**
 * The headers to send: the given ones plus x-amz-date, x-amz-content-sha256 and authorization. Host is
 * signed but left out - the HTTP stack (curl, the phone's native HTTP) sets it from the same URL.
 * @param {SigV4Request} request @param {string} accessKeyId @param {string} signature hex
 * @returns {Record<string, string>}
 */
export function sigV4Headers({ headers, names, scope }, accessKeyId, signature) {
  const { host: _host, ...out } = headers;
  out.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return out;
}

/**
 * "https://<account>.r2.cloudflarestorage.com/<bucket>" (the S3 API URL on the bucket's settings page)
 * -> { endpoint, bucket }, or null if it is not an R2 bucket URL.
 * @param {unknown} input @returns {{ endpoint: string, bucket: string } | null}
 */
export function parseR2Url(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    return null;
  }
  const bucket = u.pathname.split("/").filter(Boolean)[0] ?? "";
  if (u.protocol !== "https:" || !u.hostname.endsWith(".r2.cloudflarestorage.com")) return null;
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) return null;
  return { endpoint: u.origin, bucket };
}

/**
 * A refused request, in plain words. S3 errors come back as XML with a <Code>; request details are never
 * echoed (they carry the key ID).
 * @param {number} status @param {string} body @returns {Error}
 */
export function r2Error(status, body) {
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1];
  if (status === 401 || status === 403) return new Error(`R2 refused the keys (${code ?? status}). Check the access key, secret, and bucket permissions.`);
  if (status === 404) return new Error(`R2 could not find that ${code === "NoSuchBucket" ? "bucket" : "backup"}.`);
  return new Error(`R2 error ${status}${code ? ` (${code})` : ""}.`);
}

/** A ListObjectsV2 page's query. @param {string} prefix @param {string} [token] the last page's continuation token */
export const listQuery = (prefix, token = "") => `list-type=2&prefix=${encodeRfc3986(prefix)}${token ? `&continuation-token=${encodeRfc3986(token)}` : ""}`;

/**
 * One page of a listing, read. lastModified: when R2 stored the object (ms), by the server's clock - unlike
 * the time in a snapshot's name, which the uploading device's clock chose; null if missing or unreadable.
 * token: the next page's, "" on the last page.
 * @param {string} xml @returns {{ items: { key: string, size: number, lastModified: number | null }[], token: string }}
 */
export function readListPage(xml) {
  const items = [];
  for (const [, item] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const modified = Date.parse(/<LastModified>([^<]+)<\/LastModified>/.exec(item)?.[1] ?? "");
    items.push({ key: /<Key>([^<]*)<\/Key>/.exec(item)?.[1] ?? "", size: Number(/<Size>(\d+)<\/Size>/.exec(item)?.[1] ?? 0), lastModified: Number.isFinite(modified) ? modified : null });
  }
  const token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") : "";
  return { items, token };
}
