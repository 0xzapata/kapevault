// cloud:connect, cloud:forgetOlder and backup:chooseFolder re-check the session after their await:
// a lock, or a lock and unlock, in between means nothing is saved, cleared or linked.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const state = { dialog: null };
const fakeElectron = {
  app: { getVersion: () => "0.0.0-test" },
  BrowserWindow: class {},
  dialog: { showOpenDialog: (...a) => state.dialog(...a) },
  shell: {},
};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === "electron" ? fakeElectron : realLoad.call(this, request, ...rest);
};
const cloudIpc = require("./ipc/cloud.cjs");
const backupIpc = require("./ipc/backup.cjs");
Module._load = realLoad;

function setup() {
  const v = { unlocked: true, generation: 1 };
  const log = [];
  const vault = {
    syncBase() {
      if (!v.unlocked) throw new Error("Vault is locked");
      return { generation: v.generation };
    },
    status: () => ({ unlocked: v.unlocked, path: "/test/vault.kapevault" }),
    cloudConfig: () => null,
    cloudView: () => ({}),
    setCloud: (c) => log.push(`setCloud:${c ? "config" : "null"}`),
    clearOlderBackups: () => log.push("clearOlder"),
  };
  const cloud = {
    configFromInput: () => ({ endpoint: "https://r2.test", bucket: "b" }),
    list: async () => (v.onAwait?.(), []),
    backupNow: async () => log.push("backupNow"),
    forgetOlder: async () => (v.onAwait?.(), { deleted: 2, refused: 0 }),
    status: () => ({}),
    openerReplaced: () => false,
  };
  const folderCopy = { choose: (p) => (log.push(`choose:${p}`), { linked: true }) };
  const handlers = {};
  const base = {
    handle: (name, fn) => (handlers[name] = fn),
    attempt: async (fn) => {
      try {
        return { ok: true, ...(await fn()) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
    requireUnlocked: () => {
      if (!v.unlocked) throw new Error("Unlock the vault first.");
    },
    vault,
  };
  cloudIpc.register({ ...base, cloud, sync: { status: () => ({}) }, broadcast: () => {}, devEnv: {} });
  backupIpc.register({ ...base, folderCopy, windows: { main: () => null } });
  return { v, log, handlers };
}

const lockedMeanwhile = (v) => () => (v.unlocked = false);
const newSessionMeanwhile = (v) => () => v.generation++;

for (const [name, meanwhile] of [["locked", lockedMeanwhile], ["re-unlocked", newSessionMeanwhile]]) {
  test(`cloud:connect saves nothing when the vault ${name} during the connection test`, async () => {
    const { v, log, handlers } = setup();
    v.onAwait = meanwhile(v);
    const res = await handlers["cloud:connect"]({ endpoint: "x" });
    assert.equal(res.ok, false);
    assert.deepEqual(log, []);
  });

  test(`cloud:forgetOlder leaves the old-backups flag when the vault ${name} meanwhile`, async () => {
    const { v, log, handlers } = setup();
    v.onAwait = meanwhile(v);
    await handlers["cloud:forgetOlder"]();
    assert.deepEqual(log, []);
  });

  test(`backup:chooseFolder links nothing when the vault ${name} while the dialog was open`, async () => {
    const { v, log, handlers } = setup();
    state.dialog = async () => (meanwhile(v)(), { canceled: false, filePaths: ["/test/out"] });
    const res = await handlers["backup:chooseFolder"]();
    assert.equal(res.ok, false);
    assert.deepEqual(log, []);
  });
}

test("the same session still connects, forgets and links", async () => {
  const { log, handlers } = setup();
  assert.equal((await handlers["cloud:connect"]({ endpoint: "x" })).ok, true);
  await handlers["cloud:forgetOlder"]();
  state.dialog = async () => ({ canceled: false, filePaths: ["/test/out"] });
  assert.equal((await handlers["backup:chooseFolder"]()).ok, true);
  assert.deepEqual(log, ["setCloud:config", "backupNow", "clearOlder", "choose:/test/out"]);
});
