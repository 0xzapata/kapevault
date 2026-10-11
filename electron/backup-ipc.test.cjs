// backup.cjs against a fake Electron and a fake vault: a printout is refused when the session ended
// while the save dialog was open, and a vault copy is refused inside the vault's own folder.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const state = { dialog: null, opened: [] };
const fakeElectron = {
  app: { getVersion: () => "0.0.0-test" },
  BrowserWindow: class {
    constructor() {
      this.webContents = { printToPDF: async () => Buffer.from("%PDF dummy-pass-123") };
    }
    async loadURL() {}
    destroy() {}
  },
  dialog: { showSaveDialog: (...a) => state.dialog(...a) },
  shell: { openPath: async (f) => state.opened.push(f) },
};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === "electron" ? fakeElectron : realLoad.call(this, request, ...rest);
};
const { register } = require("./ipc/backup.cjs");
Module._load = realLoad;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kv-backup-ipc-"));
  const vaultDir = path.join(dir, "vault");
  const outDir = path.join(dir, "out");
  fs.mkdirSync(vaultDir);
  fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(vaultDir, "vault.kapevault"), "cipher");
  const v = { unlocked: true, generation: 1 };
  const vault = {
    syncBase() {
      if (!v.unlocked) throw new Error("Vault is locked");
      return { generation: v.generation };
    },
    status: () => ({ path: path.join(vaultDir, "vault.kapevault"), unlocked: v.unlocked }),
    handBack: () => ({ person: "Test Person", items: [{ title: "Test Login", rows: [{ label: "Password", value: "dummy-pass-123", secret: true }] }] }),
    publicView: () => ({ entries: [] }),
    cloudConfig: () => null,
  };
  const handlers = {};
  register({
    handle: (name, fn) => (handlers[name] = fn),
    attempt: (fn) => fn(),
    requireUnlocked: () => {
      if (!v.unlocked) throw new Error("Vault is locked");
    },
    vault,
    folderCopy: {},
    windows: { main: () => null },
  });
  state.opened = [];
  return { dir, vaultDir, outDir, v, handlers };
}

test("hand back writes nothing when the vault locked while the save dialog was open", async () => {
  const { dir, outDir, v, handlers } = setup();
  const out = path.join(outDir, "For Test Person.pdf");
  state.dialog = async () => {
    v.unlocked = false; // the auto-lock fires while the dialog is open
    return { canceled: false, filePath: out };
  };
  await assert.rejects(handlers["vault:handBack"]("Test Person", true), /locked while the save window was open/);
  assert.ok(!fs.existsSync(out), "no PDF written");
  assert.deepEqual(state.opened, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("hand back writes nothing when the vault was locked and unlocked again meanwhile", async () => {
  const { dir, outDir, v, handlers } = setup();
  const out = path.join(outDir, "For Test Person.pdf");
  state.dialog = async () => {
    v.generation++; // a new session
    return { canceled: false, filePath: out };
  };
  await assert.rejects(handlers["vault:handBack"]("Test Person", true), /locked while the save window was open/);
  assert.ok(!fs.existsSync(out));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("hand back still saves while the same session stays open", async () => {
  const { dir, outDir, handlers } = setup();
  const out = path.join(outDir, "For Test Person.pdf");
  state.dialog = async () => ({ canceled: false, filePath: out });
  const res = await handlers["vault:handBack"]("Test Person", true);
  assert.deepEqual(res, { name: "For Test Person.pdf" });
  assert.ok(fs.existsSync(out));
  assert.deepEqual(state.opened, [out]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("saveCopy refuses a destination inside the vault's own folder, and still saves elsewhere", async () => {
  const { dir, vaultDir, outDir, handlers } = setup();
  for (const name of ["vault.kapevault", "vault.kapevault.replaced", "sub.kapevault"]) {
    const into = path.join(vaultDir, name);
    const before = fs.readFileSync(path.join(vaultDir, "vault.kapevault"), "utf8");
    state.dialog = async () => ({ canceled: false, filePath: into });
    await assert.rejects(handlers["backup:saveCopy"](), /outside KAPEVault's own folder/);
    assert.equal(fs.readFileSync(path.join(vaultDir, "vault.kapevault"), "utf8"), before);
  }
  assert.ok(!fs.existsSync(path.join(vaultDir, "vault.kapevault.replaced")));
  state.dialog = async () => ({ canceled: false, filePath: path.join(outDir, "copy.kapevault") });
  const res = await handlers["backup:saveCopy"]();
  assert.equal(res.name, "copy.kapevault");
  assert.equal(fs.readFileSync(path.join(outDir, "copy.kapevault"), "utf8"), "cipher");
  fs.rmSync(dir, { recursive: true, force: true });
});
