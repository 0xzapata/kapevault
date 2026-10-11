// Six IPC handlers the locked UI never calls refuse while the vault is locked, against a fake Electron.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const calls = [];
const fakeWindow = { isVisible: () => true, setOpacity: (o) => calls.push(`opacity:${o}`), isDestroyed: () => false };
const fakeElectron = {
  app: { isPackaged: false },
  desktopCapturer: {},
  dialog: {},
  screen: {},
  shell: { showItemInFolder: (p) => calls.push(`reveal:${p}`) },
};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === "electron" ? fakeElectron : realLoad.call(this, request, ...rest);
};
const settingsIpc = require("./ipc/settings.cjs");
const biometricIpc = require("./ipc/biometric.cjs");
const vaultIpc = require("./ipc/vault.cjs");
Module._load = realLoad;

function setup() {
  const s = { unlocked: false };
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
      if (!s.unlocked) throw new Error("Unlock the vault first.");
    },
  };
  const vault = { status: () => ({ unlocked: s.unlocked, path: "/test/vault.kapevault" }), keyCopy: () => Buffer.alloc(32) };
  const clip = { copyWithAutoClear: async (t) => calls.push(`copy:${t}`) };
  const airWall = { set: async (on) => (calls.push(`airwall:${on}`), "on"), status: async () => "off", test: async () => "ok" };
  const settings = { get: () => ({}), set: (p) => calls.push(`set:${JSON.stringify(p)}`) };
  settingsIpc.register({
    ...base, settings, airWall, installWriters: Promise.resolve([]), applySettings: () => {}, hotkey: "x", hotkeyOk: () => true,
    legacyDir: null, devEnv: {}, shownCopy: () => null, proveOwnsCopy: async () => {}, windows: {},
  });
  biometricIpc.register({
    ...base, vault, biometric: { status: () => ({}), isSupported: async () => false, isStale: () => false }, biometricName: "Hello",
    biometricKeyChanged: async () => calls.push("biometricOff"), unlocked: (r) => r, lastMasterAt: () => 0, setLastMasterAt: () => {}, setPrompting: () => {}, windows: {},
  });
  vaultIpc.register({
    ...base, vault, biometric: {}, sync: {}, clip, changed: () => {}, unlocked: (r) => r, lockVault: () => {}, throttledUnlock: async (f) => f(),
    setLastMasterAt: () => {}, biometricKeyChanged: async () => {}, vaultStatus: () => ({}), windows: { all: () => [fakeWindow], main: () => null }, isMac: false, devEnv: {},
  });
  return { s, handlers };
}

const GATED = [
  ["airwall:set", [true]],
  ["app:setSettings", [{ theme: "dark" }]],
  ["biometric:disable", []],
  ["vault:scanQr", []],
  ["vault:copyText", ["dummy-text", "id1"]],
  ["vault:revealFile", []],
];

for (const [channel, args] of GATED) {
  test(`${channel} refuses while the vault is locked and acts nothing`, async () => {
    const { handlers } = setup();
    calls.length = 0;
    const res = await Promise.resolve()
      .then(() => handlers[channel](...args))
      .catch((e) => ({ threw: e.message }));
    assert.match(res.threw ?? res.error ?? "", /Unlock the vault first/);
    assert.deepEqual(calls, [], "no side effect");
  });
}

test("the gated handlers still act while the vault is unlocked", async () => {
  const { s, handlers } = setup();
  s.unlocked = true;
  calls.length = 0;
  await handlers["airwall:set"](true);
  await handlers["app:setSettings"]({ theme: "dark" });
  await handlers["biometric:disable"]();
  await handlers["vault:copyText"]("dummy-text", "");
  await handlers["vault:revealFile"]();
  assert.deepEqual(calls, ["airwall:true", 'set:{"theme":"dark"}', "biometricOff", "copy:dummy-text", "reveal:/test/vault.kapevault"]);
});
