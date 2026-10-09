import test from "node:test";
import assert from "node:assert/strict";
import { MAX_DEPTH, cleanVault } from "./clean-vault.js";
import { publicView } from "./public-view.js";
import { keySaltMatches, withKeySalt } from "./key-salt.js";

const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64")}`;
const vault = (entries, extra = {}) => ({ spaces: [{ id: "personal", name: "Personal", kind: "personal" }], entries, ...extra });
const login = { id: "e1", kind: "login", spaceId: "personal", title: "Mock mail", username: "mock@example.com", password: "Mock-Pass-1" };

test("a vault KAPEVault wrote comes back unchanged", () => {
  const good = vault(
    [
      { ...login, tags: ["work"], favorite: true, history: [{ password: "old", changedAt: "2026-01-01" }], questions: [{ question: "Pet?", answer: "Mock" }], recoveryCodes: { codes: [{ code: "a1", used: false }], setAt: "2026-01-01", paper: [{ where: "Drawer", printedAt: "2026-01-02" }] }, lifecycle: { state: "dormant" } },
      { id: "e2", kind: "device", spaceId: "personal", title: "Mock router", type: "router", adminPassword: "x", photo: JPEG },
      { id: "e3", kind: "id", spaceId: "personal", title: "Mock ID", idType: "Passport", idNumber: "P123", photo: JPEG },
      { id: "e4", kind: "thing", spaceId: "personal", title: "Mock box", spot: "Closet", grab: 1 },
    ],
    { sync: { v: 1 }, cloud: { endpoint: "https://x.r2.cloudflarestorage.com", bucket: "vault-backups", accessKeyId: "k", secretAccessKey: "s", auto: true }, keySalt: "c2FsdA==" },
  );
  assert.deepEqual(cleanVault(structuredClone(good)), good);
});

test("a malformed field is dropped, so the page's view never throws (the reviewer's probe)", () => {
  const bad = vault([{ ...login, questions: "boom", recoveryCodes: { codes: 5 }, history: [{ password: 1 }, { password: "kept", changedAt: "2026-01-01" }], tags: ["ok", 3], signIn: 7 }]);
  assert.throws(() => publicView(bad, new Map()), "the raw vault breaks the view");
  const clean = cleanVault(bad);
  const [e] = clean.entries;
  assert.equal(e.questions, undefined);
  assert.equal(e.recoveryCodes, undefined);
  assert.deepEqual(e.history, [{ password: "kept", changedAt: "2026-01-01" }]);
  assert.deepEqual(e.tags, ["ok"]);
  assert.equal(e.signIn, undefined);
  assert.doesNotThrow(() => publicView(clean, new Map()));
});

test("a photo that is not a JPEG data URL never survives (file://host would offer the NTLM hash)", () => {
  for (const photo of ["file://attacker/share/x.jpg", "https://evil.example/x.jpg", "data:image/svg+xml;base64,PHN2Zz4=", `data:image/jpeg;base64,${Buffer.from("GIF89a").toString("base64")}`, 42]) {
    const [device, id] = cleanVault(vault([{ id: "d", kind: "device", spaceId: "personal", title: "t", photo }, { id: "i", kind: "id", spaceId: "personal", title: "t", photo }])).entries;
    assert.equal(device.photo, undefined, String(photo));
    assert.equal(id.photo, undefined, String(photo));
  }
});

test("items without a usable id or kind are dropped, and an id appears once", () => {
  const ids = cleanVault(vault([login, { ...login, title: "second copy" }, { kind: "note", id: "__proto__" }, { kind: "note", id: "constructor" }, { kind: "note", id: "" }, { kind: 3, id: "n" }, null, "x", { id: "x".repeat(200), kind: "note" }])).entries.map((e) => e.id);
  assert.deepEqual(ids, ["e1"]);
});

test("a __proto__ key never pollutes anything", () => {
  const parsed = JSON.parse(`{"spaces":[],"entries":[{"id":"n","kind":"note","__proto__":{"polluted":true},"body":"x"}],"__proto__":{"polluted":true}}`);
  const clean = cleanVault(parsed);
  assert.equal({}.polluted, undefined);
  assert.equal(clean.entries[0].polluted, undefined);
  assert.equal(Object.hasOwn(clean, "__proto__"), false);
});

test("a vault nested deeper than any KAPEVault writes is refused, without recursion", () => {
  let deep = {};
  const root = deep;
  for (let i = 0; i < 200_000; i++) deep = deep.x = {};
  assert.throws(() => cleanVault(vault([{ ...login, extra: root }])), /damaged/);
  let ok = {};
  const shallow = ok;
  for (let i = 0; i < MAX_DEPTH - 4; i++) ok = ok.x = {};
  assert.doesNotThrow(() => cleanVault(vault([{ ...login, extra: shallow }])));
});

test("something that is not a vault at all is refused", () => {
  for (const v of [null, [], "x", { entries: "x", spaces: [] }, { entries: [] }, { spaces: [], entries: {} }]) assert.throws(() => cleanVault(v), /damaged/);
});

// A value this version does not know is a newer device's, never junk: dropped, repair() stamped the
// drop as this device's edit and sync deleted it everywhere (review of the audit fixes, 2026-09-29).
test("a newer version's values of known fields are kept; only a wrong type is dropped", () => {
  const newer = {
    login: { signIn: "passkey", lifecycle: { state: "archived" } },
    link: { linkType: "vault" },
    device: { type: "printer" },
    thing: { grab: 4 },
  };
  const entries = Object.entries(newer).map(([kind, fields], i) => ({ id: `n${i}`, kind, spaceId: "personal", title: "Mock", ...fields }));
  assert.deepEqual(cleanVault(vault(structuredClone(entries))).entries, entries);
});

test("fields of a kind this version does not know, and of a newer item kind, are kept", () => {
  const [e, future] = cleanVault(vault([{ ...login, laterField: { a: 1 } }, { id: "f", kind: "passkey", spaceId: "personal", title: "Later", credential: "abc" }])).entries;
  assert.deepEqual(e.laterField, { a: 1 });
  assert.equal(future.credential, "abc");
});

test("keySalt: only the salt a master password opened matches", () => {
  const data = withKeySalt(vault([]), "AAAA");
  assert.equal(keySaltMatches(data, "AAAA"), true);
  assert.equal(keySaltMatches(data, "BBBB"), false);
  assert.equal(keySaltMatches(vault([]), "AAAA"), false, "a vault never opened by a master password since this version");
  assert.equal(withKeySalt(data, "AAAA"), data, "unchanged object when already marked");
});

// Editing on an older device keeps a newer version's value the edit left alone (review 2026-09-29).
test("an edit that leaves a newer version's value as it was keeps it", async () => {
  const { upsertEntry } = await import("./entries.js");
  const data = vault([
    { id: "l", kind: "login", spaceId: "personal", title: "Mock", signIn: "passkey", password: "", url: "" },
    { id: "k", kind: "link", spaceId: "personal", title: "Mock", linkType: "vault", location: "x" },
    { id: "t", kind: "thing", spaceId: "personal", title: "Mock", spot: "Drawer", grab: 4 },
    { id: "d", kind: "device", spaceId: "personal", title: "Mock", type: "printer" },
  ]);
  for (const e of structuredClone(data.entries)) upsertEntry(data, { ...e, title: "Renamed" });
  assert.deepEqual(data.entries.map((e) => [e.signIn ?? e.linkType ?? e.grab ?? e.type]), [["passkey"], ["vault"], [4], ["printer"]]);
  assert.throws(() => upsertEntry(data, { id: "t", kind: "thing", spaceId: "personal", title: "Mock", spot: "Drawer", grab: 5 }), /Grab must be/);
});

test("a cloud block that does not point at an R2 bucket is dropped, so a hostile backup cannot redirect the uploads", () => {
  const cloud = { endpoint: "https://0123abcd.r2.cloudflarestorage.com", bucket: "vault-backups", accessKeyId: "k", secretAccessKey: "s", auto: true };
  assert.deepEqual(cleanVault(vault([], { cloud })).cloud, cloud);
  for (const bad of [
    { ...cloud, endpoint: "https://evil.example" },
    { ...cloud, endpoint: "http://0123abcd.r2.cloudflarestorage.com" },
    { ...cloud, endpoint: "https://0123abcd.r2.cloudflarestorage.com.evil.example" },
    { ...cloud, bucket: "../x" },
    { ...cloud, accessKeyId: 5 },
    { ...cloud, secretAccessKey: undefined },
    "https://evil.example",
  ]) assert.equal("cloud" in cleanVault(vault([], { cloud: bad })), false, JSON.stringify(bad));
  assert.equal("cloud" in cleanVault(vault([])), false, "no cloud stays no cloud");
});
