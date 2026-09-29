// main.cjs picks Windows Hello or Touch ID and calls one set of methods on either. A method one of
// them lacks breaks unlock on that OS only (Touch ID once had no masterAt), so the set is held here.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWindowsHello } = require("./windows-hello.cjs");
const { createTouchId } = require("./touch-id.cjs");

test("Windows Hello and Touch ID have every method main.cjs and ipc/ call, and the same set", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-biometric-"));
  const hello = createWindowsHello({ dataDir, fake: "approve" });
  const touch = createTouchId({ dataDir, fake: "approve" });
  // main.cjs and the IPC handlers it wires (electron/ipc/) are the callers.
  const ipcDir = path.join(__dirname, "ipc");
  const callers = [path.join(__dirname, "main.cjs"), ...fs.readdirSync(ipcDir).map((f) => path.join(ipcDir, f))];
  const main = callers.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const used = [...new Set([...main.matchAll(/\bbiometric\.(\w+)\(/g)].map((m) => m[1]))];
  assert.ok(used.includes("unlock") && used.includes("masterAt"), `main.cjs and ipc/ call: ${used}`);
  for (const name of used) {
    assert.equal(typeof hello[name], "function", `Windows Hello has no ${name}`);
    assert.equal(typeof touch[name], "function", `Touch ID has no ${name}`);
  }
  assert.deepEqual(Object.keys(touch).sort(), Object.keys(hello).sort());
});
