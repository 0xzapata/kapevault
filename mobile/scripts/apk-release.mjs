// The last step of `npm run apk:release` (after `npm run build` and `cap sync android`): builds the
// release APK signed with KAPEVault's release key, copies it to release/KAPEVault-<version>.apk and
// proves it: signed by that key (not the debug one), the package.json version, not debuggable.
// The key: ~/.kapevault-signing/keystore.properties, or the file KAPEVAULT_SIGNING names (the same
// file android/app/build.gradle reads).
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, jdk, sdk } from "./android-env.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message) => {
  console.error(`apk:release: ${message}`);
  process.exit(1);
};

const signingFile = process.env.KAPEVAULT_SIGNING ?? path.join(os.homedir(), ".kapevault-signing", "keystore.properties");
// A debug-signed APK on a phone can never be updated by the real one without an uninstall, which
// wipes the vault, so there is no fallback key here.
if (!fs.statSync(signingFile, { throwIfNoEntry: false })?.isFile()) fail(`no release key at ${signingFile} (set KAPEVAULT_SIGNING to its keystore.properties).`);
const signing = Object.fromEntries(
  fs
    .readFileSync(signingFile, "utf8")
    .split(/\r?\n/)
    .filter((line) => /^\s*[^#!\s]/.test(line))
    .map((line) => line.split(/=(.*)/).map((s) => s.trim())),
);

const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const gradle = spawnSync(process.execPath, [path.join(root, "scripts", "gradle.mjs"), "assembleRelease", "--quiet"], { cwd: root, env, stdio: "inherit" });
if (gradle.status !== 0) fail("the Gradle release build failed.");

const built = path.join(root, "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
if (!fs.existsSync(built)) fail(`Gradle made no signed APK (${built}); is ${signingFile} complete?`);
const apk = path.join(root, "release", `KAPEVault-${version}.apk`);
fs.mkdirSync(path.dirname(apk), { recursive: true });
fs.copyFileSync(built, apk);

const buildTools = path.join(sdk, "build-tools", fs.readdirSync(path.join(sdk, "build-tools")).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).pop());
const run = (file, args, extraEnv = {}) => execFileSync(file, args, { env: { ...env, ...extraEnv }, encoding: "utf8" });
const hex = (s) => s.replace(/[^0-9a-f]/gi, "").toLowerCase();

const certs = run(jdk ? path.join(jdk, "bin", "java") : "java", ["-jar", path.join(buildTools, "lib", "apksigner.jar"), "verify", "--verbose", "--print-certs", apk]);
const signer = hex(certs.match(/certificate SHA-256 digest: (\S+)/)?.[1] ?? "");
// v3 (build.gradle) lets the key rotate later. v2 is not required: minSdk is 30 and every Android from
// 9 verifies v3, so Gradle leaves v2 out (seen on the first real release, 0.1.5, 2026-09-29).
if (!/Verified using v3 scheme \(APK Signature Scheme v3\): true/.test(certs)) fail("the APK is not signed with the v3 scheme.");
const keytool = run(jdk ? path.join(jdk, "bin", "keytool") : "keytool", ["-list", "-v", "-keystore", path.resolve(path.dirname(signingFile), signing.storeFile), "-alias", signing.keyAlias, "-storepass:env", "KV_STORE_PASS"], { KV_STORE_PASS: signing.storePassword });
const releaseKey = hex(keytool.match(/SHA256: (\S+)/)?.[1] ?? "");
if (!signer || signer !== releaseKey) fail(`the APK is not signed with the release key (signer ${signer || "none"}, key ${releaseKey}).`);

const badging = run(path.join(buildTools, `aapt2${process.platform === "win32" ? ".exe" : ""}`), ["dump", "badging", apk]);
const versionName = badging.match(/versionName='([^']*)'/)?.[1];
const versionCode = badging.match(/versionCode='([^']*)'/)?.[1];
if (versionName !== version) fail(`the APK says version ${versionName}, package.json says ${version}.`);
if (/application-debuggable/.test(badging)) fail("the APK is debuggable.");

console.log(`\n${path.relative(process.cwd(), apk)} (${(fs.statSync(apk).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`version ${versionName} (code ${versionCode}), not debuggable`);
console.log(certs.match(/certificate DN: .*/)?.[0]);
console.log(`certificate SHA-256: ${signer.match(/../g).join(":").toUpperCase()}`);
