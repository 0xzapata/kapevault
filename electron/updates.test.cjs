const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createAppSettings } = require("./app-settings.cjs");
const { curlPath } = require("./courier.cjs");
const { createUpdates, compareVersions, parseRelease, releaseUrl, RELEASES_API, RELEASES_PAGE, DAY_MS } = require("./updates.cjs");

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-updates-"));
const release = (extra = {}) => Buffer.from(JSON.stringify({ tag_name: "v0.1.4", html_url: `${RELEASES_PAGE}/tag/v0.1.4`, draft: false, prerelease: false, ...extra }));
const answer = (body, status = 200) => async () => ({ status, body });

// A clock the test moves by hand, settings in a throwaway folder, and a transport that records its calls.
function setup({ on = true, version = "0.1.3", transport } = {}) {
  const settings = createAppSettings(tempDir());
  if (on) settings.set({ checkForUpdates: true });
  const clock = { t: Date.UTC(2026, 9, 9) };
  const calls = [];
  const send = transport ?? answer(release());
  const updates = createUpdates({ settings, version, now: () => clock.t, transport: (req) => (calls.push(req), send(req)) });
  return { settings, clock, calls, updates };
}

test("versions compare as numbers, not text", () => {
  assert.equal(compareVersions("0.1.10", "0.1.9"), 1);
  assert.equal(compareVersions("0.1.9", "0.1.10"), -1);
  assert.equal(compareVersions("v0.2.0", "0.1.99"), 1);
  assert.equal(compareVersions("1.0.0", "v1.0.0"), 0);
  assert.equal(compareVersions("10.0.0", "9.9.9"), 1);
});

test("a tag that is not plain major.minor.patch is ignored", () => {
  for (const junk of ["", "v", "1", "1.2", "1.2.3.4", "1.2.3-rc1", "v1.2.3+build", "latest", "1.2.x", " 1.2.3", "1.2.3\n", "01.2.3x", "-1.2.3", "1.2.9999999", null, undefined, 5, {}, []]) {
    assert.equal(compareVersions(junk, "0.1.3"), null, JSON.stringify(junk));
    assert.equal(compareVersions("0.1.3", junk), null, JSON.stringify(junk));
  }
});

test("the release answer: tag and page, drafts and prereleases dropped", () => {
  assert.deepEqual(parseRelease(release()), { version: "0.1.4", url: `${RELEASES_PAGE}/tag/v0.1.4` });
  assert.equal(parseRelease(release({ draft: true })), null);
  assert.equal(parseRelease(release({ prerelease: true })), null);
  assert.equal(parseRelease(release({ tag_name: "nightly" })), null);
  assert.equal(parseRelease(release({ tag_name: 4 })), null);
});

test("a page that is not on the project's releases falls back to the fixed one", () => {
  for (const bad of [
    "https://evil.test/brewed-ops/kapevault/releases",
    "http://github.com/brewed-ops/kapevault/releases",
    "https://github.com.evil.test/brewed-ops/kapevault/releases",
    "https://github.com@evil.test/brewed-ops/kapevault/releases",
    "https://user:pw@github.com/brewed-ops/kapevault/releases",
    "https://github.com:8443/brewed-ops/kapevault/releases",
    "https://github.com/brewed-ops/kapevault/releasesx",
    "https://github.com/brewed-ops/other/releases/tag/v1.0.0",
    "https://github.com/brewed-ops/kapevault/releases/../../../evil/x",
    "javascript:alert(1)",
    "file:///C:/Windows/System32/calc.exe",
    "not a url",
    "",
    7,
    null,
  ]) {
    assert.equal(releaseUrl(bad), RELEASES_PAGE, String(bad));
  }
  assert.equal(releaseUrl(RELEASES_PAGE), RELEASES_PAGE);
  assert.equal(releaseUrl(`${RELEASES_PAGE}/tag/v0.1.4`), `${RELEASES_PAGE}/tag/v0.1.4`);
});

test("the response parser survives junk: always a release or null, never a throw", () => {
  const junk = [Buffer.alloc(0), Buffer.from("not json"), Buffer.from("null"), Buffer.from("[]"), Buffer.from('"v1.0.0"'), Buffer.from("{"), Buffer.from('{"tag_name":'), Buffer.from("{\"tag_name\":{\"a\":1}}"), Buffer.from([0xff, 0xfe, 0, 1, 2, 3]), Buffer.from("{}"), Buffer.alloc(100000, 0x7b)];
  let seed = 12345; // a fixed seed, so a failure repeats
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  for (let i = 0; i < 300; i++) {
    const good = release();
    const cut = Buffer.from(good.subarray(0, next() % good.length));
    const flipped = Buffer.from(good);
    flipped[next() % flipped.length] = next() % 256;
    junk.push(cut, flipped);
  }
  for (const body of junk) {
    const out = parseRelease(body);
    assert.ok(out === null || (typeof out.version === "string" && compareVersions(out.version, "0.0.0") !== null && out.url.startsWith(RELEASES_PAGE)));
  }
});

test("the setting is off by default, a boolean only, and it is on the allowlist", () => {
  const dir = tempDir();
  const settings = createAppSettings(dir);
  assert.equal(settings.get().checkForUpdates, false);
  assert.equal(settings.set({ checkForUpdates: "true" }).checkForUpdates, false, "a string is ignored");
  assert.equal(settings.set({ checkForUpdates: 1 }).checkForUpdates, false);
  assert.equal(settings.set({ checkForUpdates: true }).checkForUpdates, true);
  assert.equal(createAppSettings(dir).get().checkForUpdates, true, "kept across a restart");
  // The page's patch can switch the check, never rewrite what it remembers.
  settings.set({ updateCheck: { attemptedAt: 1, checkedAt: 1, latest: "9.9.9", url: "https://evil.test" } });
  assert.equal(settings.updateCheck().latest, null);
});

test("what the check remembers survives a restart and drops junk", () => {
  const dir = tempDir();
  const settings = createAppSettings(dir);
  settings.setUpdateCheck({ attemptedAt: 5, checkedAt: 5, latest: "0.1.4", url: RELEASES_PAGE });
  assert.deepEqual(createAppSettings(dir).updateCheck(), { attemptedAt: 5, checkedAt: 5, latest: "0.1.4", url: RELEASES_PAGE });
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ updateCheck: { attemptedAt: "soon", checkedAt: -4, latest: { a: 1 }, url: 9 } }));
  assert.deepEqual(createAppSettings(dir).updateCheck(), { attemptedAt: null, checkedAt: null, latest: null, url: null });
});

test("off: never asks, whatever the clock says, and shows nothing", async () => {
  const { updates, calls } = setup({ on: false });
  assert.deepEqual(await updates.checkIfDue(), { available: false, version: null, checkedAt: null });
  assert.equal(calls.length, 0);
});

test("the request: one GET to the fixed address, a fixed User-Agent, no cookie, nothing about the vault", async () => {
  const { updates, calls, settings } = setup();
  settings.installId(); // an id exists; it must not travel
  await updates.checkIfDue();
  assert.equal(calls.length, 1);
  const req = calls[0];
  assert.equal(req.method, "GET");
  assert.equal(req.url, RELEASES_API);
  assert.equal(req.url, "https://api.github.com/repos/brewed-ops/kapevault/releases/latest");
  assert.equal(req.headers["User-Agent"], "KAPEVault/0.1.3");
  assert.deepEqual(Object.keys(req.headers).sort(), ["Accept", "User-Agent"]);
  assert.equal(req.body, undefined);
  assert.equal(req.allowHttp, false, "only a test points the check at a local http server");
  assert.ok(req.maxBytes <= 1024 * 1024);
  assert.ok(!JSON.stringify(req).includes(settings.installId()));
});

test("a newer release is reported, the same or an older one is not", async () => {
  for (const [tag, available] of [["v0.1.4", true], ["v0.1.10", true], ["v0.1.3", false], ["v0.1.2", false], ["v0.0.99", false]]) {
    const { updates, clock } = setup({ transport: answer(release({ tag_name: tag, html_url: `${RELEASES_PAGE}/tag/${tag}` })) });
    const status = await updates.checkIfDue();
    assert.equal(status.available, available, tag);
    assert.equal(status.version, available ? tag.slice(1) : null);
    assert.equal(status.checkedAt, clock.t);
    assert.equal(status.error, undefined);
  }
});

test("24 hours: not due before, due at and after, due when the clock went backwards", async () => {
  assert.equal(DAY_MS, 24 * 60 * 60 * 1000, "the constant the rest of this test leans on is a day");
  const { updates, calls, clock } = setup();
  await updates.checkIfDue();
  await updates.checkIfDue();
  assert.equal(calls.length, 1, "asked once, then not due");
  clock.t += DAY_MS - 1;
  await updates.checkIfDue();
  assert.equal(calls.length, 1, "a millisecond short of a day");
  clock.t += 1;
  await updates.checkIfDue();
  assert.equal(calls.length, 2, "a day later");
  clock.t -= 3 * DAY_MS; // the PC clock was set back: the stored time is in the future
  await updates.checkIfDue();
  assert.equal(calls.length, 3);
});

test("not asked again after a restart that comes inside the day", async () => {
  const dir = tempDir();
  const first = createAppSettings(dir);
  first.set({ checkForUpdates: true });
  const clock = { t: 1_000_000 };
  const calls = [];
  const make = (settings) => createUpdates({ settings, version: "0.1.3", now: () => clock.t, transport: (r) => (calls.push(r), answer(release())()) });
  await make(first).checkIfDue();
  clock.t += 60 * 60 * 1000;
  const status = await make(createAppSettings(dir)).checkIfDue();
  assert.equal(calls.length, 1);
  assert.equal(status.available, true, "the earlier answer is still shown");
});

test("any failure backs off to the next day: no retry, no throw, last good time kept", async () => {
  const failures = [
    ["offline", async () => { throw new Error("Could not reach R2."); }],
    ["rate limited", answer(Buffer.from("{}"), 403)],
    ["too many", answer(Buffer.from("{}"), 429)],
    ["server error", answer(Buffer.from("{}"), 502)],
    ["a redirect", answer(Buffer.alloc(0), 301)],
    ["bad json", answer(Buffer.from("<html>"))],
    ["a draft", answer(release({ draft: true }))],
    ["no tag", answer(Buffer.from("{}"))],
  ];
  for (const [name, fail] of failures) {
    let broken = false;
    const { updates, calls, clock } = setup({ transport: (r) => (broken ? fail(r) : answer(release())()) });
    const good = await updates.checkIfDue();
    assert.equal(good.error, undefined);
    clock.t += DAY_MS;
    broken = true;
    const bad = await updates.checkIfDue();
    assert.equal(bad.error, "Could not check", name);
    assert.equal(bad.checkedAt, good.checkedAt, `${name}: the last good check time stays`);
    assert.equal(bad.available, true, `${name}: a release already found stays found`);
    const count = calls.length;
    clock.t += 60 * 60 * 1000;
    await updates.checkIfDue();
    clock.t += DAY_MS - 60 * 60 * 1000 - 1;
    await updates.checkIfDue();
    assert.equal(calls.length, count, `${name}: no retry inside the day`);
    clock.t += 1;
    broken = false;
    const again = await updates.checkIfDue();
    assert.equal(again.error, undefined, `${name}: asks again a day on`);
  }
});

test("a first-ever failure says Could not check with no time", async () => {
  const { updates } = setup({ transport: async () => { throw new Error("x"); } });
  assert.deepEqual(await updates.checkIfDue(), { available: false, version: null, checkedAt: null, error: "Could not check" });
});

test("two calls at once make one request", async () => {
  let release_;
  const gate = new Promise((r) => (release_ = r));
  const { updates, calls } = setup({ transport: async () => (await gate, { status: 200, body: release() }) });
  const a = updates.checkIfDue();
  const b = updates.checkIfDue();
  release_();
  await Promise.all([a, b]);
  assert.equal(calls.length, 1);
});

test("an app that has since been updated stops reporting that release", async () => {
  const dir = tempDir();
  const settings = createAppSettings(dir);
  settings.set({ checkForUpdates: true });
  const clock = { t: 5_000_000 };
  const old = createUpdates({ settings, version: "0.1.3", now: () => clock.t, transport: answer(release()) });
  assert.equal((await old.checkIfDue()).available, true);
  const now = createUpdates({ settings, version: "0.1.4", now: () => clock.t, transport: answer(release()) });
  assert.equal((await now.status()).available, false);
});

test("the page is told only available, version, checkedAt and error", async () => {
  const { updates } = setup();
  const status = await updates.checkIfDue();
  assert.deepEqual(Object.keys(status).sort(), ["available", "checkedAt", "version"]);
  assert.deepEqual(Object.keys(updates.status()).sort(), ["available", "checkedAt", "version"]);
});

test("the link to open: the releases page, or the release's own page, only while one is out", async () => {
  const { updates, settings } = setup();
  assert.equal(updates.pageToOpen(), null, "nothing found yet");
  await updates.checkIfDue();
  assert.equal(updates.pageToOpen(), `${RELEASES_PAGE}/tag/v0.1.4`);
  settings.setUpdateCheck({ ...settings.updateCheck(), url: "https://evil.test/x" }); // a hand-edited file
  assert.equal(updates.pageToOpen(), RELEASES_PAGE);
  settings.set({ checkForUpdates: false });
  assert.equal(updates.pageToOpen(), null, "off: nothing to open");
});

test("the test override: newer, same, fail", async () => {
  for (const [fake, available, error] of [["newer", true, undefined], ["same", false, undefined], ["fail", false, "Could not check"]]) {
    const settings = createAppSettings(tempDir());
    settings.set({ checkForUpdates: true });
    let touched = false;
    const updates = createUpdates({ settings, version: "0.1.3", fake, transport: async () => { touched = true; } });
    const status = await updates.checkIfDue();
    assert.equal(status.available, available, fake);
    assert.equal(status.error, error, fake);
    assert.equal(touched, false, "the override never reaches the network");
  }
});

// The real system curl against a local server, as the courier test does: the request leaves with only
// the headers this module set, a cookie is never invented, a redirect is not followed, a big answer is cut.
test("through the courier and the system curl", { skip: !fs.existsSync(curlPath()) && "no system curl" }, async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    if (req.url === "/big") return res.end(Buffer.alloc(2 * 1024 * 1024, 0x20));
    if (req.url === "/moved") return res.writeHead(302, { location: "/elsewhere" }).end();
    res.setHeader("set-cookie", "tracker=1");
    res.end(release());
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const run = (route) => {
    const settings = createAppSettings(tempDir());
    settings.set({ checkForUpdates: true });
    return createUpdates({ settings, version: "0.1.3", url: `${origin}${route}`, allowHttp: true }).checkIfDue();
  };
  try {
    const ok = await run("/latest");
    assert.equal(ok.available, true);
    const headers = seen[0].headers;
    assert.equal(headers["user-agent"], "KAPEVault/0.1.3");
    assert.equal(headers.cookie, undefined);
    assert.equal(headers.authorization, undefined);
    assert.equal((await run("/big")).error, "Could not check");
    const count = seen.length;
    assert.equal((await run("/moved")).error, "Could not check");
    assert.equal(seen.length, count + 1, "a redirect is never followed");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

// The three calls the page gets (ipc/updates.cjs), with the IPC layer and the browser opener stood in.
test("the page's calls: status and check answer the one shape, open takes no argument and opens only the found page", async () => {
  const { register } = require("./ipc/updates.cjs");
  const handlers = {};
  const opened = [];
  const { updates, settings } = setup();
  register({ handle: (channel, fn) => (handlers[channel] = fn), updates, openExternal: async (page) => opened.push(page) });
  assert.deepEqual(Object.keys(handlers).sort(), ["updates:check", "updates:open", "updates:status"]);
  await handlers["updates:open"]("https://evil.test/");
  assert.deepEqual(opened, [], "nothing found yet: nothing opens");
  const checked = await handlers["updates:check"]("https://evil.test/");
  assert.deepEqual(Object.keys(checked).sort(), ["available", "checkedAt", "version"]);
  assert.deepEqual(handlers["updates:status"](), checked);
  await handlers["updates:open"]("https://evil.test/");
  assert.deepEqual(opened, [`${RELEASES_PAGE}/tag/v0.1.4`], "an argument from the page changes nothing");
  settings.set({ checkForUpdates: false });
  await handlers["updates:open"]();
  assert.equal(opened.length, 1);
});

test("start asks at once when due, then the hour decides: it never asks twice inside a day, and asks again once the day is up", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { updates, calls, clock } = setup();
  updates.start();
  assert.equal(calls.length, 1, "asked at start");
  await new Promise((resolve) => setImmediate(resolve)); // that ask finishes
  t.mock.timers.tick(60 * 60 * 1000);
  assert.equal(calls.length, 1, "an hour later the day is not up");
  clock.t += 24 * 60 * 60 * 1000;
  t.mock.timers.tick(60 * 60 * 1000);
  assert.equal(calls.length, 2, "the next hourly look finds the day up");
});

test("start does nothing while the switch is off, however long it runs", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { updates, calls, clock } = setup({ on: false });
  updates.start();
  clock.t += 3 * 24 * 60 * 60 * 1000;
  t.mock.timers.tick(5 * 60 * 60 * 1000);
  assert.equal(calls.length, 0);
});
