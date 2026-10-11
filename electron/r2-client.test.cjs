const test = require("node:test");
const assert = require("node:assert/strict");
const { signRequest, parseR2Url } = require("./r2-client.cjs");

// The worked examples from AWS's "Signature Calculations for the Authorization Header" (S3) page:
// same keys, date, and requests; the expected signatures are the ones AWS publishes.
const example = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  now: new Date("2013-05-24T00:00:00Z"),
};
const signatureOf = (req) => /Signature=([0-9a-f]{64})$/.exec(signRequest({ ...example, ...req }).authorization)[1];

test("SigV4: GET object with a Range header (AWS example)", () => {
  const sig = signatureOf({ method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", headers: { Range: "bytes=0-9" } });
  assert.equal(sig, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
});

test("SigV4: PUT object with a body and a $ in the key (AWS example)", () => {
  const sig = signatureOf({
    method: "PUT",
    url: "https://examplebucket.s3.amazonaws.com/test$file.text",
    headers: { Date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
    body: "Welcome to Amazon S3.",
  });
  assert.equal(sig, "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
});

test("SigV4: GET with an empty query value (AWS lifecycle example)", () => {
  assert.equal(signatureOf({ method: "GET", url: "https://examplebucket.s3.amazonaws.com/?lifecycle" }), "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543");
});

test("SigV4: list with sorted query parameters (AWS example)", () => {
  assert.equal(signatureOf({ method: "GET", url: "https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J" }), "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
});

test("signed headers never include the secret, and Host is left to curl", () => {
  const headers = signRequest({ ...example, method: "GET", url: "https://examplebucket.s3.amazonaws.com/a" });
  assert.equal(headers.host, undefined);
  assert.ok(!JSON.stringify(headers).includes(example.secretAccessKey));
  assert.match(headers.authorization, /Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request/);
});

test("parseR2Url accepts the bucket's S3 API URL only", () => {
  assert.deepEqual(parseR2Url(" https://0123abcd.r2.cloudflarestorage.com/my-vault "), { endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "my-vault" });
  assert.deepEqual(parseR2Url("https://0123abcd.eu.r2.cloudflarestorage.com/my-vault/"), { endpoint: "https://0123abcd.eu.r2.cloudflarestorage.com", bucket: "my-vault" });
  for (const bad of ["", "not a url", "http://0123abcd.r2.cloudflarestorage.com/b-1", "https://0123abcd.r2.cloudflarestorage.com/", "https://evil.com/r2.cloudflarestorage.com/b-1", "https://x.r2.cloudflarestorage.com.evil.com/b-1", "https://0123abcd.r2.cloudflarestorage.com/Bad_Bucket"]) {
    assert.equal(parseR2Url(bad), null, bad);
  }
});

test("list reads each object's LastModified (the server's time) as ms, null when missing or unreadable", async () => {
  const { createR2Client } = require("./r2-client.cjs");
  // As in AWS's ListObjectsV2 example response.
  const xml = `<ListBucketResult><IsTruncated>false</IsTruncated>
    <Contents><Key>a</Key><LastModified>2009-10-12T17:50:30.000Z</LastModified><ETag>"x"</ETag><Size>434234</Size></Contents>
    <Contents><Key>b</Key><Size>5</Size></Contents>
    <Contents><Key>c</Key><LastModified>not a date</LastModified><Size>5</Size></Contents></ListBucketResult>`;
  const transport = async () => ({ status: 200, body: Buffer.from(xml) });
  const r2 = createR2Client({ endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "b-1", accessKeyId: "k", secretAccessKey: "s", transport });
  assert.deepEqual(await r2.list(""), [
    { key: "a", size: 434234, lastModified: Date.UTC(2009, 9, 12, 17, 50, 30) },
    { key: "b", size: 5, lastModified: null },
    { key: "c", size: 5, lastModified: null },
  ]);
});

test("list follows every page with capped reads, and the secret never reaches the courier", async () => {
  const { createR2Client } = require("./r2-client.cjs");
  const seen = [];
  const page = (keys, next) =>
    `<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key><Size>5</Size></Contents>`).join("")}` +
    `<IsTruncated>${next ? "true" : "false"}</IsTruncated>${next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""}</ListBucketResult>`;
  const transport = async (req) => {
    seen.push(req);
    const token = new URL(req.url).searchParams.get("continuation-token");
    return { status: 200, body: Buffer.from(token ? page(["b"], "") : page(["a"], "tok 1")) };
  };
  const r2 = createR2Client({ endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "b-1", accessKeyId: "k", secretAccessKey: "mock-r2-secret", transport });
  assert.deepEqual((await r2.list("kapevault/")).map((o) => o.key), ["a", "b"]);
  assert.ok(seen.every((r) => r.maxBytes === 8 * 1024 * 1024 && r.allowHttp === false));

  await r2.put("kapevault/x.kapevault", Buffer.from("ciphertext"));
  await r2.get("kapevault/x.kapevault");
  assert.equal(seen.at(-2).body.toString(), "ciphertext");
  assert.equal(seen.at(-1).maxBytes, 64 * 1024 * 1024);
  assert.match(seen.at(-1).tooLarge, /too large to be a vault/);
  assert.ok(!JSON.stringify(seen).includes("mock-r2-secret"));
});

// SECURITY-AUDIT-2026-09-28.md L9: 50,000 junk keys sorting first used to end the listing silently at 50 pages,
// hiding every real snapshot from pruning, sync and restore.
test("a listing that never ends within the page cap is an error, not a partial list", async () => {
  const { createR2Client } = require("./r2-client.cjs");
  let pages = 0;
  const transport = async () => {
    pages++;
    return { status: 200, body: Buffer.from(`<ListBucketResult><Contents><Key>junk-${pages}</Key><Size>1</Size></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>t${pages}</NextContinuationToken></ListBucketResult>`) };
  };
  const r2 = createR2Client({ endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "b-1", accessKeyId: "k", secretAccessKey: "s", transport });
  await assert.rejects(r2.list("kapevault/"), /too many objects/);
  assert.equal(pages, 50);
});

test("R2 error replies keep today's messages", async () => {
  const { createR2Client } = require("./r2-client.cjs");
  const reply = (status, code) => async () => ({ status, body: Buffer.from(code ? `<Error><Code>${code}</Code></Error>` : "") });
  const client = (transport) => createR2Client({ endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "b-1", accessKeyId: "k", secretAccessKey: "s", transport });
  await assert.rejects(client(reply(403, "InvalidAccessKeyId")).list(""), /R2 refused the keys \(InvalidAccessKeyId\)/);
  await assert.rejects(client(reply(404, "NoSuchBucket")).list(""), /could not find that bucket/);
  await assert.rejects(client(reply(404, "NoSuchKey")).get("k"), /could not find that backup/);
  await assert.rejects(client(reply(301)).get("k"), /R2 error 301\./); // a redirect is never followed
  await assert.rejects(client(reply(500, "InternalError")).put("k", Buffer.from("x")), /R2 error 500 \(InternalError\)/);
});

test("a key with a dot segment, %, ?, # or a backslash is refused before any request (audit run-1 round 2)", async () => {
  const { createR2Client } = require("./r2-client.cjs");
  const sent = [];
  const transport = async (req) => {
    sent.push(req.url);
    return { status: 204, body: Buffer.alloc(0) };
  };
  const r2 = createR2Client({ endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "b-1", accessKeyId: "k", secretAccessKey: "s", transport });
  for (const key of ["kapevault/opener/../snapshots/x", "kapevault/./x", "kapevault//x", "a%2e%2e/x", "a?x=1", "a#b", "a\\b"]) {
    await assert.rejects(r2.del(key), /not one KAPEVault uses/, key);
  }
  assert.deepEqual(sent, []);
  await r2.del("kapevault/opener/kapevault-opener-0.1.3.html");
  assert.equal(sent.length, 1, "an ordinary key still goes through");
});
