import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeRfc3986, listQuery, parseR2Url, r2Error, readListPage, sigV4Headers, sigV4Request, sigV4StringToSign } from "./r2.js";

test("RFC 3986 encoding, as SigV4 wants it", () => {
  assert.equal(encodeRfc3986("a b!'()*/~"), "a%20b%21%27%28%29%2A%2F~");
  assert.equal(listQuery("kapevault/snapshots/"), "list-type=2&prefix=kapevault%2Fsnapshots%2F");
  assert.equal(listQuery("p", "t=1"), "list-type=2&prefix=p&continuation-token=t%3D1");
});

test("the canonical request of AWS's GET example, before any hashing", () => {
  const request = sigV4Request({ method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", headers: { Range: "bytes=0-9" }, payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", now: new Date("2013-05-24T00:00:00Z"), region: "us-east-1" });
  assert.equal(request.scope, "20130524/us-east-1/s3/aws4_request");
  assert.equal(
    request.canonical,
    "GET\n/test.txt\n\nhost:examplebucket.s3.amazonaws.com\nrange:bytes=0-9\nx-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\nx-amz-date:20130524T000000Z\n\nhost;range;x-amz-content-sha256;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(sigV4StringToSign(request, "h"), "AWS4-HMAC-SHA256\n20130524T000000Z\n20130524/us-east-1/s3/aws4_request\nh");
});

test("the headers sent: host signed but left out, and the authorization line", () => {
  const request = sigV4Request({ method: "PUT", url: "https://acct.r2.cloudflarestorage.com/bucket-name/k", payloadHash: "p", now: new Date("2013-05-24T00:00:00Z") });
  const headers = sigV4Headers(request, "mock-key-id", "abc123");
  assert.equal("host" in headers, false);
  assert.deepEqual(headers, {
    "x-amz-date": "20130524T000000Z",
    "x-amz-content-sha256": "p",
    authorization: "AWS4-HMAC-SHA256 Credential=mock-key-id/20130524/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=abc123",
  });
});

test("an R2 bucket URL reads to its endpoint and bucket; anything else is null", () => {
  assert.deepEqual(parseR2Url(" https://acct.r2.cloudflarestorage.com/bucket-name "), { endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "bucket-name" });
  for (const other of ["http://acct.r2.cloudflarestorage.com/bucket-name", "https://example.com/bucket-name", "https://acct.r2.cloudflarestorage.com/Bad_Bucket", "https://acct.r2.cloudflarestorage.com/", "not a url"]) {
    assert.equal(parseR2Url(other), null, other);
  }
});

test("a listing page: keys, sizes, R2's LastModified, and the next page's token", () => {
  const page = readListPage(`<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>next</NextContinuationToken>
    <Contents><Key>a</Key><LastModified>2009-10-12T17:50:30.000Z</LastModified><Size>434234</Size></Contents>
    <Contents><Key>b</Key><Size>5</Size></Contents></ListBucketResult>`);
  assert.deepEqual(page, { items: [{ key: "a", size: 434234, lastModified: Date.parse("2009-10-12T17:50:30.000Z") }, { key: "b", size: 5, lastModified: null }], token: "next" });
  assert.equal(readListPage("<IsTruncated>false</IsTruncated>").token, "");
});

test("refused requests in plain words, never the request itself", () => {
  assert.equal(r2Error(403, "<Error><Code>InvalidAccessKeyId</Code></Error>").message, "R2 refused the keys (InvalidAccessKeyId). Check the access key, secret, and bucket permissions.");
  assert.equal(r2Error(404, "<Code>NoSuchBucket</Code>").message, "R2 could not find that bucket.");
  assert.equal(r2Error(404, "").message, "R2 could not find that backup.");
  assert.equal(r2Error(500, "").message, "R2 error 500.");
});
