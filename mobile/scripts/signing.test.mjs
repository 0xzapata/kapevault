// The release key's settings: a properties file with only storeFile and keyAlias works when the two
// passwords come from the environment, and a password in the file still wins.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { missingSigning, parseProperties, resolveSigning } from "./lib/signing.mjs";

const ENV = { KAPEVAULT_STORE_PASSWORD: "from-env-store", KAPEVAULT_KEY_PASSWORD: "from-env-key" };

test("a properties file with only storeFile and keyAlias takes both passwords from the environment", () => {
  const properties = parseProperties("storeFile=kapevault-release.jks\r\nkeyAlias=kapevault\r\n");
  assert.deepEqual(properties, { storeFile: "kapevault-release.jks", keyAlias: "kapevault" });
  const signing = resolveSigning(properties, ENV);
  assert.equal(signing.storePassword, "from-env-store");
  assert.equal(signing.keyPassword, "from-env-key");
  assert.deepEqual(missingSigning(signing), []);
});

test("without the environment the missing passwords are named, and a value with = or # in it survives", () => {
  const properties = parseProperties("# the key\nstoreFile = a.jks\nkeyAlias=k\n\nstorePassword=p=1#x\n");
  assert.equal(properties.storePassword, "p=1#x");
  assert.deepEqual(missingSigning(resolveSigning(properties, {})), ["keyPassword (or KAPEVAULT_KEY_PASSWORD)"]);
});

test("a password in the file wins over the environment", () => {
  const signing = resolveSigning(parseProperties("storeFile=a.jks\nkeyAlias=k\nstorePassword=file-store\nkeyPassword=file-key\n"), ENV);
  assert.equal(signing.storePassword, "file-store");
  assert.equal(signing.keyPassword, "file-key");
});

test("build.gradle falls back to the same two variables", () => {
  const gradle = fs.readFileSync(new URL("../android/app/build.gradle", import.meta.url), "utf8");
  assert.match(gradle, /KAPEVAULT_STORE_PASSWORD/);
  assert.match(gradle, /KAPEVAULT_KEY_PASSWORD/);
});
