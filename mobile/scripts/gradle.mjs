// Runs the Gradle wrapper in android/ with this PC's SDK and JDK: `node scripts/gradle.mjs assembleDebug`.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./android-env.mjs";

const androidDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "android");
// Windows runs a .bat only through cmd.exe; the task names are ours, so the joined line is safe.
const { status } =
  process.platform === "win32"
    ? spawnSync(`"${path.join(androidDir, "gradlew.bat")}" ${process.argv.slice(2).join(" ")}`, { cwd: androidDir, env, stdio: "inherit", shell: true })
    : spawnSync(path.join(androidDir, "gradlew"), process.argv.slice(2), { cwd: androidDir, env, stdio: "inherit" });
process.exit(status ?? 1);
