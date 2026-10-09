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
  assert.deepEqual(PS_ARGS, ["-NoProfile", "-NonInteractive"], "no -ExecutionPolicy: it governs script files, never command text");
  const script = `$x = 'it''s'; Write-Output "caf${String.fromCharCode(0xe9)}"`;
  assert.equal(Buffer.from(encodeCommand(script), "base64").toString("utf16le"), script);
});

test("a script rides stdin as one block; only a caller that needs stdin for data sends it encoded", () => {
  const { psInvocation, encodeCommand } = require("./system-tools.cjs");
  const plain = psInvocation("try { 1 }\ncatch { 2 }");
  assert.deepEqual(plain.args, ["-NoProfile", "-NonInteractive", "-Command", "-"]);
  assert.equal(plain.input, "& {\ntry { 1 }\ncatch { 2 }\n}\n\n", "one block, then the blank line the host needs to run it");
  const withData = psInvocation("script", "photo-base64");
  assert.deepEqual(withData.args, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodeCommand("script")]);
  assert.equal(withData.input, "photo-base64");
});

test("PowerShell gets the few variables it works in, from the real Windows folder - nothing else of the parent's", () => {
  const { psEnv, PS_ENV_KEEP, windowsDir } = require("./system-tools.cjs");
  const parent = { COR_ENABLE_PROFILING: "1", COR_PROFILER_PATH: "C:\\Mock\\profiler.dll", CORECLR_PROFILER: "{x}", PSModulePath: "C:\\Mock\\Modules", __PSLockdownPolicy: "4", HTTPS_PROXY: "http://mock", NODE_OPTIONS: "--inspect", TEMP: "C:\\Mock\\Temp", PSModuleAnalysisCachePath: "C:\\Mock\\ModuleAnalysisCache" };
  const kept = ["TEMP", "PSModuleAnalysisCachePath"];
  const saved = { ...process.env };
  Object.assign(process.env, parent, { SystemRoot: "C:\\Users\\Mock\\fake-windows" });
  try {
    const env = psEnv({ KVW_EXTRA: "1" });
    for (const name of Object.keys(parent)) if (!kept.includes(name)) assert.equal(Object.hasOwn(env, name), false, `${name} reached PowerShell`);
    assert.equal(env.TEMP, "C:\\Mock\\Temp", "what PowerShell works in is kept");
    assert.equal(env.PSModuleAnalysisCachePath, "C:\\Mock\\ModuleAnalysisCache", "and where a pre-built module cache sits, or CI rebuilds it every run");
    assert.equal(env.KVW_EXTRA, "1", "and a run's own variable");
    // On Windows the folder comes from the kernel's link; elsewhere (CI's Linux run) there is none to
    // read and PowerShell never runs, so the parent's value is all there is.
    if (process.platform === "win32") {
      assert.notEqual(env.SystemRoot, "C:\\Users\\Mock\\fake-windows", "Windows comes from the kernel's link, not the parent");
      assert.equal(env.SystemRoot, windowsDir());
    }
    assert.ok(Object.keys(env).every((k) => k === "SystemRoot" || k === "KVW_EXTRA" || PS_ENV_KEEP.includes(k)));
  } finally {
    for (const name of Object.keys(parent)) delete process.env[name];
    Object.assign(process.env, saved);
  }
});

test("the PowerShell the app starts really does not see the parent's profiler, module path or lockdown variables", { skip: process.platform !== "win32" && "Windows only" }, async () => {
  const { runPsJson } = require("./system-tools.cjs");
  const names = ["COR_ENABLE_PROFILING", "COR_PROFILER_PATH", "CORECLR_ENABLE_PROFILING", "__PSLockdownPolicy"];
  const saved = { ...process.env };
  for (const name of names) process.env[name] = "mock";
  process.env.PSModulePath = "C:\\Mock\\Modules";
  try {
    const script = [`$seen = @(${names.map((n) => `'${n}'`).join(", ")}) | Where-Object { [Environment]::GetEnvironmentVariable($_, 'Process') }`, "@{ seen = @($seen); modulePath = [Environment]::GetEnvironmentVariable('PSModulePath', 'Process') } | ConvertTo-Json -Compress"].join("\n");
    const answer = await runPsJson({ script, timeoutMs: 30_000 });
    assert.deepEqual([answer.seen].flat().filter(Boolean), []);
    assert.doesNotMatch(String(answer.modulePath), /Mock/, "PowerShell built its own module path");
  } finally {
    for (const name of [...names, "PSModulePath"]) delete process.env[name];
    Object.assign(process.env, saved);
  }
});

test("a multi-line script with try/catch runs from stdin (the host needs the closing blank line)", { skip: process.platform !== "win32" && "Windows only" }, async () => {
  const { runPsJson } = require("./system-tools.cjs");
  const script = ["$ErrorActionPreference = 'Stop'", "try {", "  throw 'mock failure'", "}", "catch {", "  @{ caught = $_.Exception.Message } | ConvertTo-Json -Compress", "}"].join("\n");
  assert.deepEqual(await runPsJson({ script, timeoutMs: 30_000 }), { caught: "mock failure" });
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
