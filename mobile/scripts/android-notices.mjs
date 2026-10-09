/**
 * Writes (or checks) mobile/legal/android-libraries.json: the Android libraries Gradle puts in the APK
 * and the licence each one's POM declares. The phone's Open source licences screen shows it
 * (scripts/lib/notices.mjs).
 *
 *   node scripts/android-notices.mjs --write   resolve both flavors' release runtime classpath with
 *                                              Gradle, read the POMs from the Gradle cache, rewrite the file
 *   node scripts/android-notices.mjs --check   the same resolve, then fail when the file differs
 *
 * Run --write after any change to a dependency (android/variables.gradle, a build.gradle, the
 * Capacitor version) and review the diff. notices.test.mjs fails until you do: it compares the
 * "inputs" fingerprint stored here with the build files, so a changed dependency cannot ship without
 * this list being looked at. Capacitor's own Java projects are npm packages and are listed by the
 * npm half of the notices. Needs the Gradle cache filled (a build has run) and `npx cap sync android`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { androidInputsHash, MOBILE } from "./lib/notices.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(MOBILE, "legal", "android-libraries.json");
const FLAVORS = ["play", "foss"];
const ANDROID_SDK_LICENCE = { licence: "Android Software Development Kit License", url: "https://developer.android.com/studio/terms.html" };

/** Libraries whose POM names no licence at all: reviewed by hand, with where the licence was read. */
const BY_HAND = {
  // POM says only "License"; the file it links (github.com/ionic-team/ion-android-filesystem/blob/main/LICENSE, read 2026-10-09) is MIT.
  "io.ionic.libs:ionfilesystem-android": { licence: "MIT License, Copyright (c) 2025 Ionic (the MIT text is under @capacitor/filesystem in the web app libraries)", url: "https://github.com/ionic-team/ion-android-filesystem/blob/main/LICENSE" },
};

/** `+--- group:artifact:1.0 -> 2.0 (*)` -> { id, version }. Projects, constraints (c) and other lines -> null. */
export function parseLine(line) {
  const m = /^[| ]*[+\\]--- (.+?)(?: \(([*cn])\))?$/.exec(line.trimEnd());
  if (!m || m[2] === "c" || m[1].startsWith("project ")) return null;
  const [coordinate, upgraded] = m[1].split(" -> ");
  const [group, artifact, version] = coordinate.split(":");
  const final = upgraded ?? version;
  return artifact && final ? { id: `${group}:${artifact}`, version: final } : null;
}

function resolved(flavor) {
  const run = spawnSync(process.execPath, [join(here, "gradle.mjs"), "--offline", "-q", ":app:dependencies", "--configuration", `${flavor}ReleaseRuntimeClasspath`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`gradle dependencies (${flavor}) failed:\n${run.stdout}${run.stderr}`);
  return run.stdout.split(/\r?\n/).map(parseLine).filter(Boolean);
}

const cacheRoot = () => join(process.env.GRADLE_USER_HOME ?? join(homedir(), ".gradle"), "caches", "modules-2", "files-2.1");

function pomPath(id, version) {
  const [group, artifact] = id.split(":");
  const dir = join(cacheRoot(), group, artifact, version);
  if (!existsSync(dir)) return null;
  for (const hash of readdirSync(dir)) {
    const file = join(dir, hash, `${artifact}-${version}.pom`);
    if (existsSync(file)) return file;
  }
  return null;
}

const tag = (xml, name) => new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`).exec(xml)?.[1];

/** The first <licenses> entry of the POM, or of its parent chain. */
export function licenceOf(id, version, depth = 0) {
  if (BY_HAND[id]) return BY_HAND[id];
  const file = pomPath(id, version);
  if (!file) throw new Error(`android-notices: no POM in the Gradle cache for ${id}:${version}. Run a build first.`);
  const xml = readFileSync(file, "utf8");
  const block = /<licenses>([\s\S]*?)<\/licenses>/.exec(xml.replace(/<!--[\s\S]*?-->/g, ""))?.[1];
  const name = block && tag(block, "name");
  if (name) return { licence: name, url: tag(block, "url") };
  const parent = /<parent>([\s\S]*?)<\/parent>/.exec(xml)?.[1];
  if (parent && depth < 5) return licenceOf(`${tag(parent, "groupId")}:${tag(parent, "artifactId")}`, tag(parent, "version"), depth + 1);
  throw new Error(`android-notices: ${id}:${version} names no licence. Add it to BY_HAND after reading its licence.`);
}

export function collect(lists) {
  const byId = new Map();
  lists.forEach((libs, i) => {
    for (const { id, version } of libs) {
      const key = `${id}:${version}`;
      const entry = byId.get(key) ?? { id, version, flavors: [] };
      if (!entry.flavors.includes(FLAVORS[i])) entry.flavors.push(FLAVORS[i]);
      byId.set(key, entry);
    }
  });
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));
}

function build() {
  const libraries = collect(FLAVORS.map(resolved)).map((l) => {
    // Google's Play libraries link the Android SDK terms from their POM; keep one spelling for them.
    const found = licenceOf(l.id, l.version);
    const play = /^(com\.android\.billingclient|com\.google\.android\.gms)(:|$)/.test(l.id);
    return { ...l, ...(play ? ANDROID_SDK_LICENCE : found) };
  });
  return { inputs: androidInputsHash(), libraries };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    console.error("usage: node scripts/android-notices.mjs --write | --check");
    process.exit(2);
  }
  const text = `${JSON.stringify(build(), null, 2)}\n`;
  if (mode === "--write") {
    writeFileSync(OUT, text);
    console.log(`android-notices: ${JSON.parse(text).libraries.length} libraries -> legal/android-libraries.json`);
  } else if (readFileSync(OUT, "utf8").replaceAll("\r\n", "\n") !== text) { // a Windows checkout may hold CRLF
    console.error("android-notices: legal/android-libraries.json is out of date. Run node scripts/android-notices.mjs --write and review the diff.");
    process.exit(1);
  } else console.log("android-notices: up to date");
}
