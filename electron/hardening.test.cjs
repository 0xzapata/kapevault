const test = require("node:test");
const assert = require("node:assert/strict");
const { ELECTRON_OWN_SWITCHES, REFUSED_SWITCHES, refuseDebugging } = require("./hardening.cjs");

// A stand-in app: packaged or not, with the switches Chromium saw and what exit() was called with.
function fakeApp({ isPackaged = true, switches = [] } = {}) {
  const calls = [];
  return { isPackaged, commandLine: { hasSwitch: (s) => switches.includes(s) }, exit: (code) => calls.push(code), calls };
}

test("a packaged build exits on every refused switch, however Chromium or the argv spells it", () => {
  for (const name of REFUSED_SWITCHES) {
    const viaChromium = fakeApp({ switches: [name] });
    refuseDebugging(viaChromium, []);
    // One Electron adds to every launch can only be judged by the argv (test below).
    assert.deepEqual(viaChromium.calls, ELECTRON_OWN_SWITCHES.includes(name) ? [] : [1], `${name} seen by commandLine`);
    for (const spelled of [`--${name}`, `--${name}=mock`, `/${name}`, `-${name.toUpperCase()}=mock`]) {
      const viaArgv = fakeApp();
      refuseDebugging(viaArgv, ["KAPEVault.exe", spelled]);
      assert.deepEqual(viaArgv.calls, [1], spelled);
    }
  }
});

test("the sandbox, web-security, extension, proxy and js-flags switches are on the list", () => {
  for (const name of ["no-sandbox", "disable-web-security", "load-extension", "js-flags", "disable-site-isolation-trials", "allow-file-access-from-files", "remote-allow-origins", "enable-logging", "proxy-server", "host-rules", "host-resolver-rules", "ignore-certificate-errors", "user-data-dir"]) {
    assert.ok(REFUSED_SWITCHES.includes(name), name);
  }
});

test("a packaged build still starts with its own switches and Chromium's", () => {
  const app = fakeApp();
  refuseDebugging(app, ["KAPEVault.exe", "--hidden", "--quit", "--type=renderer", "--field-trial-handle=1234", "--lang=en-US", "--enable-features=mock"]);
  assert.deepEqual(app.calls, []);
});

// Electron 44 appends allow-file-access-from-files to EVERY browser process itself
// (shell/app/electron_main_delegate.cc), so commandLine.hasSwitch always sees it. Refusing it there made
// every packaged build exit at startup (2026-10-04 to 2026-10-09, found when the installer was run again).
test("a packaged build starts with the switches Electron adds by itself, and still refuses them on the command line", () => {
  const plain = fakeApp({ switches: [...ELECTRON_OWN_SWITCHES] });
  refuseDebugging(plain, ["D:\\Kapevault\\KAPEVault.exe"]);
  assert.deepEqual(plain.calls, [], "a plain double-click starts");
  for (const name of ELECTRON_OWN_SWITCHES) {
    const passed = fakeApp({ switches: [...ELECTRON_OWN_SWITCHES] });
    refuseDebugging(passed, ["KAPEVault.exe", `--${name}`]);
    assert.deepEqual(passed.calls, [1], `--${name} given on the command line is refused`);
  }
});

test("an unpacked run (tests, dev) is never refused", () => {
  const app = fakeApp({ isPackaged: false, switches: ["no-sandbox", "remote-debugging-port"] });
  refuseDebugging(app, ["--no-sandbox", "--remote-debugging-port=0"]);
  assert.deepEqual(app.calls, []);
});
