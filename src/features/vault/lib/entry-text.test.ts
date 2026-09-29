// Run with `npm test` (Node strips the types). How an item is named in the detail pane, and which
// link locations are local or network paths, and a row's second line.
import test from "node:test";
import assert from "node:assert/strict";
import { entrySubtitle, kindLabel } from "./entry-text.ts";
import { formatDay } from "../../../lib/local-date.ts";
import { isLocalPath, isNetworkPath } from "./paths.ts";
import { device, id, key, link, login, note, payee, thing } from "./test-entries.ts";

test("entrySubtitle: each kind's second line", () => {
  assert.equal(entrySubtitle(login()), "mock.user@example.com");
  assert.equal(entrySubtitle(login({ signIn: "google", hasPassword: false })), "Google sign-in - mock.user@example.com");
  assert.equal(entrySubtitle(login({ signIn: "sso", username: "" })), "Company SSO sign-in");
  assert.equal(entrySubtitle(login({ lifecycle: { state: "gone", goneAt: "2026-05-01" } })), `Closed ${formatDay("2026-05-01")}`);
  assert.equal(entrySubtitle(note()), "Secure note");
  assert.equal(entrySubtitle(key()), "pk_mock_123");
  assert.equal(entrySubtitle(key({ keyId: "" })), "API key");
  assert.equal(entrySubtitle(link()), "https://drive.example.com/assets");
  assert.equal(entrySubtitle(payee({ number: "09171234567" })).startsWith("GCash · "), true);
  assert.equal(entrySubtitle(thing()), "Bedroom · blue folder, top shelf");
  assert.equal(entrySubtitle(thing({ room: "" })), "blue folder, top shelf");
  assert.equal(entrySubtitle(device()), "Router · Archer C6");
  assert.equal(entrySubtitle(id()), "ID");
  assert.equal(entrySubtitle(id({ title: "Mine" })), "Driver's license");
});

test("entrySubtitle orUrl: a password login with no username shows its website (quick search)", () => {
  const bare = login({ username: "" });
  assert.equal(entrySubtitle(bare), "");
  assert.equal(entrySubtitle(bare, { orUrl: true }), "https://mail.example.com");
  assert.equal(entrySubtitle(login(), { orUrl: true }), "mock.user@example.com");
});

test("kindLabel names each kind", () => {
  assert.equal(kindLabel(login()), "Login");
  assert.equal(kindLabel(login({ signIn: "google" })), "Google sign-in");
  assert.equal(kindLabel(login({ lifecycle: { state: "gone" } })), "Closed account");
  assert.equal(kindLabel(login({ lifecycle: { state: "dormant" } })), "Login");
  assert.equal(kindLabel(note()), "Secure note");
  assert.equal(kindLabel(key()), "API key");
  assert.equal(kindLabel(link()), "Web link");
  assert.equal(kindLabel(link({ linkType: "folder" })), "Local folder");
  assert.equal(kindLabel(link({ linkType: "drive" })), "Google Drive");
  assert.equal(kindLabel(link({ linkType: "doc" })), "Document");
  assert.equal(kindLabel(payee()), "Payee");
  assert.equal(kindLabel(thing()), "Thing");
  assert.equal(kindLabel(device()), "Router");
  assert.equal(kindLabel(device({ type: "other" })), "Device");
  assert.equal(kindLabel(id()), "ID");
});

test("isLocalPath: a drive path, a network share or a Mac path, never a web link", () => {
  for (const p of ["D:\\Clients\\Northwind", "c:/Users/mock", "\\\\server\\share", "/Users/mock/Documents"]) assert.equal(isLocalPath(p), true, p);
  for (const p of ["https://drive.example.com", "drive.example.com/folder", "Clients\\Northwind", ""]) assert.equal(isLocalPath(p), false, p);
});

test("isNetworkPath: a path that starts with two slashes either way", () => {
  for (const p of ["\\\\server\\share", "//server/share", "\\\\?\\C:\\x", "\\/server"]) assert.equal(isNetworkPath(p), true, p);
  for (const p of ["D:\\Clients", "/Users/mock", "https://example.com"]) assert.equal(isNetworkPath(p), false, p);
});
