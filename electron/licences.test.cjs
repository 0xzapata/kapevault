const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { register, licencePaths, readLicences, MAX_BYTES } = require("./ipc/licences.cjs");

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-licences-"));
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const NAMES = ["LICENSE", "LICENSE-EXCEPTION", "NOTICE", "THIRD-PARTY-NOTICES"];

// The handlers as main registers them: handle() collects the channel functions.
function handlers(deps) {
  const map = {};
  register({ handle: (channel, fn) => (map[channel] = fn), ...deps });
  return map;
}

test("unpacked: repo-root texts plus dist/legal notices, in a fixed order, taking no argument", () => {
  const root = tempDir();
  write(root, "LICENSE", "gpl text\r\nline two");
  write(root, "LICENSE-EXCEPTION", "exception");
  write(root, "NOTICE", "notice");
  write(root, "dist/legal/THIRD-PARTY-NOTICES.txt", "third party");
  const h = handlers({ app: { isPackaged: false, getVersion: () => "1.2.3" }, resourcesPath: "/nowhere", root });
  const got = h["app:licences"]("../../etc/passwd"); // an argument from the page changes nothing
  assert.deepEqual(got.map((l) => l.name), NAMES);
  assert.equal(got[0].text, "gpl text\nline two");
  assert.equal(got[3].text, "third party");
  assert.equal(h["app:version"](), "1.2.3");
});

test("packaged: reads resources/legal and ignores the repo root", () => {
  const resourcesPath = tempDir();
  const root = tempDir();
  write(root, "LICENSE", "the wrong one");
  for (const f of ["LICENSE", "LICENSE-EXCEPTION", "NOTICE", "THIRD-PARTY-NOTICES.txt"]) write(resourcesPath, `legal/${f}`, `packaged ${f}`);
  const h = handlers({ app: { isPackaged: true, getVersion: () => "1.2.3" }, resourcesPath, root });
  const got = h["app:licences"]();
  assert.deepEqual(got.map((l) => l.text), ["packaged LICENSE", "packaged LICENSE-EXCEPTION", "packaged NOTICE", "packaged THIRD-PARTY-NOTICES.txt"]);
});

test("a missing file is skipped, not an error", () => {
  const root = tempDir();
  write(root, "LICENSE", "only this");
  const got = readLicences(licencePaths({ packaged: false, resourcesPath: "/nowhere", root }));
  assert.deepEqual(got, [{ name: "LICENSE", text: "only this" }]);
});

test("a file over the cap is skipped", () => {
  const root = tempDir();
  write(root, "LICENSE", "x".repeat(MAX_BYTES + 1));
  write(root, "NOTICE", "small");
  const got = readLicences(licencePaths({ packaged: false, resourcesPath: "/nowhere", root }));
  assert.deepEqual(got.map((l) => l.name), ["NOTICE"]);
});

test("the real repo texts are readable from the unpacked tree", () => {
  const got = readLicences(licencePaths({ packaged: false, resourcesPath: "/nowhere", root: path.join(__dirname, "..") }));
  for (const name of ["LICENSE", "LICENSE-EXCEPTION", "NOTICE"]) assert.ok((got.find((l) => l.name === name)?.text.length ?? 0) > 100, name);
});
