// Audit run-1 4.7: one malformed non-login item (a null row in history or recoveryCodes) must not stop the
// Forever Opener showing the rest of the vault. The page's own script runs on a minimal stand-in DOM,
// as in opener-sync.test.cjs; the opener sources are only read.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
      return { firstChild: element() };
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

function render(data) {
  const page = fs.readFileSync(path.join(__dirname, "opener", "opener-page.js"), "utf8");
  const byId = new Map();
  const document = { getElementById: (id) => byId.get(id) ?? byId.set(id, element()).get(id), createElement: element, querySelectorAll: () => [], addEventListener() {} };
  const context = vm.createContext({ document, MessageChannel, performance, setTimeout: () => 0, clearTimeout() {}, navigator: {} });
  vm.runInContext(page, context);
  context.data = data;
  vm.runInContext('picked = { name: "mock.kapevault" }; showVault(data);', context);
  const text = (node) => [node.textContent, ...node.children.map(text)].join("|");
  return {
    count: document.getElementById("list-count").textContent,
    items: document.getElementById("items").children.map(text),
  };
}

const vault = (bad) => ({
  spaces: [{ id: "s1", name: "Test Space", kind: "personal" }],
  entries: [
    { id: "a", kind: "login", spaceId: "s1", title: "Test Login A", username: "test.user", password: "mock-pass" },
    { id: "bad", kind: "note", spaceId: "s1", title: "Test Bad Note", ...bad },
    { id: "c", kind: "login", spaceId: "s1", title: "Test Login C", username: "test.other" },
  ],
});

for (const [name, bad] of [
  ["a null history row", { history: [null] }],
  ["a null recoveryCodes row", { recoveryCodes: { codes: [null] } }],
  ["a null printed-copy row", { recoveryCodes: { codes: [], paper: [null] } }],
]) {
  test(`the Opener still shows every other item when one item has ${name}`, () => {
    const shown = render(vault(bad));
    assert.equal(shown.count, "3 items");
    assert.equal(shown.items.length, 3);
    assert.ok(shown.items.some((t) => t.includes("Test Login A")));
    assert.ok(shown.items.some((t) => t.includes("Test Login C")));
    assert.ok(shown.items.some((t) => t.includes("Test Bad Note")));
  });
}

test("an item that cannot be shown at all gets a short fallback row and the rest render", () => {
  const evil = { id: "evil", kind: "note", spaceId: "s1", title: "Test Evil", get body() { throw new Error("boom"); } };
  const data = vault({});
  data.entries.push(evil);
  const shown = render(data);
  assert.equal(shown.items.length, 4);
  assert.ok(shown.items.some((t) => t.includes("Test Login A")));
  assert.ok(shown.items.some((t) => t.includes("could not be shown")));
});
