// The phone's R2 client and snapshot names against AWS's published SigV4 examples and the PC's code.
import test from "node:test";
import assert from "node:assert/strict";
import { createR2Client, parseR2Url, signRequest } from "./r2.ts";
import { backupsOf, readSnapshotKey, snapshotKey, snapshotsToPrune } from "./cloud.ts";
import { pc } from "./test/fixtures.mjs";

// The worked examples from AWS's "Signature Calculations for the Authorization Header" (S3) page, as
// electron/r2-client.test.cjs uses them: same keys, date and requests; AWS's published signatures.
const example = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", now: new Date("2013-05-24T00:00:00Z") };
const signatureOf = async (req) => /Signature=([0-9a-f]{64})$/.exec((await signRequest({ ...example, ...req })).authorization)[1];

test("SigV4 reproduces AWS's four published S3 example signatures", async () => {
  assert.equal(await signatureOf({ method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", headers: { Range: "bytes=0-9" } }), "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  assert.equal(
    await signatureOf({
      method: "PUT",
      url: "https://examplebucket.s3.amazonaws.com/test$file.text",
      headers: { Date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
      body: "Welcome to Amazon S3.",
    }),
    "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
  );
  assert.equal(await signatureOf({ method: "GET", url: "https://examplebucket.s3.amazonaws.com/?lifecycle" }), "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543");
  assert.equal(await signatureOf({ method: "GET", url: "https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J" }), "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
});

test("the phone signs every request exactly as the PC does, and never sends Host or the secret", async () => {
  const keys = { accessKeyId: "k-1", secretAccessKey: "mock-r2-secret" };
  const requests = [
    { method: "PUT", url: "https://0123abcd.r2.cloudflarestorage.com/b-1/kapevault/snapshots/0f0e/2026-09-27T01-02-03-004Z.kapevault", body: '{"format":"kapevault"}' },
    { method: "GET", url: "https://0123abcd.r2.cloudflarestorage.com/b-1?list-type=2&prefix=kapevault%2Fsnapshots%2F&continuation-token=tok%201" },
    { method: "DELETE", url: "https://0123abcd.r2.cloudflarestorage.com/b-1/bovault/snapshots/2025-01-01T00-00-00-000Z.bovault" },
  ];
  for (const req of requests) {
    const now = new Date(Date.UTC(2026, 8, 27, 1, 2, 3));
    const ours = await signRequest({ ...keys, ...req, now });
    assert.deepEqual(ours, pc.r2.signRequest({ ...keys, ...req, now }), req.method);
    assert.equal(ours.host, undefined);
    assert.ok(!JSON.stringify(ours).includes(keys.secretAccessKey));
  }
});

test("parseR2Url accepts the bucket's S3 API URL only (the PC's cases)", () => {
  assert.deepEqual(parseR2Url(" https://0123abcd.r2.cloudflarestorage.com/my-vault "), { endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "my-vault" });
  for (const bad of ["", "not a url", "http://0123abcd.r2.cloudflarestorage.com/b-1", "https://0123abcd.r2.cloudflarestorage.com/", "https://evil.com/r2.cloudflarestorage.com/b-1", "https://x.r2.cloudflarestorage.com.evil.com/b-1", "https://0123abcd.r2.cloudflarestorage.com/Bad_Bucket"]) {
    assert.equal(parseR2Url(bad), null, bad);
  }
});

test("list reads LastModified, follows every page, and turns R2's refusals into the PC's words", async () => {
  const page = (keys, next) =>
    `<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key><LastModified>2026-09-27T01:00:00.000Z</LastModified><Size>5</Size></Contents>`).join("")}` +
    `<IsTruncated>${next ? "true" : "false"}</IsTruncated>${next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""}</ListBucketResult>`;
  const transport = async (req) => ({ status: 200, body: new URL(req.url).searchParams.get("continuation-token") ? page(["b"], "") : page(["a"], "tok 1") });
  const r2 = createR2Client({ endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "b-1", accessKeyId: "k", secretAccessKey: "s", transport });
  assert.deepEqual(await r2.list(""), [
    { key: "a", size: 5, lastModified: Date.UTC(2026, 8, 27, 1) },
    { key: "b", size: 5, lastModified: Date.UTC(2026, 8, 27, 1) },
  ]);
  const refused = createR2Client({ endpoint: "https://x.r2.cloudflarestorage.com", bucket: "b-1", accessKeyId: "k", secretAccessKey: "s", transport: async () => ({ status: 403, body: "<Error><Code>InvalidAccessKeyId</Code></Error>" }) });
  await assert.rejects(refused.list(""), /R2 refused the keys \(InvalidAccessKeyId\)/);
  const offline = createR2Client({ endpoint: "https://x.r2.cloudflarestorage.com", bucket: "b-1", accessKeyId: "k", secretAccessKey: "s", transport: async () => Promise.reject(new Error("UnknownHostException")) });
  await assert.rejects(offline.get("a"), /Could not reach R2/);
});

test("snapshot keys: the phone names them as the PC does, and the PC reads the phone's", () => {
  const id = "3f2b9a60-1c1d-4e5f-8a9b-0c1d2e3f4a5b";
  const at = new Date(Date.UTC(2026, 8, 27, 7, 15, 2, 123));
  const key = snapshotKey(at, id);
  assert.equal(key, `kapevault/snapshots/${id}/2026-09-27T07-15-02-123Z.kapevault`);
  assert.equal(pc.cloud.snapshotOwner(key), id);
  assert.equal(pc.cloud.snapshotTime(key), at.getTime());
  assert.deepEqual(readSnapshotKey(key), { owner: id, time: at.getTime(), beforeRestore: false, backupOnly: false, legacy: false });
  const pcKey = pc.cloud.snapshotKey(at, id, "before-restore");
  assert.deepEqual(readSnapshotKey(pcKey), { owner: id, time: at.getTime(), beforeRestore: true, backupOnly: false, legacy: false });
  assert.equal(readSnapshotKey("bovault/snapshots/2025-01-01T00-00-00-000Z.bovault").legacy, true);
  assert.equal(readSnapshotKey("kapevault/opener/kapevault-opener-0.1.0.html"), null);
});

test("first run lists backups newest first by R2's clock, this phone's apart from the PC's", () => {
  const me = "3f2b9a60-1c1d-4e5f-8a9b-0c1d2e3f4a5b";
  const other = "9d9d9d9d-1c1d-4e5f-8a9b-0c1d2e3f4a5b";
  const objects = [
    { key: pc.cloud.snapshotKey(new Date(Date.UTC(2026, 8, 27)), other), size: 1, lastModified: Date.UTC(2026, 8, 20) }, // a wrong clock named it late
    { key: pc.cloud.snapshotKey(new Date(Date.UTC(2026, 8, 21)), me), size: 1, lastModified: Date.UTC(2026, 8, 21) },
    { key: "bovault/snapshots/2025-01-01T00-00-00-000Z.bovault", size: 1, lastModified: null },
    { key: "kapevault/opener/kapevault-opener-0.1.0.html", size: 1, lastModified: Date.UTC(2026, 8, 26) },
  ];
  assert.deepEqual(backupsOf(objects, me), [
    { key: objects[1].key, device: "This phone", platform: "android", at: Date.UTC(2026, 8, 21) },
    { key: objects[0].key, device: "PC", platform: "windows", at: Date.UTC(2026, 8, 20) },
    { key: objects[2].key, device: "PC", platform: "windows", at: Date.UTC(2025, 0, 1) },
  ]);
});

// SECURITY-AUDIT-2026-09-28.md M5 / L9: anyone with the R2 keys can put objects under this phone's id. One it never
// sent is not "This phone", a name dated far ahead never ranks as the newest, and an object bigger
// than any vault is never offered (the phone reads a reply whole).
test("planted, future-dated and oversized objects are never this phone's newest backups", () => {
  const me = "3f2b9a60-1c1d-4e5f-8a9b-0c1d2e3f4a5b";
  const real = pc.cloud.snapshotKey(new Date(Date.UTC(2026, 8, 21)), me);
  const planted = pc.cloud.snapshotKey(new Date(Date.UTC(2026, 8, 22)), me);
  const huge = pc.cloud.snapshotKey(new Date(Date.UTC(2026, 8, 23)), me);
  const objects = [
    { key: real, size: 1, lastModified: Date.UTC(2026, 8, 21) },
    { key: planted, size: 1, lastModified: Date.UTC(2026, 8, 22) },
    { key: huge, size: 64 * 1024 * 1024 + 1, lastModified: Date.UTC(2026, 8, 23) },
  ];
  const listed = backupsOf(objects, me, new Set([real]));
  assert.deepEqual(listed.map((b) => [b.key, b.device]), [[planted, "PC"], [real, "This phone"]]);

  const now = Date.UTC(2026, 8, 28);
  const recent = Array.from({ length: 20 }, (_, i) => pc.cloud.snapshotKey(new Date(now - i * 60_000), me));
  const future = Array.from({ length: 20 }, (_, i) => pc.cloud.snapshotKey(new Date(Date.UTC(2099, 0, 1, 0, 0, i)), me));
  assert.deepEqual(snapshotsToPrune([...recent, ...future], now).filter((k) => recent.includes(k)), [], "the newest 20 real ones stay");
});
