// The last step of `npm run apk:release` (after `npm run build` and `cap sync android`): builds the
// release APK signed with KAPEVault's release key, copies it to release/KAPEVault-<version>.apk and
// proves it: signed by that key (not the debug one), the package.json version, not debuggable.
// The key: ~/.kapevault-signing/keystore.properties, or the file KAPEVAULT_SIGNING names (the same
// file android/app/build.gradle reads). The two passwords may be left out of that file and given as
// KAPEVAULT_STORE_PASSWORD / KAPEVAULT_KEY_PASSWORD instead (apk-release-prompt.ps1 does this).
// With --bundle (`npm run aab:release`) it makes the Android App Bundle Google Play takes instead,
// release/KAPEVault-<version>.aab, and proves the same three things of it.
// Both are the play flavor (with Google Play Billing). `npm run apk:release -- --foss` makes the foss
// flavor instead, release/KAPEVault-<version>-foss.apk: the same app with no Google code (Pro cannot be
// bought in it). There is no foss bundle: Play takes the play flavor.
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, jdk, sdk } from "./android-env.mjs";
import { missingSigning, parseProperties, resolveSigning } from "./lib/signing.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = process.argv.includes("--bundle");
const foss = process.argv.includes("--foss");
const flavor = foss ? "foss" : "play";
const Flavor = foss ? "Foss" : "Play";
const kind = bundle ? "bundle" : "APK";
const fail = (message) => {
  console.error(`${bundle ? "aab" : "apk"}:release: ${message}`);
  process.exit(1);
};
if (foss && bundle) fail("there is no foss bundle (Google Play takes the play flavor).");

const signingFile = process.env.KAPEVAULT_SIGNING ?? path.join(os.homedir(), ".kapevault-signing", "keystore.properties");
// A debug-signed APK on a phone can never be updated by the real one without an uninstall, which
// wipes the vault, so there is no fallback key here.
if (!fs.statSync(signingFile, { throwIfNoEntry: false })?.isFile()) fail(`no release key at ${signingFile} (set KAPEVAULT_SIGNING to its keystore.properties).`);
const signing = resolveSigning(parseProperties(fs.readFileSync(signingFile, "utf8")));
const missing = missingSigning(signing);
if (missing.length) fail(`${signingFile} is incomplete, missing: ${missing.join(", ")}.`);

const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const gradle = spawnSync(process.execPath, [path.join(root, "scripts", "gradle.mjs"), bundle ? `bundle${Flavor}Release` : `assemble${Flavor}Release`, "--quiet"], { cwd: root, env, stdio: "inherit" });
if (gradle.status !== 0) fail("the Gradle release build failed.");

const built = bundle
  ? path.join(root, "android", "app", "build", "outputs", "bundle", `${flavor}Release`, `app-${flavor}-release.aab`)
  : path.join(root, "android", "app", "build", "outputs", "apk", flavor, "release", `app-${flavor}-release.apk`);
if (!fs.existsSync(built)) fail(`Gradle made no signed ${kind} (${built}); is ${signingFile} complete?`);
const out = path.join(root, "release", `KAPEVault-${version}${foss ? "-foss" : ""}${path.extname(built)}`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(built, out);

const buildTools = path.join(sdk, "build-tools", fs.readdirSync(path.join(sdk, "build-tools")).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).pop());
const run = (file, args, extraEnv = {}) => execFileSync(file, args, { env: { ...env, ...extraEnv }, encoding: "utf8" });
const hex = (s) => s.replace(/[^0-9a-f]/gi, "").toLowerCase();
const jdkTool = (name) => (jdk ? path.join(jdk, "bin", name) : name);

const keytool = run(jdkTool("keytool"), ["-list", "-v", "-keystore", path.resolve(path.dirname(signingFile), signing.storeFile), "-alias", signing.keyAlias, "-storepass:env", "KV_STORE_PASS"], { KV_STORE_PASS: signing.storePassword });
const releaseKey = hex(keytool.match(/SHA256: (\S+)/)?.[1] ?? "");
let signer, owner, versionName, versionCode, debuggable;
if (bundle) {
  // A bundle carries a jar signature (Play signs the APKs it makes from it), read by keytool. Checked
  // against the same release key as the APK, so Play installs and website APKs can update each other.
  const certs = run(jdkTool("keytool"), ["-printcert", "-jarfile", out]);
  signer = hex(certs.match(/SHA256: (\S+)/)?.[1] ?? "");
  owner = certs.match(/Owner: .*/)?.[0];
  // aapt2 cannot read a bundle. Its manifest is protobuf: an attribute's text value follows its name
  // as field 3 (tag byte 0x1a), a length byte, then the text.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-aab-"));
  execFileSync(jdkTool("jar"), ["xf", out, "base/manifest/AndroidManifest.xml"], { cwd: tmp, env });
  const manifest = fs.readFileSync(path.join(tmp, "base", "manifest", "AndroidManifest.xml"), "latin1");
  fs.rmSync(tmp, { recursive: true });
  const attr = (name) => {
    const at = manifest.indexOf(`${name}\x1a`) + name.length + 1;
    return at > name.length ? manifest.substr(at + 1, manifest.charCodeAt(at)) : undefined;
  };
  [versionName, versionCode, debuggable] = [attr("versionName"), attr("versionCode"), manifest.includes("debuggable")];
} else {
  const certs = run(jdkTool("java"), ["-jar", path.join(buildTools, "lib", "apksigner.jar"), "verify", "--verbose", "--print-certs", out]);
  signer = hex(certs.match(/certificate SHA-256 digest: (\S+)/)?.[1] ?? "");
  owner = certs.match(/certificate DN: .*/)?.[0];
  // build.gradle signs with v2 and v3. v3 lets the key rotate later; v2 covers Android 7-8 (minSdk is 30,
  // so nothing here needs it; it stays as a harmless fallback). v3 is the scheme checked here.
  if (!/Verified using v3 scheme \(APK Signature Scheme v3\): true/.test(certs)) fail("the APK is not signed with the v3 scheme.");
  const badging = run(path.join(buildTools, `aapt2${process.platform === "win32" ? ".exe" : ""}`), ["dump", "badging", out]);
  versionName = badging.match(/versionName='([^']*)'/)?.[1];
  versionCode = badging.match(/versionCode='([^']*)'/)?.[1];
  debuggable = /application-debuggable/.test(badging);
}
if (!signer || signer !== releaseKey) fail(`the ${kind} is not signed with the release key (signer ${signer || "none"}, key ${releaseKey}).`);
if (versionName !== version) fail(`the ${kind} says version ${versionName}, package.json says ${version}.`);
if (debuggable) fail(`the ${kind} is debuggable.`);

console.log(`\n${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`version ${versionName} (code ${versionCode}), not debuggable`);
console.log(owner);
const certLine = `certificate SHA-256: ${signer.match(/../g).join(":").toUpperCase()}`;
console.log(certLine);

// Checksums for when the downloads go live: <hex>  <filename>, the sha256sum format (sha256sum -c).
fs.writeFileSync(`${out}.sha256`, `${crypto.createHash("sha256").update(fs.readFileSync(out)).digest("hex")}  ${path.basename(out)}\n`);
fs.writeFileSync(path.join(path.dirname(out), "SIGNING-CERT.txt"), `${owner}\n${certLine}\n`);
console.log(`wrote ${path.relative(process.cwd(), out)}.sha256 and SIGNING-CERT.txt`);
