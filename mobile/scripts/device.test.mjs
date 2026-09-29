import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const deviceModule = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "lib", "device.mjs")).href;
// device.mjs loads android-env.mjs, which exits without an SDK folder (one with platform-tools in it), so
// it runs in a child process pointed at an empty one.
const sdk = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-device-"));
fs.mkdirSync(path.join(sdk, "platform-tools"));
after(() => fs.rmSync(sdk, { recursive: true, force: true }));

// `answerWithin(<asked>, <ms>)` in a child process: what it resolved with and how long the process ran.
function answer(asked, ms) {
  const code = `import(${JSON.stringify(deviceModule)}).then(async (m) => console.log(JSON.stringify(await m.answerWithin(${asked}, ${ms}))))`;
  const started = Date.now();
  const run = spawnSync(process.execPath, ["-e", code], { env: { ...process.env, KAPEVAULT_SDK: sdk }, encoding: "utf8", timeout: 30000 });
  assert.equal(run.status, 0, run.stderr);
  return { result: JSON.parse(run.stdout), ms: Date.now() - started };
}

test("a DevTools answer that comes in time leaves no deadline timer behind, so the script ends at once", () => {
  const { result, ms } = answer("Promise.resolve({ value: 1 })", 20000);
  assert.deepEqual(result, { value: 1 });
  assert.ok(ms < 10000, `the script lingered ${ms} ms after its answer`);
});

test("a DevTools answer that never comes is replaced by a no-answer result after the deadline", () => {
  const { result } = answer("new Promise((resolve) => setTimeout(resolve, 1000, { value: 1 }))", 50);
  assert.deepEqual(result, { exceptionDetails: { exception: { value: "no answer from the page in 0.05 s" } } });
});
