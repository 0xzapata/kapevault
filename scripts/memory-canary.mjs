// What stays in memory after the vault locks? Dev measurement, not part of `npm run e2e`.
// Creates a throwaway vault whose master password and one entry password are random canaries, reveals
// the entry, locks, waits, then takes a full memory dump of every process the app started and counts
// both canaries in each (UTF-8 and UTF-16LE). Run it on the UNPACKED app after `npm run build`:
//
//   node scripts/memory-canary.mjs --procdump D:\path\to\procdump64.exe [--wait 60] [--keep] [--gc]
//
// The app starts with --hidden, so no window opens. Playwright comes through scripts/playwright.cjs
// (set PLAYWRIGHT_PATH if it is not installed here). The dump tool is Sysinternals procdump (download
// only from https://download.sysinternals.com/files/Procdump.zip); the script refuses it unless its
// Authenticode signature is Microsoft's. It never uses comsvcs MiniDump (an LSASS-dump technique that
// Defender flags). Dumps are deleted afterwards unless --keep is given. Exit code 1 = a canary was found
// in a process after the lock.
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron: electron } = require("./playwright.cjs");
const APP = process.env.KAPEVAULT_CANARY_APP || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const PROCDUMP = arg("procdump");
const WAIT_SECONDS = Number(arg("wait", "60"));
const KEEP = process.argv.includes("--keep");
const FORCE_GC = process.argv.includes("--gc"); // experiment: ask the main process's V8 to collect after the lock

if (process.platform !== "win32") throw new Error("Windows only (procdump).");
if (!PROCDUMP || !fs.existsSync(PROCDUMP)) throw new Error("Pass --procdump <path to procdump64.exe>.");
if (!fs.existsSync(path.join(APP, "dist", "index.html"))) throw new Error("Run `npm run build` first: dist/ is missing.");

const ps = (command) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function requireMicrosoftSignature(file) {
  const out = ps(`$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`).trim();
  const [status, subject] = out.split("|");
  if (status !== "Valid" || !/^CN=Microsoft Corporation,/.test(subject)) throw new Error(`${file} is not signed by Microsoft: ${out}`);
}

// A random canary: long enough that a hit can only be the canary, and strong enough to pass the master rule.
const canary = (prefix) => `${prefix}${crypto.randomBytes(12).toString("base64url").replace(/[-_]/g, "x")}`;
const MASTER = canary("Mq");
const ENTRY = canary("Pw");

// Every process below `rootPid`, each with the kind Chromium gave it on its command line.
function processTree(rootPid) {
  const rows = JSON.parse(ps("Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"));
  const byParent = Map.groupBy(rows, (r) => r.ParentProcessId);
  const found = [];
  const walk = (pid) => {
    for (const r of byParent.get(pid) ?? []) {
      found.push(r);
      walk(r.ProcessId);
    }
  };
  const root = rows.find((r) => r.ProcessId === rootPid);
  if (root) found.push(root);
  walk(rootPid);
  const kind = (r) => {
    const type = /--type=([\w-]+)/.exec(r.CommandLine ?? "")?.[1];
    if (!type) return "main";
    if (type === "utility") return `utility(${/--utility-sub-type=([\w.]+)/.exec(r.CommandLine)?.[1] ?? "?"})`;
    return type === "gpu-process" ? "gpu" : type;
  };
  return found.filter((r) => /^electron\.exe$/i.test(r.Name)).map((r) => ({ pid: r.ProcessId, kind: kind(r) }));
}

// Counts non-overlapping occurrences of each needle in a file, streaming so a dump never loads whole.
async function countIn(file, needles) {
  const counts = needles.map(() => 0);
  const keep = Math.max(...needles.map((n) => n.length)) - 1;
  let tail = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 32 * 1024 * 1024 })) {
    const window = Buffer.concat([tail, chunk]);
    needles.forEach((needle, i) => {
      for (let at = window.indexOf(needle); at >= 0; at = window.indexOf(needle, at + needle.length)) {
        // A match wholly inside the carried tail was counted with the previous chunk.
        if (at + needle.length > tail.length) counts[i]++;
      }
    });
    tail = window.subarray(Math.max(0, window.length - keep));
  }
  return counts;
}

const NEEDLES = [
  ["master utf8", Buffer.from(MASTER, "utf8")],
  ["master utf16", Buffer.from(MASTER, "utf16le")],
  ["entry utf8", Buffer.from(ENTRY, "utf8")],
  ["entry utf16", Buffer.from(ENTRY, "utf16le")],
];

async function dumpAndCount(processes, dumpDir, label) {
  const rows = [];
  for (const p of processes) {
    const file = path.join(dumpDir, `${label}-${p.kind.replace(/\W+/g, "_")}-${p.pid}.dmp`);
    // procdump's exit code is the number of dumps it wrote (1 = success), so the file is the proof.
    const run = spawnSync(PROCDUMP, ["-accepteula", "-ma", String(p.pid), file], { encoding: "utf8" });
    if (!fs.existsSync(file)) throw new Error(`procdump wrote no dump for ${p.kind} ${p.pid}: ${run.stdout}${run.stderr}`);
    const counts = await countIn(file, NEEDLES.map(([, n]) => n));
    rows.push({ pid: p.pid, kind: p.kind, mb: Math.round(fs.statSync(file).size / 1048576), ...Object.fromEntries(NEEDLES.map(([name], i) => [name, counts[i]])) });
    if (!KEEP) fs.rmSync(file, { force: true });
  }
  return rows;
}

const pids = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getOSProcessId()));

requireMicrosoftSignature(PROCDUMP);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-canary-"));
const dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-canary-dumps-"));
let app;
let leaked = true;
try {
  app = await electron.launch({
    executablePath: require(`${APP}/node_modules/electron`),
    args: [APP, "--hidden"],
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ELECTRON_RUN_AS_NODE")), KAPEVAULT_DATA_DIR: dataDir, KAPEVAULT_AUTO_LOCK_SECONDS: "86400" },
  });
  const page = await app.firstWindow();
  await page.waitForURL((u) => u.protocol === "app:", { waitUntil: "domcontentloaded" });

  await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
  await page.getByPlaceholder("Confirm master password").fill(MASTER);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Nothing here yet").waitFor({ timeout: 30000 });

  await page.getByRole("button", { name: "New" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("GitHub").fill("Mock canary login");
  await dialog.getByText("Username or email").locator("..").locator("input").fill("canary@example.com");
  await dialog.getByText("Password", { exact: true }).locator("..").locator("input").fill(ENTRY);
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.locator("h1", { hasText: "Mock canary login" }).waitFor();
  await page.getByRole("button", { name: "Reveal" }).click();
  await page.getByText(ENTRY).waitFor();
  const before = await pids(app);

  const rootPid = app.process().pid;
  const control = await dumpAndCount(processTree(rootPid), dumpDir, "unlocked");

  await page.getByRole("button", { name: "Lock vault" }).click();
  await page.getByRole("button", { name: "Continue" }).waitFor({ timeout: 30000 });
  await new Promise((r) => setTimeout(r, WAIT_SECONDS * 1000));
  if (FORCE_GC) {
    await app.evaluate(() => {
      const nodeRequire = process.mainModule.require;
      nodeRequire("node:v8").setFlagsFromString("--expose-gc");
      const gc = nodeRequire("node:vm").runInNewContext("gc");
      gc();
      gc();
    });
    await new Promise((r) => setTimeout(r, 2000));
  }
  const after = await pids(app);
  const pageStillUsable = await page.getByRole("button", { name: "Continue" }).isVisible();
  const locked = await dumpAndCount(processTree(rootPid), dumpDir, "locked");

  const table = (rows) => rows.map((r) => `  ${String(r.pid).padStart(6)}  ${r.kind.padEnd(18)} ${String(r.mb).padStart(5)} MB  ${NEEDLES.map(([name]) => `${name}=${r[name]}`).join("  ")}`).join("\n");
  console.log(`renderer pids  before lock: ${before.join(",")}   after lock + ${WAIT_SECONDS}s: ${after.join(",")}   new process: ${before.every((p, i) => p !== after[i])}   page still usable: ${pageStillUsable}`);
  console.log(`\nUNLOCKED, entry revealed (control: the method must find the canaries here)\n${table(control)}`);
  console.log(`\nLOCKED, ${WAIT_SECONDS}s later\n${table(locked)}`);
  leaked = locked.some((r) => NEEDLES.some(([name]) => r[name] > 0));
} finally {
  await app?.close().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (!KEEP) fs.rmSync(dumpDir, { recursive: true, force: true });
}
process.exit(leaked ? 1 : 0);
