const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { carry, curlArgs, curlConfig, parseOutput, curlPath, cleanUp, TEMP_PREFIX } = require("./courier.cjs");

const signed = { "x-amz-date": "20260926T000000Z", "x-amz-content-sha256": "abc", authorization: "AWS4-HMAC-SHA256 Credential=mock-key/20260926/auto/s3/aws4_request, SignedHeaders=host, Signature=00" };
const base = { url: "https://0123abcd.r2.cloudflarestorage.com/b-1/k", maxBytes: 1000, caFile: "roots.pem" };
const after = (args, flag) => args[args.indexOf(flag) + 1];
const leftovers = () => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(TEMP_PREFIX));

test("curl arguments: no curlrc, request on stdin, https only, no redirects, capped", () => {
  const args = curlArgs(base);
  assert.deepEqual(args.slice(0, 3), ["-q", "-K", "-"]);
  assert.equal(after(args, "--proto"), "=https");
  assert.ok(!args.some((a) => a === "-L" || a === "--location" || a.startsWith("--location")));
  assert.equal(after(args, "--max-filesize"), "1000");
  assert.equal(after(args, "--connect-timeout"), "10");
  // A dead link fails in 30s; a slow one that is still moving is never cut off at a fixed time
  // (a 64 MB vault on a slow uplink takes minutes). The hour is only a backstop.
  assert.equal(after(args, "--speed-limit"), "1024");
  assert.equal(after(args, "--speed-time"), "30");
  assert.equal(after(args, "--max-time"), "3600");
  assert.equal(after(args, "--cacert"), "roots.pem"); // Node's roots, not the OS store
  assert.equal(after(args, "-w"), "%{http_code}");
  assert.ok(!args.includes("--data-binary"));
});

test("curl arguments never hold the URL, the signature or any signed header", () => {
  for (const args of [curlArgs(base), curlArgs({ ...base, bodyFile: "C:\\Temp\\body" })]) {
    const all = args.join(" ");
    assert.ok(!all.includes("r2.cloudflarestorage.com") && !all.includes("/b-1/k"), "no URL");
    assert.ok(!/authorization|AWS4-HMAC|Signature=|x-amz-/i.test(all), "no signed headers");
  }
});

test("curl config: method, URL and headers, each one quoted line", () => {
  const config = curlConfig({ method: "PUT", url: base.url, headers: signed });
  assert.equal(config.split("\n")[0], 'request = "PUT"');
  assert.equal(config.split("\n")[1], `url = "${base.url}"`);
  assert.ok(config.includes(`header = "authorization: ${signed.authorization}"\n`));
  assert.equal(config.split("\n").length, 2 + Object.keys(signed).length + 1);
  assert.equal(curlConfig({ method: "GET", url: base.url, headers: { "x-mock": 'a"b\\c' } }).split("\n")[2], 'header = "x-mock: a\\"b\\\\c"');
  assert.throws(() => curlConfig({ method: "GET", url: base.url, headers: { "x-amz-date": "1\r\nHost: evil" } }), /Bad header/);
  assert.throws(() => curlConfig({ method: "GET", url: `${base.url}\nurl = "https://evil.test/"`, headers: {} }), /Bad header/);
});

test("curl arguments: the body goes as a file, plain http only for 127.0.0.1 when allowed", () => {
  const put = curlArgs({ ...base, bodyFile: "C:\\Temp\\body" });
  assert.equal(after(put, "--data-binary"), "@C:\\Temp\\body");
  assert.ok(put.includes("Content-Type:") && put.includes("Expect:"));
  assert.equal(after(curlArgs({ ...base, url: "http://127.0.0.1:9000/b-1/k", allowHttp: true }), "--proto"), "=http");
  assert.equal(after(curlArgs({ ...base, url: "http://127.0.0.1:9000/b-1/k" }), "--proto"), "=https");
  assert.equal(after(curlArgs({ ...base, url: "http://127.0.0.1.evil.test/b-1/k", allowHttp: true }), "--proto"), "=https");
});

test("curl output: body, then the three-digit status", () => {
  assert.deepEqual(parseOutput(Buffer.from("<ok/>200")), { status: 200, body: Buffer.from("<ok/>") });
  assert.deepEqual(parseOutput(Buffer.from("204")), { status: 204, body: Buffer.alloc(0) });
  assert.equal(parseOutput(Buffer.from("000")), null);
  assert.equal(parseOutput(Buffer.from("20")), null);
});

// The real system curl against a local server, the way the fake R2 in npm run e2e is reached.
test("the system curl carries a request end to end, and leaves no temp file behind", { skip: !fs.existsSync(curlPath()) && "no system curl" }, async () => {
  const seen = [];
  const big = Buffer.alloc(2 * 1024 * 1024, 7);
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      if (req.url === "/big") return res.end(big); // chunked: no length for curl to check up front
      if (req.url === "/moved") return res.writeHead(302, { location: "/elsewhere" }).end();
      if (req.url === "/missing") return res.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>");
      res.end(req.method === "PUT" ? "" : "hello");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = (path, extra = {}) => carry({ method: "GET", url: `${origin}${path}`, headers: signed, maxBytes: 1024 * 1024, tooLarge: "too large", allowHttp: true, ...extra });
  const before = leftovers().length;
  try {
    const body = Buffer.from([0, 13, 10, 255, 26, 1, 2]); // binary survives the file untouched
    assert.equal((await send("/up", { method: "PUT", body })).status, 200);
    const put = seen.at(-1);
    assert.equal(put.method, "PUT");
    assert.ok(put.body.equals(body));
    assert.equal(put.headers.authorization, signed.authorization);
    assert.equal(put.headers["content-type"], undefined);

    await send("/quoted", { headers: { ...signed, "x-mock": 'a "quoted" \\ value' } });
    assert.equal(seen.at(-1).headers["x-mock"], 'a "quoted" \\ value');

    const got = await send("/down");
    assert.equal(got.status, 200);
    assert.equal(got.body.toString(), "hello");
    assert.equal((await send("/missing")).body.toString(), "<Error><Code>NoSuchKey</Code></Error>");
    assert.equal((await send("/gone", { method: "DELETE" })).status, 200);
    assert.equal(seen.at(-1).method, "DELETE");

    const count = seen.length;
    assert.equal((await send("/moved")).status, 302);
    assert.equal(seen.length, count + 1, "a redirect is never followed");

    await assert.rejects(send("/big"), /too large/);
    await assert.rejects(send("/down", { allowHttp: false }), /Could not reach R2/); // https only
    assert.equal(leftovers().length, before, "the roots and body files are deleted after every call");
  } finally {
    server.close();
  }
});

// A quit can cut a call off before its finally runs; the exit handler (cleanUp) must still stop curl
// and delete the roots and the encrypted body.
test("a call cut off by quitting leaves no temp file behind", { skip: !fs.existsSync(curlPath()) && "no system curl" }, async () => {
  const server = http.createServer(() => {}); // takes the upload, never answers
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const before = leftovers().length;
  try {
    const call = carry({ method: "PUT", url: `http://127.0.0.1:${server.address().port}/up`, headers: signed, body: Buffer.from("mock ciphertext"), maxBytes: 1000, tooLarge: "too large", allowHttp: true });
    for (let i = 0; i < 200 && leftovers().length < before + 2; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(leftovers().length, before + 2, "the roots and the body while in flight");
    cleanUp();
    assert.equal(leftovers().length, before, "both gone at once, before the call itself ends");
    await assert.rejects(call, /Could not reach R2/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

// Audit (SECURITY-AUDIT-2026-09-28.md, Info: courier temp files): a hard kill or a power cut skips every
// cleanup, and a body left in the temp folder is the vault as it was that day. Start sweeps only
// what no call could still be using.
test("start sweeps courier files older than any call; a fresh one (another run's upload) stays", () => {
  const { sweepStale } = require("./courier.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-sweep-"));
  const old = path.join(dir, `${TEMP_PREFIX}old.body`);
  const fresh = path.join(dir, `${TEMP_PREFIX}fresh.body`);
  const other = path.join(dir, "not-ours.body");
  for (const f of [old, fresh, other]) fs.writeFileSync(f, "ciphertext");
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
  fs.utimesSync(old, twoHoursAgo, twoHoursAgo);
  fs.utimesSync(other, twoHoursAgo, twoHoursAgo);
  sweepStale(Date.now(), dir);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true);
  assert.equal(fs.existsSync(other), true, "only the courier's own names");
  fs.rmSync(dir, { recursive: true, force: true });
});
