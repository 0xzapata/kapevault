const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { system32, windowsDir, sameDir, canElevate } = require("./system-tools.cjs");
const { runElevated } = require("./air-wall.cjs");

test("one Windows folder, however it is written", () => {
  assert.ok(sameDir("C:\\WINDOWS", "C:\\Windows"));
  assert.ok(sameDir("c:\\Windows\\", "C:\\Windows"));
  assert.ok(sameDir("C:/Windows", "C:\\Windows"));
  assert.ok(!sameDir("C:\\Users\\Mock\\Windows", "C:\\Windows"));
  assert.ok(!sameDir("D:\\Windows", "C:\\Windows"));
  assert.ok(!sameDir(undefined, "C:\\Windows"));
  assert.ok(!sameDir("C:\\Windows", null));
});

test("elevation needs the environment to agree with Windows itself", () => {
  assert.equal(canElevate("C:\\WINDOWS", "C:\\Windows"), true);
  assert.equal(canElevate("C:\\Users\\Mock\\fake-windows", "C:\\Windows"), false);
  assert.equal(canElevate("", "C:\\Windows"), false);
  assert.equal(canElevate("C:\\Windows", null), false); // Windows could not be asked: refuse
});

test("a planted SystemRoot never picks the programs, and no UAC prompt follows it", { skip: process.platform !== "win32" && "Windows only" }, async () => {
  const real = windowsDir();
  assert.ok(real && fs.statSync(path.join(real, "System32")).isDirectory());
  assert.ok(sameDir(real, process.env.SystemRoot), "this PC's own environment agrees");
  const saved = process.env.SystemRoot;
  process.env.SystemRoot = "C:\\Users\\Mock\\fake-windows";
  try {
    assert.equal(system32("curl.exe"), path.join(real, "System32", "curl.exe"));
    await assert.rejects(runElevated("exit 0"), /wrong Windows folder/);
  } finally {
    process.env.SystemRoot = saved;
  }
});

test("PowerShell always runs with no profile and no prompts, the script as UTF-16LE base64", () => {
  const { PS_ARGS, encodeCommand } = require("./system-tools.cjs");
  assert.deepEqual(PS_ARGS, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"]);
  const script = `$x = 'it''s'; Write-Output "caf${String.fromCharCode(0xe9)}"`;
  assert.equal(Buffer.from(encodeCommand(script), "base64").toString("utf16le"), script);
});

test("runPsJson answers with the last JSON line, feeds stdin, and tells a timeout apart", { skip: process.platform !== "win32" && "Windows only" }, async () => {
  const { runPsJson } = require("./system-tools.cjs");
  const noisy = `Write-Output 'warming up'; Write-Output '{"first":1}'; Write-Output '{"last":2}'`;
  assert.deepEqual(await runPsJson({ script: noisy, timeoutMs: 30_000 }), { last: 2 });
  const echo = "$text = [Console]::In.ReadToEnd(); @{ got = $text } | ConvertTo-Json -Compress";
  assert.deepEqual(await runPsJson({ script: echo, stdin: "mock-base64==", timeoutMs: 30_000 }), { got: "mock-base64==" });
  await assert.rejects(runPsJson({ script: "Write-Output 'no json here'", timeoutMs: 30_000 }), (e) => e.timedOut === false);
  await assert.rejects(runPsJson({ script: "Start-Sleep -Seconds 20", timeoutMs: 1500 }), (e) => e.timedOut === true);
});
