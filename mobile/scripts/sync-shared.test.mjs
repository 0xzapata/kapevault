import assert from "node:assert/strict";
import { test } from "node:test";
import { drift, imports, pick, withHeader } from "./sync-shared.mjs";
import { DEFAULT_GENERATOR, generatePassword } from "../src/app/lib/generate-password.ts";

test("the phone's copies of the PC's brands, logos and shared code match it (fix: node scripts/sync-shared.mjs)", () => {
  assert.deepEqual(drift(), []);
});

test("a ported PC file gets the phone's imports, and one the phone has no file for stops the sync", () => {
  const pc = 'import { a } from "@/x";\nconst b = await import("./y.ts");\n';
  assert.equal(imports(pc, { "@/x": "../x", "./y.ts": "./y" }), 'import { a } from "../x";\nconst b = await import("./y");\n');
  assert.throws(() => imports(pc, { "@/x": "../x" }), /imports "\.\/y\.ts"/);
});

test("picked PC declarations come out whole and exported, without the comments above them", () => {
  const pc = ["// about the PC's screen", "function a(x: number) {", "  if (x) {", "    return 1;", "  }", "  return 0;", "}", "", "const b = (x: number) => x;", "export function c() {", "}", ""].join("\n");
  assert.equal(pick(pc, ["a", "b", "c"]), "export function a(x: number) {\n  if (x) {\n    return 1;\n  }\n  return 0;\n}\n\nexport const b = (x: number) => x;\n\nexport function c() {\n}\n");
  assert.throws(() => pick(pc, ["d"]), /no top-level d/);
});

test("a declaration is copied whole whatever is inside it: a signature over several lines, a brace in a string, a closing brace at column 0", () => {
  const pc = ["function a(", "  x: number,", ") {", '  const s = `', '}', '`;', '  if (x) {', '  }', "  return s + '}';", "}", "", "const b = {", "  k: 1,", "};", ""].join("\n");
  assert.equal(pick(pc, ["a", "b"]), `export ${pc.split("\n").slice(0, 10).join("\n")}\n\nexport ${pc.split("\n").slice(11, 14).join("\n")}\n`);
});

test("picked code that uses a name the port's header does not import stops the sync", () => {
  const pc = ['import { helper } from "./helper.ts";', "", "const LIMIT = 3;", "", "function a(x: number) {", "  return helper(x) + LIMIT;", "}", ""].join("\n");
  const header = 'import { helper } from "./helper";\n\n';
  assert.throws(() => withHeader(header, pc, ["a"]), /uses LIMIT, which/);
  assert.equal(withHeader(header, pc, ["a", "LIMIT"]), `${header}export function a(x: number) {\n  return helper(x) + LIMIT;\n}\n\nexport const LIMIT = 3;\n`);
  assert.throws(() => withHeader("\n", pc, ["a", "LIMIT"]), /uses helper, which/);
});

test("Generate makes the PC's password: 20 characters with a lowercase and uppercase letter, a digit and a symbol", () => {
  for (let i = 0; i < 50; i++) {
    const password = generatePassword(DEFAULT_GENERATOR);
    assert.equal(password.length, 20);
    for (const needed of [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/]) assert.match(password, needed);
  }
});
