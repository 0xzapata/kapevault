// The Android SDK and JDK for the phone's builds, set for child processes only (never globally).
// The SDK is ANDROID_HOME (or ANDROID_SDK_ROOT): the folder that holds platform-tools, or one level up
// from it (an Sdk folder inside, as some installs set it). KAPEVAULT_SDK overrides both: when it is set,
// it is the only one looked at. Gradle needs JDK 21: KAPEVAULT_JDK, else Android Studio's bundled one on
// Windows when it is installed (a JAVA_HOME there is often an older JDK), else JAVA_HOME.
import fs from "node:fs";
import path from "node:path";

function findSdk() {
  const own = process.env.KAPEVAULT_SDK;
  if (own) {
    for (const dir of [own, path.join(own, "Sdk")]) if (fs.existsSync(path.join(dir, "platform-tools"))) return dir.replaceAll("\\", "/");
    console.error(`KAPEVAULT_SDK is ${own}, which has no platform-tools (nor an Sdk folder with them). Point it at your Android SDK folder, or unset it to use ANDROID_HOME.`);
    process.exit(1);
  }
  const named = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean);
  if (named.length === 0) {
    console.error("Set ANDROID_HOME to your Android SDK folder (the one with platform-tools in it) - Android Studio shows it under Settings > Languages & Frameworks > Android SDK.");
    process.exit(1);
  }
  for (const dir of named.flatMap((d) => [d, path.join(d, "Sdk")])) if (fs.existsSync(path.join(dir, "platform-tools"))) return dir.replaceAll("\\", "/");
  console.error(`No Android SDK (a folder with platform-tools in it) at ${[...new Set(named)].join(" or ")}. Point ANDROID_HOME at your Android SDK folder.`);
  process.exit(1);
}

export const sdk = findSdk();
const STUDIO_JDK = "C:/Program Files/Android/Android Studio/jbr";
const studio = process.platform === "win32" && fs.existsSync(STUDIO_JDK) ? STUDIO_JDK : undefined;
export const jdk = process.env.KAPEVAULT_JDK || studio || process.env.JAVA_HOME || undefined;

const exe = process.platform === "win32" ? ".exe" : "";
export const adb = path.join(sdk, "platform-tools", `adb${exe}`);
export const emulator = path.join(sdk, "emulator", `emulator${exe}`);

export const env = {
  ...process.env,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
  ...(jdk && { JAVA_HOME: jdk, PATH: `${path.join(jdk, "bin")}${path.delimiter}${process.env.PATH}` }),
};
