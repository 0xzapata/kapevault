// The CLI end to end: each test spawns it against a throwaway vault made with the app's own session.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { seeded, MASTER } = require("../electron/fixtures/vault-session-helpers.cjs");
const { openFile, encryptWithKey } = require("../electron/vault-crypto.cjs");
const { totpCode } = require("../electron/totp.cjs");

const ROOT = path.join(__dirname, "..");
const KEY = "JBSWY3DPEHPK3PXPJBSW";

// { code, stdout, stderr } of one run; KAPEVAULT_MASTER is the vault's master unless env says otherwise.
function cli(dir, args, { input, env, stdio = "pipe" } = {}) {
  const { status, stdout, stderr, error } = spawnSync(process.execPath, ["cli/kapevault.cjs", ...args], {
    cwd: ROOT,
    input,
    encoding: "utf8",
    timeout: 15_000,
    stdio,
    env: { ...process.env, KAPEVAULT_DATA_DIR: dir, KAPEVAULT_MASTER: MASTER, ...env },
  });
  if (error) throw error;
  return { code: status, stdout, stderr };
}

// A vault holding the helpers' GitHub login (me / s3cret-pass!) in Personal.
async function vaultDir() {
  const { file, vault, spaceId, id } = await seeded();
  return { dir: path.dirname(file), vault, spaceId, id };
}

const json = (run) => {
  assert.equal(run.code, 0, run.stderr);
  return JSON.parse(run.stdout);
};

const assertOtp = (code) => {
  const now = Date.now();
  const expected = [-30_000, 0, 30_000].map((offset) => totpCode(`otpauth://totp/x?secret=${KEY}`, now + offset).code);
  assert.ok(expected.includes(code), `Expected ${expected.join(" or ")}, got ${code}`);
};

// One login made through `item create`, read by the four tests after it.
const created = (async () => {
  const { dir } = await vaultDir();
  const run = cli(dir, ["item", "create", "--category", "login", "--title", "Bank", "--generate-password=letters,digits,20", `otp=${KEY}`, "username=bob", "--format", "json"]);
  return { dir, item: json(run) };
})();

test("vault list --format json lists the personal vault and its live items", async () => {
  const { dir } = await vaultDir();
  const spaces = json(cli(dir, ["vault", "list", "--format", "json"]));
  assert.deepEqual(spaces.map(({ name, kind, items }) => ({ name, kind, items })), [{ name: "Personal", kind: "personal", items: 1 }]);
  assert.match(spaces[0].id, /^[0-9a-f-]{36}$/);
});

test("item create makes a login with a generated password and a 2FA key", async () => {
  const { item } = await created;
  assert.equal(item.title, "Bank");
  assert.equal(item.category, "LOGIN");
  assert.equal(item.vault.name, "Personal");
  const password = item.fields.find((f) => f.id === "password");
  assert.match(password.value, /^[A-Za-z0-9]{20}$/);
  assert.match(password.value, /[A-Za-z]/);
  assert.match(password.value, /\d/);
  assert.equal(password.type, "CONCEALED");
});

test("item create accepts the JSON from --dry-run", async () => {
  const { dir } = await vaultDir();
  const dryRun = cli(dir, ["item", "create", "--dry-run", "--category", "login", "--title", "Preview", "username=bob", "password=preview-secret"]);
  const preview = json(dryRun);
  assert.equal(typeof preview.spaceId, "string");
  assert.equal(json(cli(dir, ["item", "list", "--format", "json"])).length, 1);
  const item = json(cli(dir, ["item", "create", "-", "--format", "json"], { input: dryRun.stdout }));
  assert.equal(item.title, "Preview");
  assert.equal(item.vault.id, preview.spaceId);
  assert.equal(item.fields.find((f) => f.id === "username").value, "bob");
  assert.equal(item.fields.find((f) => f.id === "password").value, "preview-secret");
  const saved = json(cli(dir, ["item", "get", item.id, "--format", "json"]));
  assert.deepEqual(saved, item);
});

test("item get --format json reveals the password and gives the current OTP code", async () => {
  const { dir, item } = await created;
  const got = json(cli(dir, ["item", "get", "Bank", "--format", "json"]));
  assert.equal(got.id, item.id);
  assert.equal(got.fields.find((f) => f.id === "password").value, item.fields.find((f) => f.id === "password").value);
  assert.equal(got.fields.find((f) => f.id === "username").value, "bob");
  assertOtp(got.fields.find((f) => f.type === "OTP").value);
});

test("item get without --reveal hides the password", async () => {
  const { dir, item } = await created;
  const run = cli(dir, ["item", "get", "Bank"]);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /password:\s+\[use --reveal\]/);
  assert.equal(run.stdout.includes(item.fields.find((f) => f.id === "password").value), false);
});

test("read op://Personal/<title>/password gives the created password", async () => {
  const { dir, item } = await created;
  const run = cli(dir, ["read", "op://Personal/Bank/password"]);
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, `${item.fields.find((f) => f.id === "password").value}\n`);
});

test("read ?attribute=otp gives the current OTP code", async () => {
  const { dir } = await created;
  const run = cli(dir, ["read", "-n", "op://Personal/Bank/password?attribute=otp"]);
  assert.equal(run.code, 0, run.stderr);
  assertOtp(run.stdout);
});

test("inject replaces two references in one line", async () => {
  const { dir } = await vaultDir();
  const run = cli(dir, ["inject"], { input: "a={{ op://Personal/GitHub/username }} b={{kapevault://Personal/GitHub/password}}\n" });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, "a=me b=s3cret-pass!\n");
});

test("read -o refuses an existing file unless --force replaces it with the requested mode", async () => {
  const { dir } = await vaultDir();
  const file = path.join(dir, "secret.txt");
  fs.writeFileSync(file, "old contents\n", { mode: 0o600 });
  const refused = cli(dir, ["read", "op://Personal/GitHub/password", "-o", file]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /already exists\. Pass --force to replace it\./);
  assert.equal(fs.readFileSync(file, "utf8"), "old contents\n");
  const run = cli(dir, ["read", "op://Personal/GitHub/password", "-o", file, "-f", "--file-mode", "0640"]);
  assert.equal(run.code, 0, run.stderr);
  assert.equal(fs.readFileSync(file, "utf8"), "s3cret-pass!\n");
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
});

test("run masks a resolved secret in the command's output", async () => {
  const { dir } = await vaultDir();
  const run = cli(dir, ["run", "--", process.execPath, "-e", "console.log(process.env.X, process.env.KAPEVAULT_MASTER)"], { env: { X: "op://Personal/GitHub/password" } });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, "<concealed by KAPEVault> undefined\n");
});

test("run --password-stdin consumes the master line without secret references", async () => {
  const { dir } = await vaultDir();
  const input = path.join(dir, "stdin");
  fs.writeFileSync(input, "SYNTHETIC_MASTER\nchild input\n");
  const fd = fs.openSync(input, "r");
  try {
    const run = cli(dir, ["run", "--password-stdin", "--", "cat"], { stdio: [fd, "pipe", "pipe"] });
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.stdout, "child input\n");
  } finally {
    fs.closeSync(fd);
  }
});

test("run --password-stdin unlocks references and leaves the child's input", async () => {
  const { dir } = await vaultDir();
  const input = path.join(dir, "stdin");
  fs.writeFileSync(input, `${MASTER}\nchild input\n`);
  const fd = fs.openSync(input, "r");
  try {
    const run = cli(dir, ["run", "--password-stdin", "--", "cat"], {
      stdio: [fd, "pipe", "pipe"],
      env: { KAPEVAULT_MASTER: "wrong master", X: "op://Personal/GitHub/password" },
    });
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.stdout, "child input\n");
  } finally {
    fs.closeSync(fd);
  }
});

test("run --no-masking passes the secret through", async () => {
  const { dir } = await vaultDir();
  const run = cli(dir, ["run", "--no-masking", "--", process.execPath, "-e", "console.log(process.env.X)"], { env: { X: "op://Personal/GitHub/password" } });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, "s3cret-pass!\n");
});

test("run shows a prompt before the child waits for a line from stdin", async (t) => {
  const { dir } = await vaultDir();
  const script = "process.stdout.write('Password: '); const rl = require('node:readline').createInterface({ input: process.stdin }); rl.once('line', (line) => { rl.close(); process.stdin.pause(); setTimeout(() => process.stdout.write(line + '\\n'), 300); });";
  const child = spawn(process.execPath, ["cli/kapevault.cjs", "run", "--", process.execPath, "-e", script], {
    cwd: ROOT,
    stdio: "pipe",
    env: { ...process.env, KAPEVAULT_DATA_DIR: dir, KAPEVAULT_MASTER: MASTER, X: "op://Personal/GitHub/password" },
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), 15_000);
  t.after(() => {
    clearTimeout(timer);
    child.kill("SIGTERM");
  });
  let stdout = "";
  let stderr = "";
  let fed = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (!fed && stdout === "Password: ") {
      fed = true;
      child.stdin.end("child input\n");
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  assert.equal(code, 0, stderr);
  assert.equal(fed, true, "the parent saw the prompt before it sent the child's input");
  assert.equal(stdout, "Password: child input\n");
});

test("run masks a secret split across writes with a 50 ms gap", async () => {
  const { dir } = await vaultDir();
  const script = "process.stdout.write(process.env.X.slice(0, 4)); setTimeout(() => process.stdout.write(process.env.X.slice(4) + '\\n'), 50);";
  const run = cli(dir, ["run", "--", process.execPath, "-e", script], { env: { X: "op://Personal/GitHub/password" } });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, "<concealed by KAPEVault>\n");
});

test("run masks a secret on stderr", async () => {
  const { dir } = await vaultDir();
  const run = cli(dir, ["run", "--", process.execPath, "-e", "console.error(process.env.X)"], { env: { X: "op://Personal/GitHub/password" } });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, "");
  assert.equal(run.stderr, "<concealed by KAPEVault>\n");
});

test("item edit changes the username and keeps the password", async () => {
  const { dir } = await vaultDir();
  assert.equal(cli(dir, ["item", "edit", "GitHub", "username=new-me"]).code, 0);
  const fields = json(cli(dir, ["item", "get", "GitHub", "--format", "json"])).fields;
  assert.equal(fields.find((f) => f.id === "username").value, "new-me");
  assert.equal(fields.find((f) => f.id === "password").value, "s3cret-pass!");
});

test("an ambiguous title exits 1 and names both items", async () => {
  const { dir, vault, spaceId, id } = await vaultDir();
  const other = vault.saveEntry({ kind: "login", spaceId, title: "github", username: "two" }).id;
  const run = cli(dir, ["item", "get", "GitHub"]);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /More than one item matches "GitHub"/);
  assert.ok(run.stderr.includes(id) && run.stderr.includes(other), run.stderr);
});

test("a wrong master password exits 1 without echoing it", async () => {
  const { dir } = await vaultDir();
  const run = cli(dir, ["item", "list"], { env: { KAPEVAULT_MASTER: "wrong guess kettle" } });
  assert.equal(run.code, 1);
  assert.match(run.stderr, /^\[ERROR\] \S+ Wrong master password\.\n$/);
  assert.equal(run.stdout, "");
});

test("while app.pid names a live app, writes are refused and reads still work", async () => {
  const { dir } = await vaultDir();
  fs.writeFileSync(path.join(dir, "app.pid"), String(process.pid));
  const write = cli(dir, ["item", "create", "--category", "note", "--title", "Plan", "body=x"]);
  assert.equal(write.code, 1);
  assert.match(write.stderr, /KAPEVault is open\. Quit it first, then run this command again\./);
  const read = cli(dir, ["read", "op://Personal/GitHub/username"]);
  assert.equal(read.code, 0, read.stderr);
  assert.equal(read.stdout, "me\n");
});

test("an unreadable app.pid stops a write", async () => {
  const { dir } = await vaultDir();
  fs.mkdirSync(path.join(dir, "app.pid"));
  const before = fs.readFileSync(path.join(dir, "vault.kapevault"));
  const run = cli(dir, ["item", "edit", "GitHub", "username=changed"]);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /EISDIR/);
  assert.deepEqual(fs.readFileSync(path.join(dir, "vault.kapevault")), before);
});

test("all six vault writes refuse a live app.pid", async () => {
  const commands = [
    ["vault", "create", "Team"],
    ["vault", "edit", "Personal", "--name", "Renamed"],
    ["item", "create", "--category", "note", "--title", "Plan", "body=x"],
    ["item", "edit", "GitHub", "username=changed"],
    ["item", "delete", "GitHub"],
    ["item", "move", "GitHub", "--destination-vault", "Team"],
  ];
  for (const args of commands) {
    const { dir, vault } = await vaultDir();
    vault.addSpace("Team");
    const before = fs.readFileSync(path.join(dir, "vault.kapevault"));
    const pidFile = path.join(dir, "app.pid");
    fs.writeFileSync(pidFile, String(process.pid));
    const run = cli(dir, args);
    assert.equal(run.code, 1, args.join(" "));
    assert.ok(run.stderr.includes(`KAPEVault is open. Quit it first, then run this command again. If it is not running, delete ${pidFile}.`), run.stderr);
    assert.deepEqual(fs.readFileSync(path.join(dir, "vault.kapevault")), before);
  }
});

test("item delete moves the item out of item list", async () => {
  const { dir } = await vaultDir();
  const run = cli(dir, ["item", "delete", "GitHub"]);
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, "");
  assert.deepEqual(json(cli(dir, ["item", "list", "--format", "json"])), []);
});

test("item list leaves expired Trash on disk while app.pid names a live app", async () => {
  const { dir } = await vaultDir();
  const file = path.join(dir, "vault.kapevault");
  const opened = await openFile(MASTER, JSON.parse(fs.readFileSync(file, "utf8")));
  opened.data.entries[0].trashedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  delete opened.data.sync;
  fs.writeFileSync(file, JSON.stringify(encryptWithKey(opened.key, opened.kdf, opened.salt, opened.data)));
  opened.key.fill(0);
  fs.writeFileSync(path.join(dir, "app.pid"), String(process.pid));
  const before = fs.readFileSync(file);
  assert.deepEqual(json(cli(dir, ["item", "list", "--format", "json"])), []);
  assert.deepEqual(fs.readFileSync(file), before);
});
