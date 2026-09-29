const test = require("node:test");
const assert = require("node:assert/strict");
const { evacuationHtml } = require("./evacuation.cjs");

const things = [
  { title: "Mock Spare keys", room: "Kitchen", spot: "hook by the back door", grab: 2 },
  { title: "Mock PSA birth certificate", room: "Bedroom", spot: "blue folder, top shelf of the bedroom cabinet", grab: 1 },
  { title: "Mock Passport", room: "bedroom", spot: "same blue folder", grab: 1 },
  { title: "Mock Photo albums", room: "Sala", spot: "bottom shelf", grab: 3 },
  { title: "Mock YubiKey", room: "", spot: "on my key ring", grab: 1 },
  { title: "Mock Land title", room: "Attic", spot: "tin box", grab: 1 },
];
const createdAt = new Date(2026, 8, 26, 9, 0);

test("every interpolated value is HTML-escaped", () => {
  const html = evacuationHtml({ createdAt, things: [{ title: `<script>alert(1)</script>`, room: `Tom & Jerry's "room"`, spot: "a<b>&'\"", grab: 1 }] });
  assert.ok(!html.includes("<script"), "script tag must never appear unescaped");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("Tom &amp; Jerry&#39;s &quot;room&quot;"));
  assert.ok(html.includes("a&lt;b&gt;&amp;&#39;&quot;"));
});

test("grouped by priority in grab order; things to leave get no tick box", () => {
  const html = evacuationHtml({ createdAt, things });
  const at = (text) => html.indexOf(text);
  assert.ok(at("<h2>Grab first</h2>") < at("Mock Land title") && at("Mock YubiKey") < at("<h2>If there is time</h2>"));
  assert.ok(at("<h2>If there is time</h2>") < at("Mock Spare keys") && at("Mock Spare keys") < at("<h2>Leave it</h2>"));
  assert.equal(html.match(/class="box"/g).length, 5, "one tick box per thing to grab");
  assert.ok(html.includes("6 things, grab first at the top. Printed 26 September 2026."));
  assert.ok(!evacuationHtml({ createdAt, things: things.slice(0, 1) }).includes("Grab first</h2>"), "an empty group is left out");
  assert.ok(evacuationHtml({ createdAt, things: [] }).includes("No things saved yet."));
});

test("an ID's expiry prints under its title; a thing without one prints no line", () => {
  const html = evacuationHtml({ createdAt, things: [{ ...things[2], expires: "2031-04-30" }, things[0]] });
  assert.ok(html.includes(`<div class="title">Mock Passport<span class="expires">Expires 2031-04-30</span></div>`));
  assert.equal(html.match(/class="expires"/g).length, 1);
});

test("no scripts, links or external resources, no emdash, rows never split", () => {
  const html = evacuationHtml({ createdAt, things });
  assert.ok(!/<script|<link|@import|src=|url\(|https?:/i.test(html));
  assert.ok(!html.includes("\u2014"));
  assert.ok(html.includes("break-inside: avoid"));
});

// A newer version's grab (0, 4) prints under "if there is time" - it used to be counted but left off the list.
test("a grab this version does not know still prints, with the if-there-is-time group", () => {
  const html = evacuationHtml({ createdAt, things: [...things, { title: "Mock Later grab", room: "", spot: "drawer", grab: 4 }] });
  assert.ok(html.includes("Mock Later grab"));
});
