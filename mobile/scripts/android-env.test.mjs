import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const envModule = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "android-env.mjs")).href;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-android-env-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const sdkAt = (name) => {
  fs.mkdirSync(path.join(tmp, name, "platform-tools"), { recursive: true });
  return path.join(tmp, name);
};
const good = sdkAt("good");
const nested = path.join(tmp, "nested");
sdkAt(path.join("nested", "Sdk"));
const empty = path.join(tmp, "empty");
fs.mkdirSync(empty);

// android-env.mjs as a script started under `vars` (nothing else of the SDK or JDK inherited) sees it.
function load(vars) {
  const env = { ...process.env };
  for (const name of ["KAPEVAULT_SDK", "ANDROID_HOME", "ANDROID_SDK_ROOT", "KAPEVAULT_JDK", "JAVA_HOME"]) delete env[name];
  const code = `import(${JSON.stringify(envModule)}).then((m) => console.log(JSON.stringify({ sdk: m.sdk, jdk: m.jdk ?? null, JAVA_HOME: m.env.JAVA_HOME ?? null })))`;
  const run = spawnSync(process.execPath, ["-e", code], { env: { ...env, ...vars }, encoding: "utf8" });
  return { status: run.status, stderr: run.stderr, ...(run.status === 0 ? JSON.parse(run.stdout) : {}) };
}
const slash = (p) => p.replaceAll("\\", "/");

test("KAPEVAULT_SDK overrides ANDROID_HOME: one without platform-tools stops with its name, never falls through", () => {
  const run = load({ KAPEVAULT_SDK: empty, ANDROID_HOME: good });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /KAPEVAULT_SDK/);
  assert.equal(load({ KAPEVAULT_SDK: nested, ANDROID_HOME: good }).sdk, slash(path.join(nested, "Sdk")));
  assert.equal(load({ ANDROID_HOME: good }).sdk, slash(good));
});

test("the JDK is KAPEVAULT_JDK, else Android Studio's on Windows when installed, else JAVA_HOME; JAVA_HOME is set only with one", () => {
  const studio = process.platform === "win32" && fs.existsSync("C:/Program Files/Android/Android Studio/jbr") ? "C:/Program Files/Android/Android Studio/jbr" : null;
  const own = load({ ANDROID_HOME: good, KAPEVAULT_JDK: "/jdk/own", JAVA_HOME: "/jdk/java-home" });
  assert.deepEqual([own.jdk, own.JAVA_HOME], ["/jdk/own", "/jdk/own"]);
  const javaHome = load({ ANDROID_HOME: good, JAVA_HOME: "/jdk/java-home" });
  assert.deepEqual([javaHome.jdk, javaHome.JAVA_HOME], [studio ?? "/jdk/java-home", studio ?? "/jdk/java-home"]);
  const none = load({ ANDROID_HOME: good });
  assert.deepEqual([none.jdk, none.JAVA_HOME], [studio, studio]);
});
