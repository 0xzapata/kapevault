// Does the Windows Hello signature reach PowerShell's logs? Dev measurement, not part of `npm run e2e`.
//
// It pushes a canary through the real electron/windows-hello.ps1: everything before the script's
// `switch` (type loads, Await, Sign-Challenge, Write-Result) runs as shipped, with only the Windows
// call that needs a Hello prompt replaced by a managed IBuffer holding the canary. It goes through
// the transport the app uses (runPsJson), with Transcription, Script Block Logging and Module Logging
// ON. Then it searches the transcript folder and the Microsoft-Windows-PowerShell/Operational log for
// the canary. Exit code 1 = the canary was found in a log.
//
//   node scripts/hello-log-check.mjs                    policy emulated inside the PowerShell process
//   node scripts/hello-log-check.mjs --registry HKLM    real policy keys (run from an ADMIN shell)
//
// Why two modes: Group Policy for PowerShell lives under Software\Policies, and a standard user cannot
// write there even in HKCU (ACL: SYSTEM and Administrators only; checked). The default mode sets the
// same three policies in PowerShell's own policy cache (Utils.cachedGroupPolicySettings, the dictionary
// it fills from those registry keys) and starts a transcript, then proves with marker commands that each
// of the three channels records; no admin, nothing outside the process is touched. --registry writes
// the real keys and removes them in a finally block, proving they are gone.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { runPsJson, powershellPath } = require("../electron/system-tools.cjs");
const HELLO_PS1 = path.join(here, "..", "electron", "windows-hello.ps1");

if (process.platform !== "win32") throw new Error("Windows only.");

const registryHive = process.argv.includes("--registry") ? process.argv[process.argv.indexOf("--registry") + 1] : null;
const transcriptDir = fs.mkdtempSync(path.join(process.env.KVW_TOOLS ?? os.tmpdir(), "pstx-"));

// --- real policy keys (--registry) -------------------------------------------------------------------
const ROOT = `${registryHive}\\Software\\Policies\\Microsoft\\Windows\\PowerShell`;
const KEYS = [`${ROOT}\\Transcription`, `${ROOT}\\ScriptBlockLogging`, `${ROOT}\\ModuleLogging`];
const reg = (...args) => execFileSync("reg.exe", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const regExists = (key) => {
  try {
    reg("query", key);
    return true;
  } catch {
    return false;
  }
};
function setPolicyKeys() {
  const dword = (key, name) => reg("add", key, "/v", name, "/t", "REG_DWORD", "/d", "1", "/f");
  dword(KEYS[0], "EnableTranscripting");
  dword(KEYS[0], "EnableInvocationHeader");
  reg("add", KEYS[0], "/v", "OutputDirectory", "/t", "REG_SZ", "/d", transcriptDir, "/f");
  dword(KEYS[1], "EnableScriptBlockLogging");
  dword(KEYS[1], "EnableScriptBlockInvocationLogging");
  dword(KEYS[2], "EnableModuleLogging");
  reg("add", `${KEYS[2]}\\ModuleNames`, "/v", "*", "/t", "REG_SZ", "/d", "*", "/f");
}

// --- emulated policy: runs first inside the PowerShell process under test ----------------------------
const EMULATE = `
$cache = [psobject].Assembly.GetType('System.Management.Automation.Utils').GetField('cachedGroupPolicySettings', 'NonPublic,Static').GetValue($null)
$base = 'HKEY_LOCAL_MACHINE\\Software\\Policies\\Microsoft\\Windows\\PowerShell'
$sb = New-Object 'System.Collections.Generic.Dictionary[string,object]'
$sb['EnableScriptBlockLogging'] = 1
$sb['EnableScriptBlockInvocationLogging'] = 1
$cache["$base\\ScriptBlockLogging"] = $sb
$ml = New-Object 'System.Collections.Generic.Dictionary[string,object]'
$ml['EnableModuleLogging'] = 1
$ml['ModuleNames'] = [string[]]@('*')
$cache["$base\\ModuleLogging"] = $ml
foreach ($m in Get-Module) { $m.LogPipelineExecutionDetails = $true }
Start-Transcript -Path (Join-Path $env:KVW_TRANSCRIPT_DIR 'emulated.txt') -IncludeInvocationHeader | Out-Null
`;
const STOP_TRANSCRIPT = "Stop-Transcript | Out-Null";

// Marker commands: one cmdlet call and one call of a function defined in the session.
const markerScript = (marker) => `function Kvw-Marker($Text) { $Text.Length | Out-Null }\nWrite-Output '${marker}'\nKvw-Marker '${marker}-fn'`;

// The real script up to its `switch`, then a stand-in for the Hello call, then the real catch block.
function replayScript(challengeB64) {
  const src = fs.readFileSync(HELLO_PS1, "utf8").replace(/^﻿/, "");
  const cut = src.indexOf("  switch ($Op) {");
  const tail = src.lastIndexOf("} catch {");
  if (cut < 0 || tail < 0) throw new Error("windows-hello.ps1 changed shape: update replayScript");
  const standIn = [
    "  function Await($op, [Type]$t) {",
    "    [pscustomobject]@{ Status = 'Success'; Result = $BufferExt::AsBuffer([Convert]::FromBase64String($env:KVW_CANARY)) }",
    "  }",
    "  $credential = [pscustomobject]@{}",
    "  $credential | Add-Member -MemberType ScriptMethod -Name RequestSignAsync -Value { param($data) $null }",
    "  Write-Result (Sign-Challenge $credential)",
    "",
  ].join("\n");
  return `$Op = 'sign'; $Challenge = '${challengeB64}'\n${src.slice(0, cut)}${standIn}${src.slice(tail)}`;
}

// Every transcript file's text, and every Operational event (id + message) since `since`.
function readLogs(since) {
  const files = fs.readdirSync(transcriptDir, { recursive: true }).map((f) => path.join(transcriptDir, String(f))).filter((f) => fs.statSync(f).isFile());
  const transcripts = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const command = `Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-PowerShell/Operational'; StartTime = [datetime]'${since.toISOString()}' } -ErrorAction SilentlyContinue | ForEach-Object { "EVENT $($_.Id)"; $_.Message }`;
  const events = execFileSync(powershellPath(), ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { transcripts, events, files: files.length };
}
const count = (text, needle) => text.split(needle).length - 1;
const eventIds = (events, needle) => [...new Set(events.split(/^EVENT /m).filter((e) => e.includes(needle)).map((e) => e.split(/\r?\n/, 1)[0]))];

const token = crypto.randomBytes(48).toString("hex"); // 96 ASCII chars
const canary = Buffer.from(token.padEnd(256, "z"), "utf8"); // a signature-sized value
const canaryB64 = canary.toString("base64");
const marker = `KVWMARK${crypto.randomBytes(6).toString("hex")}`;
const env = { KVW_CANARY: canaryB64, KVW_TRANSCRIPT_DIR: transcriptDir };
let leaked = true;
try {
  if (registryHive) {
    if (KEYS.some(regExists)) throw new Error("A PowerShell policy key already exists: not touching it.");
    setPolicyKeys();
  }
  const prelude = registryHive ? "" : EMULATE;
  const postlude = registryHive ? "" : STOP_TRANSCRIPT;
  const since = new Date(Date.now() - 2000);

  // 1. marker run: is each channel recording?
  await runPsJson({ script: `${prelude}\n${markerScript(marker)}\n${postlude}\n@{ status = 'Success' } | ConvertTo-Json -Compress`, timeoutMs: 60_000, env });
  const proof = readLogs(since);
  const markerEvents = eventIds(proof.events, marker);
  console.log(`channels recording (${registryHive ? `${registryHive} policy keys` : "policy emulated in-process"}), marker ${marker}:`);
  console.log(`  transcription          ${count(proof.transcripts, marker) > 0 ? "yes" : "NO"}  (${proof.files} transcript files)`);
  console.log(`  script block (4104)    ${markerEvents.includes("4104") ? "yes" : "NO"}`);
  console.log(`  module logging (4103)  ${markerEvents.includes("4103") ? "yes" : "NO"}   function call logged: ${eventIds(proof.events, `${marker}-fn`).includes("4103") ? "yes" : "no"}`);

  // 2. control: the same canary handed to a cmdlet MUST show up, or this check proves nothing
  const control = new Date(Date.now() - 2000);
  const leakyScript = "$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:KVW_CANARY))\nWrite-Output $text | Out-Null";
  await runPsJson({ script: `${prelude}\n${leakyScript}\n${postlude}\n@{ status = 'Success' } | ConvertTo-Json -Compress`, timeoutMs: 60_000, env });
  const controlLogs = readLogs(control);
  console.log(`\ncontrol (canary given to Write-Output): transcript ${count(controlLogs.transcripts, token)}, event log ${count(controlLogs.events, token)} (events ${eventIds(controlLogs.events, token).join(", ") || "none"})`);

  // 3. the canary through the real Hello script
  await new Promise((r) => setTimeout(r, 2000)); // so the control run's events fall before the window below
  const before = new Date();
  const prior = proof.files;
  const result = await runPsJson({ script: `${prelude}\n${replayScript(crypto.randomBytes(32).toString("base64"))}\n${postlude}`, timeoutMs: 60_000, env });
  const logs = readLogs(before);
  console.log(`\nscript answered: status=${result.status}, signature field ${typeof result.signature === "string" ? `${result.signature.length} chars` : "absent"} (transcript files now ${logs.files}, was ${prior})`);
  const hits = [
    ["transcript: canary base64", count(logs.transcripts, canaryB64)],
    ["transcript: canary token", count(logs.transcripts, token)],
    ["event log: canary base64", count(logs.events, canaryB64)],
    ["event log: canary token", count(logs.events, token)],
  ];
  for (const [name, n] of hits) console.log(`  ${name.padEnd(28)} ${n}`);
  console.log(`  events that carry it: ${[...new Set([...eventIds(logs.events, canaryB64), ...eventIds(logs.events, token)])].join(", ") || "none"}`);
  leaked = hits.some(([, n]) => n > 0);
} finally {
  if (registryHive) {
    for (const key of KEYS) if (regExists(key)) reg("delete", key, "/f");
    const left = KEYS.filter(regExists);
    console.log(`\npolicy keys removed: ${left.length === 0 ? "yes (all three gone)" : `NO, still there: ${left.join(", ")}`}`);
  }
  fs.rmSync(transcriptDir, { recursive: true, force: true });
}
process.exit(leaked ? 1 : 0);
