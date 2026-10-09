import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseLine } from "./android-notices.mjs";
import { androidInputsHash, buildNotices, MOBILE, npmNotices, shippedPackages } from "./lib/notices.mjs";

const lock = JSON.parse(readFileSync(join(MOBILE, "package-lock.json"), "utf8"));

test("the notices list every npm package that ships, each with its licence text", () => {
  const text = npmNotices();
  const shipped = shippedPackages(lock);
  assert.ok(shipped.length >= 8);
  for (const { name, version } of shipped) assert.ok(text.includes(`${name} ${version} (`), `${name} ${version} is missing`);
  assert.ok(!text.includes("jest-"), "a dev-only package got in");
  assert.match(text, /Permission is hereby granted/); // MIT
  assert.match(text, /SIL OPEN FONT LICENSE/i); // Geist
});

test("a shipped package with no licence file stops the build", () => {
  const dir = mkdtempSync(join(tmpdir(), "kapevault-notices-"));
  try {
    mkdirSync(join(dir, "node_modules", "mock-lib"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "mock-lib", "package.json"), "{}");
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ packages: { "node_modules/mock-lib": { version: "1.0.0", license: "MIT" } } }));
    assert.throws(() => npmNotices({ mobile: dir }), /node_modules\/mock-lib ships in the app but has no licence file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the screen carries LICENSE, LICENSE-EXCEPTION, NOTICE, the web libraries and the Android libraries", () => {
  const { version, sections } = buildNotices();
  assert.equal(version, JSON.parse(readFileSync(join(MOBILE, "package.json"), "utf8")).version);
  assert.deepEqual(sections.map((s) => s.name), ["LICENSE", "LICENSE-EXCEPTION", "NOTICE", "Libraries in the web app", "Libraries in the Android app"]);
  for (const s of sections) assert.ok(s.text.length > 200, s.name);
  const android = sections[4].text;
  for (const id of ["com.google.zxing:core", "androidx.appcompat:appcompat", "org.jetbrains.kotlin:kotlin-stdlib", "org.apache.cordova:framework", "com.android.billingclient:billing"]) assert.ok(android.includes(id), id);
  assert.match(android, /Apache License\s+Version 2\.0, January 2004/);
});

test("every Android library names its licence, and the list is pinned to the build files (fix: node scripts/android-notices.mjs --write)", () => {
  const { inputs, libraries } = JSON.parse(readFileSync(join(MOBILE, "legal", "android-libraries.json"), "utf8"));
  assert.ok(libraries.length > 0);
  for (const l of libraries) assert.ok(l.licence && l.licence !== "License" && l.version, `${l.id} has no usable licence`);
  assert.equal(inputs, androidInputsHash(), "a dependency changed: rerun node scripts/android-notices.mjs --write and review the diff");
});

test("the pin moves when a dependency line moves, and not for other lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "kapevault-pin-"));
  try {
    mkdirSync(join(dir, "android", "app"), { recursive: true });
    cpSync(join(MOBILE, "package-lock.json"), join(dir, "package-lock.json"));
    const put = (file, text) => writeFileSync(join(dir, "android", file), text);
    put("variables.gradle", "ext { zxingCoreVersion = '3.5.4' }\n");
    put("build.gradle", "");
    put("app/build.gradle", 'versionCode 1\ndependencies {\n  implementation "com.google.zxing:core:$zxingCoreVersion"\n}\n');
    const before = androidInputsHash({ mobile: dir });
    put("app/build.gradle", 'versionCode 2 // not a dependency\ndependencies {\n  implementation "com.google.zxing:core:$zxingCoreVersion"\n}\n');
    assert.equal(androidInputsHash({ mobile: dir }), before);
    put("variables.gradle", "ext { zxingCoreVersion = '3.5.5' }\n");
    assert.notEqual(androidInputsHash({ mobile: dir }), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Gradle's dependency tree lines are read as library, resolved version", () => {
  assert.deepEqual(parseLine("+--- androidx.appcompat:appcompat:1.7.1"), { id: "androidx.appcompat:appcompat", version: "1.7.1" });
  assert.deepEqual(parseLine("|    +--- androidx.activity:activity:1.8.0 -> 1.11.0 (*)"), { id: "androidx.activity:activity", version: "1.11.0" });
  assert.deepEqual(parseLine("|    |    \\--- org.jetbrains.kotlin:kotlin-stdlib -> 2.4.10 (*)"), { id: "org.jetbrains.kotlin:kotlin-stdlib", version: "2.4.10" });
  assert.equal(parseLine("+--- project :capacitor-android"), null);
  assert.equal(parseLine("\\--- org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2 (c)"), null);
  assert.equal(parseLine("playReleaseRuntimeClasspath - Runtime classpath of '/playRelease'."), null);
});
