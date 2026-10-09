// Run with `npm test` (Node strips the types). The account and bucket Connect shows before it uploads.
import test from "node:test";
import assert from "node:assert/strict";
import { bucketOf } from "./bucket.ts";

test("an R2 S3 API URL gives its account id and bucket", () => {
  assert.deepEqual(bucketOf("https://0123abcd4567.r2.cloudflarestorage.com/my-vault"), { account: "0123abcd4567", bucket: "my-vault" });
  assert.deepEqual(bucketOf("  https://0123abcd4567.r2.cloudflarestorage.com/my-vault/  "), { account: "0123abcd4567", bucket: "my-vault" });
});

test("anything that is not an R2 bucket URL gives null", () => {
  for (const u of ["", "my-vault", "http://0123abcd4567.r2.cloudflarestorage.com/my-vault", "https://example.com/my-vault", "https://0123abcd4567.r2.cloudflarestorage.com/", "https://r2.cloudflarestorage.com.evil.com/my-vault"]) assert.equal(bucketOf(u), null, u);
});
