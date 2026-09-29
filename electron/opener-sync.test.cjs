// SYNC.md 3.11 check 1: the Forever Opener reads a vault with `sync` exactly as it reads the same vault
// without it - every row, count and field. The page's own script runs here on a minimal stand-in DOM;
// the opener sources are only read, never changed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { openVault } = require("./opener/opener-crypto.cjs");
const { createVaultSession } = require("./vault-session.cjs");

const MASTER = "mock master pass phrase";
const INSTALL = "0b8c8e52-1b7e-4d8e-9a53-6f0c1d2e3f40";

function element() {
  const attributes = {};
  return {
    children: [],
    textContent: "",
    value: "",
    hidden: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle: () => false },
    get content() {
      return { firstChild: element() }; // a <template>'s icon
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    setAttribute: (name, value) => (attributes[name] = value),
    getAttribute: (name) => attributes[name] ?? null,
    addEventListener() {},
    focus() {},
  };
}

// What the page shows for a vault: the space list with counts, then every row's search text and fields.
function render(data) {
  const page = fs.readFileSync(path.join(__dirname, "opener", "opener-page.js"), "utf8");
  const byId = new Map();
  const document = { getElementById: (id) => byId.get(id) ?? byId.set(id, element()).get(id), createElement: element, querySelectorAll: () => [], addEventListener() {} };
  // No timers: the page's five-minute auto-close would keep the test process alive.
  const context = vm.createContext({ document, MessageChannel, performance, setTimeout: () => 0, clearTimeout() {}, navigator: {} });
  vm.runInContext(page, context);
  context.data = data;
  vm.runInContext('picked = { name: "mock.kapevault" }; showVault(data);', context);
  const text = (node) => [node.textContent, ...node.children.map(text)].join("|");
  return {
    spaces: document.getElementById("spaces").children.map(text),
    count: document.getElementById("list-count").textContent,
    // As JSON: objects from the page's own realm never deep-equal ones from another.
    rows: JSON.parse(vm.runInContext("JSON.stringify(rows.map((r) => ({ id: r.entry.id, text: r.text, fields: fieldsOf(r.entry) })))", context)),
  };
}

test("a vault with sync metadata and tombstones reads in the Opener exactly as it does without", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-opener-sync-"));
  const file = path.join(dir, "vault.kapevault");
  const vault = createVaultSession(file, { installId: () => INSTALL });
  const personal = (await vault.create(MASTER)).vault.spaces[0].id;
  const { id: client } = vault.addSpace("Mock Client");
  const { id: portal } = vault.saveEntry({ kind: "login", spaceId: personal, title: "Mock Portal", username: "mock.user", password: "Mock-Pass-1", url: "https://portal.example.com" });
  vault.saveEntry({ kind: "login", spaceId: client, title: "Mock Client CRM", username: "mock.va", password: "Mock-Pass-2", signIn: "google", viaEntryId: portal });
  vault.saveEntry({ kind: "note", spaceId: personal, title: "Mock note", body: "Mock body text" });
  vault.saveEntry({ kind: "payee", spaceId: personal, title: "Mock Tita GCash", who: "Mock Tita", provider: "GCash", number: "09171234567" });
  for (const title of ["Mock gone 1", "Mock gone 2"]) vault.deleteEntry(vault.saveEntry({ kind: "note", spaceId: client, title, body: "x" }).id);
  vault.lock();

  const data = await openVault(JSON.parse(fs.readFileSync(file, "utf8")), MASTER);
  assert.equal(Object.keys(data.sync.gone).length, 2, "two tombstones");
  assert.ok(Object.keys(data.sync.meta).length >= 5, "stamped items");
  const { sync, ...withoutSync } = data;
  const shown = render(data);
  assert.deepEqual(shown, render(withoutSync));
  assert.equal(shown.rows.length, 4);
  assert.equal(shown.count, "4 items");
  assert.ok(shown.rows.every((r) => r.fields.length > 0), "every row's fields were read");
  assert.ok(!JSON.stringify(shown).includes(INSTALL), "nothing from sync reaches a row");
});
