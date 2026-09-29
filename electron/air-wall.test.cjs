const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { createAirWall, parseRuleStatus, firewallOn, ruleScript, psQuote, probe, probeResult, RULE } = require("./air-wall.cjs");

const EXE = "C:\\Users\\Mock User\\AppData\\Local\\Programs\\kapevault\\KAPEVault.exe";
const OTHER = "C:\\Users\\Mock User\\AppData\\Local\\Programs\\kapevault-old\\KAPEVault.exe";

// Shaped like real `netsh advfirewall firewall show rule name=... verbose` output (Windows 11).
const rule = ({ enabled = "Yes", dir = "Out", action = "Block", program = EXE, profiles = "Domain,Private,Public" } = {}) =>
  [
    "",
    `Rule Name:                            ${RULE}`,
    "----------------------------------------------------------------------",
    "Enabled:                              " + enabled,
    "Direction:                            " + dir,
    "Profiles:                             " + profiles,
    "Grouping:                             ",
    "LocalIP:                              Any",
    "RemoteIP:                             Any",
    "Protocol:                             Any",
    "Edge traversal:                       No",
    "Program:                              " + program,
    "InterfaceTypes:                       Any",
    "Security:                             NotRequired",
    "Rule source:                          Local Setting",
    "Action:                               " + action,
    "",
  ].join("\r\n");

test("netsh status: on only for an enabled outbound block of this exe on every profile", () => {
  assert.deepEqual(parseRuleStatus(rule() + "Ok.\r\n", EXE), { state: "on" });
  assert.deepEqual(parseRuleStatus(rule({ program: EXE.toLowerCase() }), EXE), { state: "on" }); // Windows paths ignore case
  assert.deepEqual(parseRuleStatus(rule({ enabled: "No" }), EXE), { state: "off" });
  assert.deepEqual(parseRuleStatus(rule({ dir: "In" }), EXE), { state: "off" });
  assert.deepEqual(parseRuleStatus(rule({ action: "Allow" }), EXE), { state: "off" });
  assert.deepEqual(parseRuleStatus(rule({ profiles: "Public" }), EXE), { state: "off" });
  assert.deepEqual(parseRuleStatus("", EXE), { state: "off" }); // missing
});

test("netsh status: a rule that blocks another copy says so", () => {
  assert.deepEqual(parseRuleStatus(rule({ program: OTHER }), EXE), { state: "other", program: OTHER });
  assert.deepEqual(parseRuleStatus(rule({ program: OTHER }) + rule(), EXE), { state: "on" });
});

test("the elevated script quotes every argument, so a path cannot inject a command", () => {
  assert.equal(psQuote("it's"), "'it''s'");
  assert.equal(psQuote("a\u2019b"), "'a\u2019\u2019b'");
  const evil = "C:\\Users\\x'; Remove-Item C:\\ -Recurse; '\\KAPEVault.exe";
  const script = ruleScript(true, evil);
  assert.ok(script.includes(psQuote(`program=${evil}`)));
  assert.ok(script.includes("'delete' 'rule' 'name=KAPEVault Air Wall'"));
  assert.ok(script.includes("'dir=out' 'action=block'"));
  assert.ok(!ruleScript(false, EXE).includes("'add'"));
});

// `netsh advfirewall show currentprofile state` (Windows 11, two networks in use).
const profiles = (a, b) => `\r\nPrivate Profile Settings: \r\n${"-".repeat(70)}\r\nState                                 ${a}\r\n\r\nPublic Profile Settings: \r\n${"-".repeat(70)}\r\nState                                 ${b}\r\nOk.\r\n\r\n`;
const PROFILES_ON = profiles("ON", "ON");

test("the rule only counts while Windows Firewall is on for every network in use", async () => {
  assert.equal(firewallOn(PROFILES_ON), true);
  assert.equal(firewallOn(profiles("ON", "OFF")), false);
  assert.equal(firewallOn(""), false);
  const deps = { readRule: async () => rule(), readProfiles: async () => profiles("OFF", "ON") };
  assert.deepEqual(await createAirWall({ exePath: EXE, packaged: true, platform: "win32", deps }).status(), { available: true, state: "unenforced" });
});

test("a non-ASCII letter netsh wrote in its code page still matches this exe", () => {
  const exe = "C:\\Users\\Jos\u00e9\\AppData\\Local\\Programs\\kapevault\\KAPEVault.exe";
  const asRead = Buffer.from(rule({ program: "C:\\Users\\Jos\x82\\AppData\\Local\\Programs\\kapevault\\KAPEVault.exe" }), "latin1").toString("latin1"); // 0x82 = e-acute in code page 437
  assert.deepEqual(parseRuleStatus(asRead, exe), { state: "on" });
  assert.equal(parseRuleStatus(asRead, "C:\\Users\\Josh\\AppData\\Local\\Programs\\kapevault\\KAPEVault.exe").state, "other");
});

test("status: macOS and unpacked runs are not available; a fake stands in only when asked", async () => {
  assert.deepEqual(await createAirWall({ exePath: EXE, packaged: true, platform: "darwin" }).status(), { available: false, reason: "platform" });
  assert.deepEqual(await createAirWall({ exePath: EXE, packaged: false, platform: "win32" }).status(), { available: false, reason: "unpacked" });
  assert.deepEqual(await createAirWall({ exePath: EXE, packaged: false, platform: "win32", fake: "nonsense" }).status(), { available: false, reason: "unpacked" });
  const other = await createAirWall({ exePath: EXE, packaged: false, platform: "win32", fake: "other" }).status();
  assert.equal(other.state, "other");
  assert.ok(other.program);
});

test("fake mode: the switch flips the state and Test answers from it, with no network", async () => {
  const deps = { runElevated: () => assert.fail("no UAC in fake mode"), readRule: () => assert.fail("no netsh"), probe: () => assert.fail("no network") };
  const wall = createAirWall({ exePath: EXE, packaged: false, platform: "win32", fake: "off", deps });
  assert.equal(await wall.test(), "open");
  assert.deepEqual(await wall.set(true), { available: true, state: "on" });
  assert.equal(await wall.test(), "blocked");
  assert.deepEqual(await wall.set(false), { available: true, state: "off" });
});

test("set reads the rule back; a cancelled prompt changes nothing and says so", async () => {
  let installed = "";
  const deps = {
    readRule: async () => installed,
    readProfiles: async () => PROFILES_ON,
    runElevated: async (script) => {
      if (script.includes("'add'")) installed = rule();
      return 0;
    },
    probe: async () => "blocked",
  };
  const wall = createAirWall({ exePath: EXE, packaged: true, platform: "win32", deps });
  assert.deepEqual(await wall.set(true), { available: true, state: "on" });
  assert.equal(await wall.test(), "blocked");

  deps.runElevated = async () => 1223;
  await assert.rejects(wall.set(false), /prompt was cancelled, so nothing changed/);
  assert.deepEqual(await wall.status(), { available: true, state: "on" });
  deps.runElevated = async () => 5;
  await assert.rejects(wall.set(false), /did not remove/);
});

test("the probe connects once and sends nothing; EACCES reads as a Windows block", async () => {
  let received = 0;
  const server = net.createServer((s) => s.on("data", (d) => (received += d.length)));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    assert.equal(await probe({ host: "127.0.0.1", port: server.address().port, timeoutMs: 3000 }), "open");
    assert.equal(received, 0);
  } finally {
    server.close();
  }
  assert.equal(probeResult("EACCES"), "blocked");
  assert.equal(probeResult("ETIMEDOUT"), "offline");
  assert.equal(probeResult("ENETUNREACH"), "offline");
});
