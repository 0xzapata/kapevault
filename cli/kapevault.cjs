#!/usr/bin/env node
// KAPEVault on the command line, shaped like 1Password's `op` so scripts and .env files written for `op`
// work unchanged: `op://vault/item/field` references, `read`, `inject`, `run`, `item` and `vault`.
// It drives the app's own headless session (electron/vault-session.cjs) on the same vault file, behind
// the same unlock throttle and install id, so a CLI edit syncs like an app edit and a guess here counts
// like a guess in the app. The desktop app keeps the vault in memory and rewrites the whole file on its
// next save, so every command that writes refuses while app.pid names a live app.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");
const { Writable } = require("node:stream");
const { isatty } = require("node:tty");
const { spawn } = require("node:child_process");
const { parseArgs, parseEnv } = require("node:util");
const { createVaultSession } = require("../electron/vault-session.cjs");
const { createUnlockThrottle } = require("../electron/unlock-throttle.cjs");
const { readInstallId } = require("../electron/app-settings.cjs");
const { writeFileAtomic } = require("../electron/atomic-write.cjs");

const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version;
const MASK = "<concealed by KAPEVault>";
const REF = /^(?:op|kapevault):\/\/([^?]+)(?:\?(.*))?$/;
const INJECT = /\{\{\s*((?:op|kapevault):\/\/[^}]*?)\s*\}\}/g;
const USAGE = `Usage: kapevault <command> [flags]

  vault list | vault get <vault> | vault create <name> | vault edit <vault> --name <new>
  item list [--vault v] [--categories a,b] [--tags a,b] [--favorite]
  item get <item> [--vault v] [--fields a,b] [--otp] [--reveal]
  item create [-] [<field>=<value>...] --category c --title t [--vault v] [--url u] [--tags a,b]
              [--favorite] [--generate-password[=letters,digits,symbols,32]] [--dry-run]
  item edit <item> [<field>=<value>...] [--title t] [--url u] [--tags a,b] [--favorite] [--vault v]
  item delete <item> [--vault v]
  item move <item> --current-vault v --destination-vault w
  item template list | item template get <category>
  read <op://vault/item/field> [-n] [-o file] [--file-mode 0600] [-f]
  inject [-i file] [-o file] [--file-mode 0600] [-f]
  run [--env-file file]... [--no-masking] -- <command> [args...]

Flags on every command: --format human|json, --data-dir <dir>, --password-stdin, --version, -h
The master password comes from --password-stdin, else KAPEVAULT_MASTER, else a prompt.`;

// op's category names; the kind names are accepted too (norm ignores case, spaces, dashes, underscores).
const CATEGORIES = { login: "Login", note: "Secure Note", key: "API Credential", link: "Link", thing: "Thing", device: "Device", id: "Identity" };
const norm = (s) => String(s).toLowerCase().replace(/[\s_-]/g, "");
const list = (s) => String(s).split(",").map((x) => x.trim()).filter(Boolean);
const categoryJson = (kind) => CATEGORIES[kind].toUpperCase().replaceAll(" ", "_");

function kindOf(name) {
  const kind = Object.keys(CATEGORIES).find((k) => norm(name) === k || norm(name) === norm(CATEGORIES[k]));
  if (!kind) throw new Error(`"${name}" is not a category. Run: kapevault item template list`);
  return kind;
}

/**
 * The names a user types for one field of a kind, and the stored prop they address. names[0] is the label printed.
 * @typedef {{ names: string[], prop: string, type?: string, purpose?: string, parse?: (value: string) => any, secret?: boolean }} Field
 * @typedef {ReturnType<typeof createVaultSession>} Vault
 */
/** @param {string[]} names @param {Partial<Field>} [options] @returns {Field} */
const text = (names, { prop = names[0], type, purpose, parse } = {}) => ({ names, prop, type, purpose, parse });
/** @param {string[]} names @param {Partial<Field>} [opts] @returns {Field} */
const secret = (names, opts) => ({ ...text(names, { ...opts, type: "CONCEALED" }), secret: true });
const NOTES = text(["notes", "notesPlain"], { purpose: "NOTES" });
// core/public-view.js secretOf is the source of truth for which props are secrets.
/** @type {Record<string, Field[]>} */
const FIELDS = {
  login: [
    text(["username"], { purpose: "USERNAME" }),
    secret(["password"], { purpose: "PASSWORD" }),
    text(["url", "website"], { type: "URL" }),
    text(["one-time password", "otp", "totp"], { prop: "totp", type: "OTP" }),
    NOTES,
  ],
  note: [secret(["notesPlain", "body"], { prop: "body" }), NOTES],
  key: [secret(["credential", "secret"], { prop: "secret" }), text(["keyId"]), text(["url"], { type: "URL" }), text(["expires"]), NOTES],
  link: [text(["location"]), text(["linkType"]), NOTES],
  thing: [text(["room"]), text(["spot"]), text(["grab"], { parse: Number }), text(["expires"]), NOTES],
  device: [
    ...["type", "model", "serial", "imei", "mac"].map((name) => text([name])),
    text(["adminUrl"], { type: "URL" }),
    text(["adminUser"]),
    secret(["adminPassword"]),
    text(["ssid"]),
    secret(["wifiPassword"]),
    NOTES,
  ],
  id: [text(["idType"]), secret(["idNumber"]), NOTES],
};
// Readable and settable by name, but printed in the item's header rather than as fields.
const HEADER = [text(["title"]), text(["tags"], { parse: list })];

/** @param {Vault} vault @param {Record<string, any>} e @param {Field} f */
function readField(vault, e, f) {
  if (f.secret) return vault.getSecret(e.id, f.prop);
  if (f.prop === "totp") return e.hasTotp ? vault.getTotpCode(e.id).code : "";
  const value = e[f.prop];
  return Array.isArray(value) ? value.join(",") : String(value ?? "");
}

/** @param {Record<string, any>} input @param {Field} f @param {string} v */
function writeField(input, f, v) {
  input[f.prop] = f.parse ? f.parse(v) : v;
}

function fieldOf(kind, name) {
  const field = [...FIELDS[kind], ...HEADER].find((f) => f.names.some((n) => norm(n) === norm(name)));
  if (!field) throw new Error(`"${name}" isn't a field of a ${CATEGORIES[kind]} item.`);
  return field;
}

/** @param {Field} f @param {string} value */
const fieldJson = (f, value) => ({ id: f.names[0], label: f.names[0], value, type: f.type ?? "STRING", ...(f.purpose && { purpose: f.purpose }) });
const row = (vault, e, f) => fieldJson(f, readField(vault, e, f));
const shown = (r, reveal) => (r.type === "CONCEALED" && !reveal ? "[use --reveal]" : r.value);

// `section.field[type]=value`, as op takes it: the section and the type are dropped. The text is never
// echoed in an error, as it holds a secret.
function assignment(arg) {
  const eq = arg.indexOf("=");
  if (eq < 1) throw new Error("Expected <field>=<value> after the item.");
  const name = arg.slice(0, eq).replace(/\[[^\]]*\]$/, "");
  return [name.slice(name.indexOf(".") + 1), arg.slice(eq + 1)];
}

const SETS = { letters: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", digits: "0123456789", symbols: "!@.-_*" };

// Recipe: letters,digits,symbols,<length> in any order. No set named: all three. Every set named appears.
function generatePassword(recipe) {
  const parts = list(recipe.toLowerCase());
  const bad = parts.find((p) => !Object.hasOwn(SETS, p) && !/^\d+$/.test(p));
  if (bad) throw new Error(`"${bad}" is not part of a password recipe: use letters, digits, symbols and a length.`);
  const sets = parts.filter((p) => Object.hasOwn(SETS, p)).map((p) => SETS[p]);
  if (!sets.length) sets.push(...Object.values(SETS));
  const length = Number(parts.find((p) => /^\d+$/.test(p)) ?? 32);
  if (length < sets.length || length > 64) throw new Error(`The password length must be ${sets.length} to 64.`);
  const pool = sets.join("");
  for (;;) {
    const password = Array.from({ length }, () => pool[crypto.randomInt(pool.length)]).join("");
    if (sets.every((set) => [...password].some((c) => set.includes(c)))) return password;
  }
}

function dataDir(flag) {
  if (flag) return flag;
  if (process.env.KAPEVAULT_DATA_DIR) return process.env.KAPEVAULT_DATA_DIR;
  // Electron's userData folder for the product name KAPEVault.
  const appData =
    process.platform === "win32"
      ? (process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"))
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support")
        : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(appData, "KAPEVault");
}

const readText = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
};

// electron/main.cjs writes app.pid while the app runs. A pid that names no process is a crash's leftover.
// ponytail: app.pid is advisory: two CLI writers can still race. Upgrade to one lock file held by the
// app and the CLI through the write in electron/vault-session.cjs.
function refuseWhileAppOpen(dir) {
  const file = path.join(dir, "app.pid");
  const content = readText(file);
  if (content === null) return;
  const pid = Number(content.trim());
  try {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw Object.assign(new Error("not a pid"), { code: "ESRCH" });
    process.kill(pid, 0);
  } catch (e) {
    if (e.code === "ESRCH") return fs.rmSync(file, { force: true });
    // EPERM: the process is alive under another user
  }
  throw new Error(`KAPEVault is open. Quit it first, then run this command again. If it is not running, delete ${file}.`);
}

// One line, read a byte at a time so the rest of stdin (a template) stays for the command.
function readLine() {
  const byte = Buffer.alloc(1);
  const bytes = [];
  while (fs.readSync(0, byte) === 1 && byte[0] !== 10) bytes.push(byte[0]);
  return Buffer.from(bytes).toString("utf8").replace(/\r$/, "");
}

// Echo off: readline writes what is typed to a muted output.
function prompt() {
  process.stderr.write("Master password: ");
  const rl = readline.createInterface({ input: process.stdin, output: new Writable({ write: (_chunk, _enc, done) => done() }), terminal: true });
  rl.on("SIGINT", () => {
    process.stderr.write("\n");
    process.exit(1);
  });
  return new Promise((resolve) => {
    rl.question("", (answer) => {
      rl.close();
      process.stderr.write("\n");
      resolve(answer);
    });
  });
}

/** @param {string} [alreadyReadMaster] */
async function masterPassword(g, alreadyReadMaster) {
  if (alreadyReadMaster !== undefined) return alreadyReadMaster;
  if (g["password-stdin"]) return readLine();
  if (process.env.KAPEVAULT_MASTER) return process.env.KAPEVAULT_MASTER;
  if (isatty(0)) return prompt();
  throw new Error("Master password required: set KAPEVAULT_MASTER or pass --password-stdin.");
}

// ponytail: no signin daemon, so every command pays one scrypt unlock (about 100 to 300 ms). Add a
// session cache like `op signin` when scripts call this in tight loops.
/** @param {string} [alreadyReadMaster] */
async function open(g, alreadyReadMaster) {
  const dir = dataDir(g["data-dir"]);
  const file = path.join(dir, "vault.kapevault");
  if (!fs.existsSync(file)) throw new Error(`There is no vault at ${file}. Create one in the KAPEVault app, or pass --data-dir.`);
  const master = await masterPassword(g, alreadyReadMaster);
  if (!master) throw new Error("Master password required: set KAPEVAULT_MASTER or pass --password-stdin.");
  const vault = createVaultSession(file, { installId: () => readInstallId(dir), beforeWrite: () => refuseWhileAppOpen(dir) });
  // The app's own throttle file and target (electron/main.cjs), so the app and the CLI share one miss count.
  const throttleFile = path.join(dir, "unlock-throttle.json");
  const throttledUnlock = createUnlockThrottle({
    file: throttleFile,
    onWait: (ms) => process.stderr.write(`Too many wrong passwords, waiting ${Math.ceil(ms / 1000)}s\n`),
    vaultFile: file,
  });
  const result = await throttledUnlock(() => vault.unlock(master));
  if (!result.ok) throw new Error(result.error);
  return { vault, view: result.vault };
}

// An exact id, else one case-insensitive name. noun: "item" or "vault".
function pick(items, name, nameOf, noun, missing, line) {
  const byId = items.find((x) => x.id === name);
  if (byId) return byId;
  const matches = items.filter((x) => nameOf(x).toLowerCase() === name.toLowerCase());
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new Error(`"${name}" ${missing}.`);
  throw new Error([`More than one ${noun} matches "${name}". Use the ID:`, ...matches.map(line)].join("\n"));
}

const spaceOf = (view, id) => view.spaces.find((s) => s.id === id);
const findSpace = (view, name) => pick(view.spaces, name, (s) => s.name, "vault", "isn't a vault", (s) => `${s.id}  ${s.name}`);

function findItem(view, name, vaultName) {
  const spaceId = vaultName === undefined ? null : findSpace(view, vaultName).id;
  const entries = view.entries.filter((e) => !spaceId || e.spaceId === spaceId);
  return pick(entries, name, (e) => e.title, "item", "isn't an item in any vault", (e) => `${e.id}  ${spaceOf(view, e.spaceId)?.name}  ${e.title}`);
}

// op://vault/item/field, op://vault/item/section/field (no sections here: ignored), ?attribute=otp.
function resolve(vault, view, ref) {
  const m = REF.exec(ref);
  const parts = m ? m[1].split("/") : [];
  if (!m || parts.length < 3 || parts.length > 4 || (m[2] && !/^attribute=t?otp$/i.test(m[2]))) throw new Error(`"${ref}" is not a secret reference: use op://<vault>/<item>/<field>.`);
  const e = findItem(view, parts[1], parts[0]);
  if (m[2]) return vault.getTotpCode(e.id).code;
  return readField(vault, e, fieldOf(e.kind, parts[parts.length - 1]));
}

const print = (out) => process.stdout.write(`${out}\n`);
const show = (g, json, human) => print(g.format === "json" ? JSON.stringify(json, null, 2) : human());
const need = (value, usage) => {
  if (!value) throw new Error(`Usage: kapevault ${usage}`);
  return value;
};

function table(header, rows) {
  const all = [header, ...rows].map((r) => r.map(String));
  const widths = header.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  return all.map((r) => r.map((c, i) => c.padEnd(widths[i])).join("    ").trimEnd()).join("\n");
}

const pairs = (rows) => {
  const width = Math.max(...rows.map(([k]) => k.length)) + 2;
  return rows.map(([k, v]) => `${`${k}:`.padEnd(width)}${v}`.trimEnd()).join("\n");
};

const spaceJson = (view, s) => ({ id: s.id, name: s.name, kind: s.kind, items: view.entries.filter((e) => e.spaceId === s.id).length });
const spaceTable = (spaces) => table(["ID", "NAME", "KIND", "ITEMS"], spaces.map((s) => [s.id, s.name, s.kind, s.items]));
const itemJson = (view, e) => ({ id: e.id, title: e.title, category: categoryJson(e.kind), vault: { id: e.spaceId, name: spaceOf(view, e.spaceId)?.name }, tags: e.tags, favorite: e.favorite, updated_at: e.updatedAt });

// JSON reveals concealed values, as op does; the human view hides them unless --reveal.
function showItem(g, vault, view, id) {
  const e = view.entries.find((x) => x.id === id);
  const fields = FIELDS[e.kind].map((f) => row(vault, e, f)).filter((r) => r.value);
  if (g.format === "json") return print(JSON.stringify({ ...itemJson(view, e), fields }, null, 2));
  const head = [["ID", e.id], ["Title", e.title], ["Vault", spaceOf(view, e.spaceId)?.name], ["Category", CATEGORIES[e.kind]], ["Tags", e.tags.join(", ")]];
  print(pairs([...head, ...fields.map((r) => [r.label, shown(r, g.reveal)])]));
}

// A template from stdin: op's `item get` JSON ({ category, fields: [{ label, value }] }).
// item get's OTP value is the current code (the key never leaves the vault), so a copied item comes
// without 2FA rather than failing on it.
// JSON.parse's own error quotes the text, which holds secrets.
function parseTemplate(json) {
  try {
    return JSON.parse(json);
  } catch {
    throw new Error("The template on stdin is not valid JSON.");
  }
}

function templateFields(t) {
  if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error("The template must be a JSON object.");
  const entries = Array.isArray(t.fields)
    ? t.fields.filter((f) => !(f?.type === "OTP" && /^\d{6,8}$/.test(f.value))).map((f) => [f?.label ?? f?.id, f?.value])
    : [];
  return entries.map(([k, v]) => [String(k), String(v ?? "")]).filter(([, v]) => v);
}

function apply(input, g, assignments) {
  for (const name of ["title", "tags", "url"]) {
    if (g[name] !== undefined) writeField(input, fieldOf(input.kind, name), g[name]);
  }
  if (g.favorite) input.favorite = true;
  if (g["generate-password"] !== undefined) writeField(input, fieldOf(input.kind, "password"), generatePassword(g["generate-password"]));
  for (const [name, value] of assignments.map(assignment)) writeField(input, fieldOf(input.kind, name), value);
  return input;
}

// --out-file: a new file with the mode; an existing one only with --force.
function output(g, content) {
  const file = g["out-file"];
  if (!file) return process.stdout.write(content);
  if (!/^0?[0-7]{3}$/.test(g["file-mode"])) throw new Error("--file-mode must be an octal mode like 0600.");
  const mode = Number.parseInt(g["file-mode"], 8);
  try {
    if (g.force) writeFileAtomic(file, content, { mode });
    else fs.writeFileSync(file, content, { mode, flag: "wx" });
  } catch (e) {
    if (e.code === "EEXIST") throw new Error(`${file} already exists. Pass --force to replace it.`);
    throw e;
  }
  print(file);
}

// Copies a child's output with every secret replaced by MASK. Only a suffix that starts a secret waits
// for the next chunk (or the end), so ordinary prompts reach the terminal at once.
function maskInto(from, to, secrets) {
  const sorted = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length);
  const any = new RegExp(sorted.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  let held = "";
  const pass = (final) => {
    let keep = 0;
    if (!final) {
      for (const s of sorted) {
        for (let k = Math.min(s.length - 1, held.length); k > keep; k--) {
          if (held.endsWith(s.slice(0, k))) {
            keep = k;
            break;
          }
        }
      }
    }
    const limit = held.length - keep;
    let out = "";
    let at = 0;
    for (const m of held.matchAll(any)) {
      if (m.index >= limit) break;
      out += `${held.slice(at, m.index)}${MASK}`;
      at = m.index + m[0].length;
    }
    const cut = Math.max(at, limit);
    to.write(out + held.slice(at, cut));
    held = held.slice(cut);
  };
  from.setEncoding("utf8");
  from.on("data", (chunk) => {
    held += chunk;
    pass(false);
  });
  from.on("end", () => pass(true));
}

const quoteCommand = (argv) => argv.map((arg) => (arg === "" || /[ \t&()[\]{}^=;!'+,`~<>|"]/.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg)).join(" ");

// Node's CVE-2024-27980 fix rejects direct .cmd/.bat spawns, so only those files need cmd.exe.
/** @param {string[]} argv @param {import("node:child_process").SpawnOptions} options */
function spawnCommand(argv, options) {
  if (process.platform !== "win32") return spawn(argv[0], argv.slice(1), options);
  const env = options.env ?? process.env;
  const keys = Object.keys(env).sort();
  const envValue = (name) => env[keys.find((key) => key.toUpperCase() === name) ?? name];
  const dirs = path.isAbsolute(argv[0]) || /[/\\]/.test(argv[0]) ? [""] : (envValue("PATH") ?? process.env.PATH ?? "").split(path.delimiter);
  const extensions = ["", ...(envValue("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)];
  const command = dirs.flatMap((dir) => extensions.map((ext) => path.resolve(dir.replace(/^"|"$/g, ""), argv[0] + ext))).find((file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  }) ?? argv[0];
  if (/\.(cmd|bat)$/i.test(command)) {
    const quoted = `"${quoteCommand([command, ...argv.slice(1)])}"`;
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", quoted], { ...options, windowsVerbatimArguments: true });
  }
  return spawn(command, argv.slice(1), options);
}

/** @type {import("node:util").ParseArgsOptionsConfig} */
const GLOBAL = {
  format: { type: "string", default: "human" },
  "data-dir": { type: "string" },
  "password-stdin": { type: "boolean" },
  // Accepted for op script compatibility.
  "no-color": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
};
/** @type {import("node:util").ParseArgsOptionsConfig} */
const VAULT = { vault: { type: "string" } };
/** @type {import("node:util").ParseArgsOptionsConfig} */
const EDIT = { ...VAULT, title: { type: "string" }, url: { type: "string" }, tags: { type: "string" }, favorite: { type: "boolean" }, "generate-password": { type: "string" } };
/** @type {import("node:util").ParseArgsOptionsConfig} */
const OUT = { "out-file": { type: "string", short: "o" }, "file-mode": { type: "string", default: "0600" }, force: { type: "boolean", short: "f" } };

/** @type {Record<string, { options?: import("node:util").ParseArgsOptionsConfig, run: (g: Record<string, any>, args: string[]) => Promise<unknown> }>} */
const COMMANDS = {
  "vault list": {
    run: async (g) => {
      const { view } = await open(g);
      const spaces = view.spaces.map((s) => spaceJson(view, s));
      show(g, spaces, () => spaceTable(spaces));
    },
  },
  "vault get": {
    run: async (g, [name]) => {
      need(name, "vault get <vault>");
      const { view } = await open(g);
      const space = spaceJson(view, findSpace(view, name));
      show(g, space, () => spaceTable([space]));
    },
  },
  "vault create": {
    run: async (g, [name]) => {
      need(name, "vault create <name>");
      const { vault } = await open(g);
      const { vault: view, id } = vault.addSpace(name);
      const space = spaceJson(view, spaceOf(view, id));
      show(g, space, () => spaceTable([space]));
    },
  },
  "vault edit": {
    options: { name: { type: "string" } },
    run: async (g, [name]) => {
      need(name && g.name, "vault edit <vault> --name <new name>");
      const { vault, view } = await open(g);
      const { id } = findSpace(view, name);
      const after = vault.renameSpace(id, g.name);
      const space = spaceJson(after, spaceOf(after, id));
      show(g, space, () => spaceTable([space]));
    },
  },
  "item list": {
    options: { ...VAULT, categories: { type: "string" }, tags: { type: "string" }, favorite: { type: "boolean" } },
    run: async (g) => {
      const kinds = g.categories === undefined ? null : list(g.categories).map(kindOf);
      const tags = g.tags === undefined ? null : list(g.tags.toLowerCase());
      const { view } = await open(g);
      const spaceId = g.vault === undefined ? null : findSpace(view, g.vault).id;
      const items = view.entries
        .filter((e) => (!spaceId || e.spaceId === spaceId) && (!kinds || kinds.includes(e.kind)) && (!tags || e.tags.some((t) => tags.includes(t.toLowerCase()))) && (!g.favorite || e.favorite))
        .sort((a, b) => a.title.localeCompare(b.title));
      show(g, items.map((e) => itemJson(view, e)), () => table(["ID", "TITLE", "VAULT", "CATEGORY", "EDITED"], items.map((e) => [e.id, e.title, spaceOf(view, e.spaceId)?.name, CATEGORIES[e.kind], e.updatedAt])));
    },
  },
  "item get": {
    options: { ...VAULT, fields: { type: "string" }, otp: { type: "boolean" }, reveal: { type: "boolean" } },
    run: async (g, [name]) => {
      need(name, "item get <item>");
      const { vault, view } = await open(g);
      const e = findItem(view, name, g.vault);
      if (g.otp) return print(vault.getTotpCode(e.id).code);
      if (g.fields === undefined) return showItem(g, vault, view, e.id);
      const rows = list(g.fields).map((f) => row(vault, e, fieldOf(e.kind, f.replace(/^label=/i, ""))));
      show(g, rows, () => rows.map((r) => shown(r, g.reveal)).join("\n"));
    },
  },
  "item create": {
    options: { ...EDIT, category: { type: "string" }, "dry-run": { type: "boolean" } },
    run: async (g, args) => {
      const fromStdin = args[0] === "-";
      const { vault, view } = await open(g);
      const t = fromStdin ? parseTemplate(fs.readFileSync(0, "utf8")) : {};
      const fields = templateFields(t);
      const kind = kindOf(need(g.category ?? t.category, "item create --category <category> --title <title>"));
      const vaultName = g.vault ?? t.vault?.id ?? t.vault?.name;
      const space = vaultName === undefined ? view.spaces.find((s) => s.kind === "personal") : findSpace(view, vaultName);
      if (!space) throw new Error("There is no personal vault. Pass --vault.");
      /** @type {Record<string, any>} */
      const input = { kind, spaceId: space.id, title: String(t.title ?? ""), tags: Array.isArray(t.tags) ? t.tags.map(String) : [], favorite: t.favorite === true };
      for (const [name, value] of fields) writeField(input, fieldOf(kind, name), value);
      apply(input, g, fromStdin ? args.slice(1) : args);
      if (g["dry-run"]) {
        const fields = FIELDS[kind].map((f) => fieldJson(f, String(input[f.prop] ?? ""))).filter((r) => r.value);
        return print(JSON.stringify({ ...itemJson(view, input), fields }, null, 2));
      }
      const saved = vault.saveEntry(input);
      showItem(g, vault, saved.vault, saved.id);
    },
  },
  "item edit": {
    options: EDIT,
    run: async (g, [name, ...assignments]) => {
      need(name, "item edit <item> [<field>=<value>...]");
      const { vault, view } = await open(g);
      const e = findItem(view, name, g.vault);
      const after = vault.patchEntry(e.id, apply({ kind: e.kind }, g, assignments));
      showItem(g, vault, after, e.id);
    },
  },
  "item delete": {
    // --archive is accepted for op script compatibility.
    options: { ...VAULT, archive: { type: "boolean" } },
    run: async (g, [name]) => {
      need(name, "item delete <item>");
      const { vault, view } = await open(g);
      vault.deleteEntry(findItem(view, name, g.vault).id);
    },
  },
  "item move": {
    options: { "current-vault": { type: "string" }, "destination-vault": { type: "string" } },
    run: async (g, [name]) => {
      need(name && g["destination-vault"], "item move <item> --current-vault <vault> --destination-vault <vault>");
      const { vault, view } = await open(g);
      vault.moveEntry(findItem(view, name, g["current-vault"]).id, findSpace(view, g["destination-vault"]).id);
    },
  },
  "item template list": {
    run: async (g) => {
      const names = Object.values(CATEGORIES);
      show(g, names, () => names.join("\n"));
    },
  },
  "item template get": {
    run: async (_g, [category]) => {
      const kind = kindOf(need(category, "item template get <category>"));
      const fields = FIELDS[kind].map((f) => fieldJson(f, ""));
      print(JSON.stringify({ title: "", category: categoryJson(kind), fields }, null, 2));
    },
  },
  read: {
    options: { "no-newline": { type: "boolean", short: "n" }, ...OUT },
    run: async (g, [ref]) => {
      need(ref, "read <op://vault/item/field>");
      const { vault, view } = await open(g);
      const value = resolve(vault, view, ref);
      output(g, g["no-newline"] ? value : `${value}\n`);
    },
  },
  inject: {
    options: { "in-file": { type: "string", short: "i" }, ...OUT },
    run: async (g) => {
      const { vault, view } = await open(g);
      const template = fs.readFileSync(g["in-file"] ?? 0, "utf8");
      output(g, template.replace(INJECT, (_match, ref) => resolve(vault, view, ref)));
    },
  },
  run: {
    options: { "env-file": { type: "string", multiple: true }, "no-masking": { type: "boolean" } },
    run: async (g, command) => {
      const master = g["password-stdin"] ? readLine() : undefined;
      need(command[0], "run [--env-file <file>]... -- <command> [args...]");
      // Later env files win, and every env file wins over the shell. The master password never reaches the child.
      const { KAPEVAULT_MASTER: _master, ...env } = Object.assign({ ...process.env }, ...(g["env-file"] ?? []).map((file) => parseEnv(fs.readFileSync(file, "utf8"))));
      const refs = Object.keys(env).filter((k) => REF.test(env[k] ?? ""));
      const secrets = [];
      if (refs.length) {
        const { vault, view } = await open(g, master);
        for (const k of refs) {
          env[k] = resolve(vault, view, env[k]);
          secrets.push(env[k]);
        }
        vault.lock();
      }
      const masking = !g["no-masking"] && secrets.some(Boolean);
      const child = spawnCommand(command, { env, stdio: masking ? ["inherit", "pipe", "pipe"] : "inherit" });
      if (masking) {
        maskInto(child.stdout, process.stdout, secrets);
        maskInto(child.stderr, process.stderr, secrets);
      }
      // Ctrl+C reaches the child from the terminal; this process stays to pass on its last output.
      process.on("SIGINT", () => {});
      process.on("SIGTERM", () => child.kill("SIGTERM"));
      /** @type {number | null} */
      const code = await new Promise((resolveExit, reject) => {
        child.on("error", reject);
        child.on("close", resolveExit);
      });
      process.exitCode = code ?? 1;
    },
  },
};

async function main(argv) {
  const end = argv.indexOf("--");
  // A bare --generate-password takes the default recipe instead of the next word.
  const head = (end < 0 ? argv : argv.slice(0, end)).map((a) => (a === "--generate-password" ? "--generate-password=" : a));
  const rest = end < 0 ? [] : argv.slice(end + 1);
  const n = [3, 2, 1].find((k) => head.length >= k && Object.hasOwn(COMMANDS, head.slice(0, k).join(" ")));
  if (!n) {
    const loose = parseArgs({ args: head, options: GLOBAL, strict: false, allowPositionals: true });
    if (loose.values.version) return print(VERSION);
    if (loose.values.help) return print(USAGE);
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 1;
    return;
  }
  const command = COMMANDS[head.slice(0, n).join(" ")];
  const { values, positionals } = parseArgs({ args: head.slice(n), options: { ...GLOBAL, ...command.options }, allowPositionals: true });
  if (values.help) return print(USAGE);
  if (values.version) return print(VERSION);
  if (values.format !== "human" && values.format !== "json") throw new Error("--format must be human or json.");
  await command.run(values, [...positionals, ...rest]);
}

module.exports = { maskInto, quoteCommand };

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    process.stderr.write(`[ERROR] ${new Date().toISOString()} ${e?.message ?? e}\n`);
    process.exitCode = 1;
  });
}
