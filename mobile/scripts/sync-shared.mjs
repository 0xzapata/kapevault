// What the phone shares with the PC beyond core/: the brand catalog, matcher and logos are copies of the
// PC's (src/features/brands and src/assets), byte for byte. The brand, sign-in, photo,
// password generator, issue text and search code is the PC's too, made from its files with only the
// imports changed (PORTS; the PC reaches core/ by a relative path, the phone by "@core"). Rules that
// are pure data logic live in core/ instead and need no copy. `node scripts/sync-shared.mjs` writes them
// all (and drops logos the PC no longer has); `--check` only lists what differs.
// scripts/sync-shared.test.mjs fails on any drift.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const mobile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pc = path.join(mobile, "..", "src");

// [PC file or folder, phone copy]
const PAIRS = [
  ["features/brands/brands.json", "src/app/lib/brands.json"],
  ["features/brands/brand-match.ts", "src/app/lib/brand-match.ts"],
  ["assets/app-icon.svg", "src/app/assets/app-icon.svg"],
  ["assets/logos", "src/app/assets/logos"],
].map(([from, to]) => [path.join(pc, from), path.join(mobile, to)]);

// Every import in a PC file, mapped to the phone's. One the map does not know stops the sync: the phone
// has no such file, so that part has to be ported by hand instead.
export function imports(text, map) {
  return text.replace(/(from |import\()"([^"]+)"/g, (_all, head, spec) => {
    if (!(spec in map)) throw new Error(`The PC's code imports "${spec}", which the phone does not have.`);
    return `${head}"${map[spec]}"`;
  });
}

// Top-level declarations of a PC file by name (a function or a const), each exported, without the
// comments above them (those talk about the PC's screens). The compiler finds where each one ends, so a
// brace in a string, a signature over several lines or a nested function cannot cut a copy short.
export function pick(text, names) {
  const file = ts.createSourceFile("pc.ts", text, ts.ScriptTarget.Latest, true);
  const declares = (statement, name) =>
    (ts.isFunctionDeclaration(statement) && statement.name?.text === name) ||
    (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((d) => d.name.getText(file) === name));
  const blocks = names.map((name) => {
    const statement = file.statements.find((s) => declares(s, name));
    if (!statement) throw new Error(`The PC's code has no top-level ${name} any more.`);
    const block = text.slice(statement.getStart(file), statement.getEnd());
    return block.startsWith("export ") ? block : `export ${block}`;
  });
  return `${blocks.join("\n\n")}\n`;
}

// A port's own import header over picked declarations. A name the PC file imports or declares that the
// picked code uses, but the header does not import and no picked block declares, stops the sync.
export function withHeader(header, text, names) {
  const picked = pick(text, names);
  const imported = [...text.matchAll(/^import (?:type )?\{([^}]*)\}/gm)].flatMap((m) => m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()));
  const declared = [...text.matchAll(/^(?:export )?(?:function|const|let|interface|type) (\w+)/gm)].map((m) => m[1]);
  const has = (code, n) => new RegExp(`\\b${n}\\b`).test(code);
  const missing = [...imported, ...declared].filter((n) => n && !names.includes(n) && has(picked, n) && !has(header, n));
  if (missing.length) throw new Error(`The picked code uses ${missing.join(", ")}, which the port's header does not import.`);
  return header + picked;
}

// [PC file, phone copy, the phone's text made from the PC's]: PC code whose only PC-only parts are its imports.
const PORTS = [
  [
    "features/brands/brands.ts",
    "src/app/lib/brands.ts",
    (s) => imports(s, { "./brands.json": "./brands.json", "./brand-match.ts": "./brand-match", "@/features/vault/types": "../host/types" }).replace('import.meta.glob("/src/assets/logos/*"', 'import.meta.glob("../assets/logos/*"'),
  ],
  ["features/vault/lib/sign-in.ts", "src/app/lib/sign-in.ts", (s) => imports(s, { "@/features/brands/brands": "./brands", "../types": "../host/types", "../../../../core/index.js": "@core" })],
  // An ID's photo is made the PC's way: upright, JPEG, under the vault's size cap.
  ["lib/photo.ts", "src/app/lib/photo.ts", (s) => imports(s, { "../../core/index.js": "@core" })],
  // The Generate button's password: every class the options turn on, at least once (sites that ask for a
  // digit or a symbol take it).
  ["features/generator/lib/generate-password.ts", "src/app/lib/generate-password.ts", (s) => imports(s, {})],
  // A security issue's line and advice.
  ["features/vault/lib/issues.ts", "src/app/lib/issues.ts", (s) => imports(s, { "../../../../core/index.js": "@core", "../types": "../host/types" })],
  // What a search reads and how a list sorts. Only these parts: the PC's views (Closed, Closing) and its
  // filter's inputs are not the phone's, so lib/filter.ts keeps its own around them.
  [
    "features/vault/lib/filter-entries.ts",
    "src/app/lib/search.ts",
    (s) =>
      withHeader(
        'import type { Entry } from "../host/types";\nimport type { SortOrder } from "./filter";\nimport { signInOption } from "./sign-in";\nimport { deviceTypeLabel } from "./entries";\n\n',
        s,
        ["searchText", "titleScore", "byTitle", "sortEntries"],
      ),
  ],
].map(([from, to, make]) => [path.join(pc, from), path.join(mobile, to), make]);

// Text files compare without their line endings: with core.autocrlf a checkout writes CRLF into some
// copies and not others, which is not drift.
const read = (file) => {
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return /\.(svg|json|ts)$/.test(file) ? Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n")) : bytes;
};
const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

// A port's text for the phone, under a line that says where it comes from.
function ported([from, , make]) {
  const where = path.relative(path.join(pc, ".."), from).replaceAll("\\", "/");
  const text = make(fs.readFileSync(from, "utf8").replaceAll("\r\n", "\n"));
  return Buffer.from(`// Made from the PC's ${where} by scripts/sync-shared.mjs - change it there, then run the script.\n${text}`);
}

// Every file pair: [PC path, phone path], a folder expanded to the union of both sides' names.
function files() {
  return PAIRS.flatMap(([from, to]) => {
    if (!fs.statSync(from, { throwIfNoEntry: false })?.isDirectory()) return [[from, to]];
    const names = [...new Set([...list(from), ...list(to)])].sort();
    return names.map((name) => [path.join(from, name), path.join(to, name)]);
  });
}

// What differs, as lines like "src/app/assets/logos/x.svg: missing on the phone".
export function drift() {
  const copies = files().flatMap(([from, to]) => {
    const [a, b] = [read(from), read(to)];
    const where = path.relative(mobile, to).replaceAll("\\", "/");
    if (!a) return [`${where}: not on the PC`];
    if (!b) return [`${where}: missing on the phone`];
    return a.equals(b) ? [] : [`${where}: differs from the PC's`];
  });
  const ports = PORTS.flatMap((port) => {
    const where = path.relative(mobile, port[1]).replaceAll("\\", "/");
    if (!fs.existsSync(port[0])) return [`${where}: its PC file is gone`];
    const phone = read(port[1]);
    if (!phone) return [`${where}: missing on the phone`];
    return phone.equals(ported(port)) ? [] : [`${where}: differs from the PC's`];
  });
  return [...copies, ...ports];
}

export function sync() {
  for (const [from, to] of files()) {
    if (!fs.existsSync(from)) fs.rmSync(to);
    else if (!read(to)?.equals(read(from))) fs.copyFileSync(from, to);
  }
  for (const port of PORTS) if (!read(port[1])?.equals(ported(port))) fs.writeFileSync(port[1], ported(port));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const found = drift();
  console.log(found.length ? found.join("\n") : "The phone's shared code matches the PC's.");
  if (process.argv.includes("--check")) process.exitCode = found.length ? 1 : 0;
  else if (found.length) {
    sync();
    console.log(`Synced ${found.length} file(s) from the PC.`);
  }
}
