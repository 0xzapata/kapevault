const test = require("node:test");
const assert = require("node:assert/strict");
const { kitHtml } = require("./emergency-kit.cjs");

const BUCKET = "https://0123abcd.r2.cloudflarestorage.com/mock-bucket";
const base = {
  createdAt: new Date(2026, 8, 25, 9, 30),
  vaultPath: "C:\\Users\\mock.user\\AppData\\Roaming\\KAPEVault\\vault.kapevault",
  itemCount: 42,
  appVersion: "0.1.0",
  openerSha256: "0123abcd4567ef0123456789abcdef0123456789abcdef0123456789abcdef01",
  cloud: { url: BUCKET, accessKeyId: "mock-key-id-1234" },
};

test("every interpolated value is HTML-escaped", () => {
  const html = kitHtml({
    ...base,
    vaultPath: `D:\\<script>alert(1)</script> "Tom & Jerry's"`,
    appVersion: "<b>1</b>",
    cloud: { url: `${BUCKET}?a=1&b="x"`, accessKeyId: "<id>", secretAccessKey: "s&<'>" },
  });
  assert.ok(!html.includes("<script"), "script tag must never appear unescaped");
  assert.ok(html.includes("D:\\&lt;script&gt;alert(1)&lt;/script&gt; &quot;Tom &amp; Jerry&#39;s&quot;"));
  assert.ok(html.includes("KAPEVault &lt;b&gt;1&lt;/b&gt;"));
  assert.ok(html.includes(`${BUCKET}?a=1&amp;b=&quot;x&quot;`));
  assert.ok(html.includes("&lt;id&gt;"));
  assert.ok(html.includes("s&amp;&lt;&#39;&gt;"));
});

test("the secret key appears only when provided", () => {
  const withSecret = kitHtml({ ...base, cloud: { ...base.cloud, secretAccessKey: "mock-secret-9876" } });
  assert.ok(withSecret.includes("mock-secret-9876"));
  assert.ok(!withSecret.includes("Secret key not printed"));

  const without = kitHtml(base);
  assert.ok(!without.includes("mock-secret-9876"));
  assert.ok(without.includes("Secret key not printed"));
  assert.ok(without.includes("mock-key-id-1234"));
});

test("no cloud shows Not set up and no bucket details", () => {
  const html = kitHtml({ ...base, cloud: null });
  assert.ok(html.includes("Not set up. Turn it on in Settings &gt; Backup"));
  assert.ok(!html.includes("r2.cloudflarestorage.com"));
  assert.ok(!html.includes("Access key ID"));
});

test("no external resources: the only URL is the user's own bucket", () => {
  const urls = (html) => html.match(/(?:https?:)?\/\/[^\s"'<>)]+/gi) || [];
  assert.deepEqual(urls(kitHtml(base)), [BUCKET]);
  assert.deepEqual(urls(kitHtml({ ...base, cloud: null })), []);
  const html = kitHtml(base);
  assert.ok(!/<script|<link|@import|src=|url\(/i.test(html), "no scripts, links, imports, src or url()");
});

test("date, item count and version are rendered", () => {
  const html = kitHtml(base);
  assert.ok(html.includes("Created 25 September 2026 for 42 items - KAPEVault 0.1.0"));
  assert.ok(kitHtml({ ...base, itemCount: 1 }).includes("for 1 item -"));
  assert.ok(html.includes("vault.kapevault"));
});

test("the kit says where the Forever Opener is and that it needs only a browser", () => {
  const html = kitHtml(base);
  assert.ok(html.includes("KAPEVault Opener.html"));
  assert.ok(html.includes("opens a vault file in any web browser, offline"));
  assert.ok(html.includes("kapevault/opener/ folder (use the newest page)"), "points at the folder and the newest page, not a version that gets deleted");
  assert.ok(!html.includes("kapevault-opener-0.1.0.html"));
  assert.ok(!kitHtml({ ...base, cloud: null }).includes("in your bucket"), "no bucket, no bucket line");
});

// Audit finding L8 (SECURITY-AUDIT-2026-09-28.md): anyone with the R2 keys can swap the page in the bucket;
// 16 digits was too little to check.
test("the kit prints the Opener's whole SHA-256, so a changed page can be told apart", () => {
  const html = kitHtml(base);
  assert.ok(html.includes(`SHA-256 is <span class="mono">0123abcd 4567ef01 23456789 abcdef01 23456789 abcdef01 23456789 abcdef01</span>`));
});

test("no emdash anywhere in the page", () => {
  assert.ok(!kitHtml(base).includes("\u2014"));
});
