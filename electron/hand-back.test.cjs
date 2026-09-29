const test = require("node:test");
const assert = require("node:assert/strict");
const { handBackHtml } = require("./hand-back.cjs");

const items = [
  {
    title: "Mock Bank",
    space: "Personal",
    rows: [
      { label: "Website", value: "https://bank.example.com", secret: false },
      { label: "Username", value: "mock.lola", secret: false },
      { label: "Password", value: "mock-secret-pass-1", secret: true },
    ],
  },
  { title: "Mock Wi-Fi", space: "", rows: [] },
];
const base = { person: "Mock Lola", createdAt: new Date(2026, 8, 26, 9, 0), items };

test("every interpolated value is HTML-escaped", () => {
  const html = handBackHtml({
    person: `<script>alert(1)</script>`,
    createdAt: base.createdAt,
    withSecrets: true,
    items: [{ title: `Tom & Jerry's "bank"`, space: "<b>x</b>", rows: [{ label: "<i>L</i>", value: "a<b>&'\"", secret: true }] }],
  });
  assert.ok(!html.includes("<script"), "script tag must never appear unescaped");
  assert.ok(html.includes("For &lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("Tom &amp; Jerry&#39;s &quot;bank&quot;"));
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(html.includes("&lt;i&gt;L&lt;/i&gt;"));
  assert.ok(html.includes("a&lt;b&gt;&amp;&#39;&quot;"));
});

test("secrets print only when ticked, even if the caller handed them in", () => {
  const without = handBackHtml({ ...base, withSecrets: false });
  assert.ok(!without.includes("mock-secret-pass-1"));
  assert.ok(!without.includes(">Password<"));
  assert.ok(without.includes("Passwords are not on this page."));
  assert.ok(without.includes("mock.lola"), "plain rows still print");

  const withSecrets = handBackHtml({ ...base, withSecrets: true });
  assert.ok(withSecrets.includes("mock-secret-pass-1"));
  assert.ok(withSecrets.includes("This page holds passwords."));
  assert.ok(!withSecrets.includes("Passwords are not on this page."));
});

test("names the person, the count and the date; an empty item says so", () => {
  const html = handBackHtml({ ...base, withSecrets: false });
  assert.ok(html.includes("<h1>For Mock Lola</h1>"));
  assert.ok(html.includes("2 items kept in KAPEVault, handed back 26 September 2026"));
  assert.ok(handBackHtml({ ...base, items: [items[0]], withSecrets: false }).includes("1 item kept"));
  assert.ok(html.includes("Nothing else saved."));
});

test("no scripts or external resources, no emdash, items never split across sheets", () => {
  const html = handBackHtml({ ...base, withSecrets: true });
  assert.ok(!/<script|<link|@import|src=|url\(/i.test(html));
  assert.deepEqual(html.match(/(?:https?:)?\/\/[^\s"'<>)]+/gi), ["https://bank.example.com"]);
  assert.ok(!html.includes("\u2014"));
  assert.ok(html.includes("break-inside: avoid"));
});
