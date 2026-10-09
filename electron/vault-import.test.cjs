const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createVaultSession } = require("./vault-session.cjs");

async function freshVault() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-test-")), "vault.kapevault");
  const vault = createVaultSession(file);
  await vault.create("correct horse battery orbit gazelle");
  return { file, vault };
}

const ITEMS = [
  { space: "Acme Client", kind: "login", title: "Canva", username: "team@acme.test", signIn: "google", via: "Acme Google" },
  { space: "Acme Client", kind: "login", title: "Acme Google", username: "team@acme.test", password: "imported-pw-1", url: "https://mail.google.com" },
  { space: "Acme Client", kind: "link", title: "Client folder", linkType: "folder", location: "C:\\Clients\\Acme", tags: ["client"] },
];

test("import creates the client, adds items, links OAuth logins by title, and keeps passwords main-side", async () => {
  const { file, vault } = await freshVault();
  const result = vault.importEntries(ITEMS);
  assert.equal(result.added, 3);
  assert.equal(result.skipped, 0);
  const space = result.vault.spaces.find((s) => s.name === "Acme Client");
  assert.equal(space.kind, "client");
  const byTitle = Object.fromEntries(result.vault.entries.map((e) => [e.title, e]));
  assert.equal(byTitle.Canva.viaEntryId, byTitle["Acme Google"].id, "via resolves even when the target comes later");
  assert.equal(byTitle["Acme Google"].hasPassword, true);
  assert.equal(vault.getPassword(byTitle["Acme Google"].id), "imported-pw-1");
  assert.ok(!JSON.stringify(result.vault).includes("imported-pw-1"));
  assert.ok(!fs.readFileSync(file, "utf8").includes("imported-pw-1"));
});

test("importing the same file twice adds nothing; an existing client is reused by name", async () => {
  const { vault } = await freshVault();
  vault.importEntries(ITEMS);
  const again = vault.importEntries(ITEMS.map((i) => ({ ...i, space: "acme client" })));
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 3);
  assert.equal(again.vault.spaces.filter((s) => s.name.toLowerCase() === "acme client").length, 1);
});

test("a bad item rolls back the whole import", async () => {
  const { vault } = await freshVault();
  assert.throws(() => vault.importEntries([ITEMS[2], { space: "Other", kind: "login", title: "" }]), /Item 2 has no title/);
  const view = vault.publicView();
  assert.equal(view.entries.length, 0);
  assert.deepEqual(view.spaces.map((s) => s.name), ["Personal"]);
  assert.throws(() => vault.importEntries([]), /no items/);
});

test("fields that would be silently blanked stop the import instead", async () => {
  const { vault } = await freshVault();
  const cases = [
    [{ kind: "Login", title: "A" }, /kind must be/],
    [{ title: "A" }, /kind must be/],
    [{ kind: "login", title: "A", password: 123456 }, /password must be text/],
    [{ kind: "link", title: "A", location: ["x"] }, /location must be text/],
    [{ kind: "login", title: "A", tags: "one" }, /tags must be a list/],
    [{ kind: "login", title: "A", signIn: "okta" }, /unknown signIn/],
    [{ kind: "link", title: "A", linkType: "ftp" }, /unknown linkType/],
    [null, /not an entry/],
  ];
  for (const [item, message] of cases) assert.throws(() => vault.importEntries([ITEMS[2], item]), message);
  assert.equal(vault.publicView().entries.length, 0, "nothing from the good item either");
});

test("an item with no space goes to the personal space, even if it was renamed", async () => {
  const { vault } = await freshVault();
  const result = vault.importEntries([{ kind: "link", title: "Loose link", linkType: "web", location: "https://example.com" }]);
  const personal = result.vault.spaces.find((s) => s.kind === "personal");
  assert.equal(result.vault.entries[0].spaceId, personal.id);
  assert.equal(result.vault.spaces.length, 1);
});

test("an import cannot link a network folder, a whole drive or the home folder", async () => {
  const { vault } = await freshVault();
  const drive = path.parse(process.cwd()).root;
  const cases = [
    [{ kind: "link", title: "Share", linkType: "folder", location: "\\\\attacker.example\\docs" }, /network folders/],
    [{ kind: "link", title: "Share", linkType: "folder", location: "//attacker.example/docs" }, /network folders/],
    [{ kind: "link", title: "Drive", linkType: "folder", location: drive }, /whole drive or home/],
    [{ kind: "link", title: "Home", linkType: "folder", location: os.homedir() }, /whole drive or home/],
    [{ kind: "link", title: "Home", linkType: "folder", location: os.homedir().toLowerCase() }, /whole drive or home/],
    [{ kind: "link", title: "Users", linkType: "folder", location: path.dirname(os.homedir()) }, /whole drive or home/],
    [{ kind: "link", title: "Users", linkType: "folder", location: path.join(os.homedir(), "..") }, /whole drive or home/],
  ];
  for (const [item, message] of cases) assert.throws(() => vault.importEntries([item]), message);
  assert.equal(vault.publicView().entries.length, 0);
});

test("a huge import is refused before any work", async () => {
  const { vault } = await freshVault();
  const items = Array.from({ length: 5001 }, (_, i) => ({ kind: "note", title: `n${i}` }));
  assert.throws(() => vault.importEntries(items), /up to 5000/);
});

test("only folder links open the file browser", async () => {
  const { vault } = await freshVault();
  const folder = path.resolve("/Clients/Acme"); // a path native to the OS running the test
  vault.importEntries([
    { kind: "link", title: "Folder", linkType: "folder", location: folder },
    { kind: "link", title: "Doc", linkType: "doc", location: path.join(folder, "contract.pdf") },
  ]);
  assert.deepEqual(vault.linkedFolders(), [folder]);
});

test("Open targets: a bare domain is a website, a folder link is a path", async () => {
  const { vault } = await freshVault();
  const { vault: view } = vault.importEntries([
    { kind: "login", title: "Google", url: "accounts.google.com" },
    { kind: "login", title: "GitHub", url: "https://github.com" },
    { kind: "link", title: "Drive", linkType: "drive", location: "drive.google.com/drive/x" },
    { kind: "link", title: "Folder", linkType: "folder", location: "C:\\Clients\\Acme" },
    { kind: "note", title: "Codes" },
  ]);
  const target = (title) => vault.openTarget(view.entries.find((e) => e.title === title).id);
  assert.deepEqual(target("Google"), { kind: "url", target: "https://accounts.google.com" });
  assert.deepEqual(target("GitHub"), { kind: "url", target: "https://github.com" });
  assert.deepEqual(target("Drive"), { kind: "url", target: "https://drive.google.com/drive/x" });
  assert.deepEqual(target("Folder"), { kind: "path", target: "C:\\Clients\\Acme" });
  assert.throws(() => target("Codes"), /no link/);
});

// A link path can name the home folder (or an ancestor of it) without its name: a junction, or a
// Windows 8.3 short name. Both must be judged by where they lead.
test("an import cannot reach the home folder through a junction or a short name", { skip: process.platform !== "win32" && "Windows only" }, async (t) => {
  const { vault } = await freshVault();
  const link = (title, location) => [{ kind: "link", title, linkType: "folder", location }];
  const docs = "C:\\Documents and Settings"; // Windows' own junction to C:\Users
  if (fs.existsSync(docs)) assert.throws(() => vault.importEntries(link("Docs", docs)), /whole drive or home/);

  // A stand-in home, so no link to the real one is ever made.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-home-"));
  const home = path.join(root, "Mock Long Home Folder");
  fs.mkdirSync(home);
  t.mock.method(os, "homedir", () => home);
  const junction = path.join(root, "Mock Junction");
  fs.symlinkSync(home, junction, "junction");
  try {
    assert.throws(() => vault.importEntries(link("Junction", junction)), /whole drive or home/);
    assert.throws(() => vault.importEntries(link("Junction", path.join(junction, "missing", ".."))), /whole drive or home/);
    const short = execFileSync("cmd.exe", ["/d", "/s", "/c", `for %I in ("${home}") do @echo %~sI`], { encoding: "utf8", windowsVerbatimArguments: true }).trim();
    if (short.toLowerCase() !== home.toLowerCase()) assert.throws(() => vault.importEntries(link("Short", short)), /whole drive or home/);
    else t.diagnostic("8.3 names are off on this drive; the short-name case was not checked");
    // A folder inside home, or one that does not exist yet, is still fine.
    assert.equal(vault.importEntries(link("Inside", path.join(junction, "Clients", "Mock Acme"))).added, 1);
  } finally {
    fs.unlinkSync(junction); // the link only, never what it points at
  }
});
