// Just enough S3 for Cloudflare R2: put, get, list, delete, signed with AWS Signature V4 using
// Node's built-in crypto (no SDK). Checked against AWS's published examples in r2-client.test.cjs.
// A signed request travels through the courier (the system curl), never KAPEVault's own network.
// The canonical request, the URL, error replies and listing pages are core/r2.js (shared with the phone).
const crypto = require("node:crypto");
const { carry } = require("./courier.cjs");
const { MAX_VAULT_BYTES } = require("./vault-crypto.cjs");
const { R2_LIST_BYTES, R2_LIST_PAGES, R2_TOO_MANY_OBJECTS, listQuery, parseR2Url, r2Error, readListPage, sigV4Headers, sigV4Request, sigV4StringToSign } = require("../core/index.js");

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const MAX_REPLY_BYTES = 64 * 1024; // puts, deletes and error replies are small XML
const OVERSIZED = "R2 holds a larger object there than expected.";

// Returns the headers to send: the given ones plus x-amz-date, x-amz-content-sha256, authorization.
function signRequest({ method, url, headers = {}, body = "", accessKeyId, secretAccessKey, region = "auto", service = "s3", now = new Date() }) {
  const request = sigV4Request({ method, url, headers, payloadHash: sha256(body), now, region, service });
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, request.day), region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", key).update(sigV4StringToSign(request, sha256(request.canonical))).digest("hex");
  return sigV4Headers(request, accessKeyId, signature);
}

// allowHttp: the fake R2 on 127.0.0.1 of an unpacked test run. transport: a stand-in courier for tests.
function createR2Client({ endpoint, bucket, accessKeyId, secretAccessKey, allowHttp = false, transport = carry }) {
  // Resolves the whole reply body, read up to maxBytes. missing: what a 404 resolves to (default: an error).
  /** @param {string} method @param {string} key @param {{ query?: string, body?: any, maxBytes?: number, tooLarge?: string, missing?: any }} [options] */
  async function send(method, key, { query = "", body, maxBytes = MAX_REPLY_BYTES, tooLarge = "R2 sent an unexpectedly large reply.", missing } = {}) {
    // A key is put in the URL as it is: one a listing returned with a dot segment, %, ?, # or \ would
    // reach another object than its name says (a "kapevault/opener/../x" delete lands on "kapevault/x").
    if (key && (/[?#%\\]/.test(key) || key.split("/").some((s) => s === "" || s === "." || s === ".."))) throw new Error("That object name is not one KAPEVault uses.");
    const url = `${endpoint}/${bucket}${key ? `/${key}` : ""}${query ? `?${query}` : ""}`;
    const headers = signRequest({ method, url, body: body ?? "", accessKeyId, secretAccessKey });
    const res = await transport({ method, url, headers, body, maxBytes, tooLarge, allowHttp });
    if (res.status === 404 && missing !== undefined) return missing;
    if (res.status < 200 || res.status > 299) throw r2Error(res.status, res.body.toString("utf8"));
    return res.body;
  }

  return {
    async put(key, body) {
      await send("PUT", key, { body });
    },
    async get(key) {
      return send("GET", key, { maxBytes: MAX_VAULT_BYTES, tooLarge: "That backup is too large to be a vault." });
    },
    // An object that may not be there: null when missing; rejects with OVERSIZED past maxBytes.
    async find(key, maxBytes) {
      return send("GET", key, { maxBytes, tooLarge: OVERSIZED, missing: null });
    },
    async del(key) {
      await send("DELETE", key);
    },
    // Every page of the listing (R2 returns up to 1000 keys a page, in key order), so the newest
    // backups never fall off the end. Bounded pages and bytes, whatever the endpoint sends back.
    // lastModified: when R2 stored the object (ms), by the server's clock - unlike the time in a
    // snapshot's name, which the uploading device's clock chose. null if missing or unreadable.
    async list(prefix) {
      const items = [];
      let token = "";
      for (let page = 0; page < R2_LIST_PAGES; page++) {
        const xml = (await send("GET", "", { query: listQuery(prefix, token), maxBytes: R2_LIST_BYTES, tooLarge: "R2 sent an unexpectedly large listing." })).toString("utf8");
        const read = readListPage(xml);
        items.push(...read.items);
        token = read.token;
        if (!token) return items;
      }
      // Cut short, the real snapshots could be the part not read: pruning, sync and restore must not act on it.
      throw new Error(R2_TOO_MANY_OBJECTS);
    },
    // Best-effort walk for clean-up: hands each page to onPage as it is read, so what was read is acted on
    // even when the bucket holds more pages than the cap (list() throws there and returns nothing).
    // Stops quietly at the cap or when onPage returns false.
    async sweep(prefix, onPage) {
      let token = "";
      for (let page = 0; page < R2_LIST_PAGES; page++) {
        const xml = (await send("GET", "", { query: listQuery(prefix, token), maxBytes: R2_LIST_BYTES, tooLarge: "R2 sent an unexpectedly large listing." })).toString("utf8");
        const read = readListPage(xml);
        if ((await onPage(read.items)) === false) return;
        token = read.token;
        if (!token) return;
      }
    },
  };
}

module.exports = { signRequest, parseR2Url, createR2Client, OVERSIZED };
