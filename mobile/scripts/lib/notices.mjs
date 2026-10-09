/**
 * The phone's "Open source licences" text, built from what actually ships in the APK:
 *  - LICENSE, LICENSE-EXCEPTION and NOTICE from the repo root;
 *  - every non-dev npm package in mobile/package-lock.json (the web bundle, the fonts and the Capacitor
 *    plugins' Android code), with its licence file read from node_modules;
 *  - the Android libraries Gradle puts in the APK, from mobile/legal/android-libraries.json, plus the
 *    Apache 2.0 text those libraries require (section 4).
 *
 * vite.config.mjs serves the result as the module "virtual:kapevault-notices" on every build and dev
 * server start, so it is made from the current lockfile each time and cannot go stale. A package with
 * no licence file stops the build. The Android list cannot be read without Gradle, so it is committed
 * and pinned to the build files by a fingerprint that notices.test.mjs checks (see android-notices.mjs).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MOBILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO = join(MOBILE, "..");
const LICENCE_FILE = /^(licen[sc]e|copying|notice)(\.(md|txt))?$/i;

const clean = (text) => text.replace(/\r\n/g, "\n").trim();

/** Non-dev packages of the lockfile, sorted: the same set `npm ci --omit=dev` installs. */
export function shippedPackages(lock) {
  return Object.entries(lock.packages)
    .filter(([path, p]) => path.startsWith("node_modules/") && !p.dev && !p.optional && !p.devOptional)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, p]) => ({ path, name: path.replace(/^node_modules\//, ""), version: p.version, license: p.license }));
}

/** One text per shipped package. Throws on a package with no licence file. */
export function npmNotices({ mobile = MOBILE } = {}) {
  const lock = JSON.parse(readFileSync(join(mobile, "package-lock.json"), "utf8"));
  const parts = shippedPackages(lock).map((pkg) => {
    const dir = join(mobile, pkg.path);
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => LICENCE_FILE.test(f)).sort() : [];
    if (files.length === 0) throw new Error(`notices: ${pkg.path} ships in the app but has no licence file. Run npm ci, or add its notice by hand.`);
    const texts = files.map((f) => clean(readFileSync(join(dir, f), "utf8")));
    return `${pkg.name} ${pkg.version} (${pkg.license ?? "see text"})\n${"-".repeat(72)}\n${texts.join("\n\n")}\n`;
  });
  return parts.join("\n\n");
}

/** Lines of the Gradle files that decide which libraries ship: dependency declarations and versions. */
const DEPENDENCY_LINE = /(implementation|api\s|classpath|Version\s*=|kotlin)/i;
const GRADLE_INPUTS = ["android/variables.gradle", "android/build.gradle", "android/app/build.gradle"];

/** Fingerprint of everything in the build files that picks the Android libraries, plus the Capacitor versions. */
export function androidInputsHash({ mobile = MOBILE } = {}) {
  const lock = JSON.parse(readFileSync(join(mobile, "package-lock.json"), "utf8"));
  const capacitor = Object.entries(lock.packages)
    .filter(([path]) => path.startsWith("node_modules/@capacitor/"))
    .map(([path, p]) => `${path} ${p.version}`)
    .sort();
  const lines = GRADLE_INPUTS.flatMap((file) =>
    readFileSync(join(mobile, file), "utf8")
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/.*$/, "").trim())
      .filter((l) => DEPENDENCY_LINE.test(l))
      .map((l) => `${file}: ${l}`),
  );
  return createHash("sha256").update([...capacitor, ...lines].join("\n")).digest("hex");
}

/** The committed Android library list as text, with the Apache 2.0 text once at the end. */
export function androidNotices({ mobile = MOBILE } = {}) {
  const { libraries } = JSON.parse(readFileSync(join(mobile, "legal", "android-libraries.json"), "utf8"));
  const lines = libraries.map((l) => `${l.id} ${l.version} - ${l.licence}${l.url ? ` (${l.url})` : ""}`);
  const apache = clean(readFileSync(join(mobile, "legal", "APACHE-2.0.txt"), "utf8"));
  return `${lines.join("\n")}\n\nApache License, Version 2.0, the text for every library above that names it:\n${"-".repeat(72)}\n${apache}\n`;
}

/** The sections of the screen, in order, and the app version. */
export function buildNotices({ mobile = MOBILE, repo = REPO } = {}) {
  const read = (file) => clean(readFileSync(join(repo, file), "utf8"));
  const version = JSON.parse(readFileSync(join(mobile, "package.json"), "utf8")).version;
  return {
    version,
    sections: [
      { name: "LICENSE", text: read("LICENSE") },
      { name: "LICENSE-EXCEPTION", text: read("LICENSE-EXCEPTION") },
      { name: "NOTICE", text: read("NOTICE") },
      { name: "Libraries in the web app", text: npmNotices({ mobile }) },
      { name: "Libraries in the Android app", text: androidNotices({ mobile }) },
    ],
  };
}
