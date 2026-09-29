// Run with `npm test` (Node strips the types). Item actions against a fake bridge: which call each
// kind makes, and the toast it answers with.
import test from "node:test";
import assert from "node:assert/strict";
import { device, fakeBridge, id, key, link, login, note, payee, thing } from "./test-entries.ts";

const calls = fakeBridge(); // before the import: vault-api reads window.kapevault when it loads
const { copyCode, copySecretOf, copyUsername, entryCopies, linkOf, openEntry, openLabel, primaryAction } = await import("./entry-actions.ts");

test("entryCopies lists each kind's copies in slot order", () => {
  const list = (e: Parameters<typeof entryCopies>[0]) => entryCopies(e).map((c) => `${c.slot}:${c.label}`);
  assert.deepEqual(list(login({ hasTotp: true })), ["secret:Copy password", "username:Copy username", "totp:Copy code"]);
  assert.deepEqual(list(key()), ["secret:Copy secret", "username:Copy key ID"]);
  assert.deepEqual(list(note()), ["secret:Copy note"]);
  assert.deepEqual(list(link()), []);
  assert.deepEqual(list(payee()), ["username:Copy number"]);
  assert.deepEqual(list(thing()), ["username:Copy spot"]);
  assert.deepEqual(list(device({ imei: "490154203237518" })), ["secret:Copy Wi-Fi password", "username:Copy Wi-Fi name", "imei:Copy IMEI"]);
  assert.deepEqual(list(id()), ["secret:Copy ID number"]);
});

test("the IMEI copy copies the IMEI as plain text", async () => {
  const imei = entryCopies(device({ imei: "490154203237518" })).find((c) => c.slot === "imei")!;
  assert.equal(imei.toast, "IMEI copied");
  assert.deepEqual((await run(imei.run)).calls, [["copyText", "490154203237518", "device-1"]]);
});

test("openLabel names what Open does in quick search", () => {
  assert.equal(openLabel(link()), "Open link");
  assert.equal(openLabel(link({ linkType: "folder" })), "Open folder");
  assert.equal(openLabel(device()), "Open admin page");
  assert.equal(openLabel(login()), "Open website");
  assert.equal(openLabel(key()), "Open website");
});

async function run<T>(action: () => Promise<T>) {
  calls.length = 0;
  const result = await action();
  return { result, calls: [...calls] };
}

test("copySecretOf copies each kind's secret through main, and says it clears", async () => {
  assert.deepEqual(await run(() => copySecretOf(login())), { result: "Password copied - clears in 30s", calls: [["copyPassword", "login-1"]] });
  assert.deepEqual(await run(() => copySecretOf(key())), { result: "Secret copied - clears in 30s", calls: [["copySecret", "key-1", "secret"]] });
  assert.deepEqual(await run(() => copySecretOf(note())), { result: "Note copied - clears in 30s", calls: [["copySecret", "note-1", "body"]] });
  assert.deepEqual(await run(() => copySecretOf(device())), { result: "Wi-Fi password copied - clears in 30s", calls: [["copySecret", "device-1", "wifiPassword"]] });
  assert.deepEqual(await run(() => copySecretOf(id())), { result: "ID number copied - clears in 30s", calls: [["copySecret", "id-1", "idNumber"]] });
});

test("copySecretOf does nothing without a secret, or for a kind that has none", async () => {
  for (const e of [login({ hasPassword: false }), key({ hasSecret: false }), note({ hasBody: false }), device({ hasWifiPassword: false }), id({ hasNumber: false }), link(), payee(), thing()])
    assert.deepEqual(await run(() => copySecretOf(e)), { result: null, calls: [] }, e.kind);
});

test("copyUsername copies each kind's everyday value", async () => {
  assert.deepEqual(await run(() => copyUsername(login())), { result: "Username copied", calls: [["copyText", "mock.user@example.com", "login-1"]] });
  assert.deepEqual(await run(() => copyUsername(key())), { result: "Key ID copied", calls: [["copyText", "pk_mock_123", "key-1"]] });
  assert.deepEqual(await run(() => copyUsername(payee())), { result: "Number copied", calls: [["copyText", "09171234567", "payee-1"]] });
  assert.deepEqual(await run(() => copyUsername(thing())), { result: "Spot copied", calls: [["copyText", "blue folder, top shelf", "thing-1"]] });
  assert.deepEqual(await run(() => copyUsername(device())), { result: "Wi-Fi name copied", calls: [["copyText", "Harbor-5G", "device-1"]] });
  for (const e of [login({ username: "" }), key({ keyId: "" }), device({ ssid: "" }), note(), link(), id()]) assert.deepEqual(await run(() => copyUsername(e)), { result: null, calls: [] }, e.kind);
});

test("copyCode copies a login's 2FA code only", async () => {
  assert.deepEqual(await run(() => copyCode(login({ hasTotp: true }))), { result: "2FA code copied", calls: [["copyTotp", "login-1"]] });
  assert.deepEqual(await run(() => copyCode(login())), { result: null, calls: [] });
  assert.deepEqual(await run(() => copyCode(key())), { result: null, calls: [] });
});

test("linkOf: a link's location, a login's or key's website, a device's admin page", () => {
  assert.equal(linkOf(link()), "https://drive.example.com/assets");
  assert.equal(linkOf(login()), "https://mail.example.com");
  assert.equal(linkOf(key()), "https://api.example.com");
  assert.equal(linkOf(device()), "192.168.1.1");
  for (const e of [note(), payee(), thing(), id()]) assert.equal(linkOf(e), "");
});

test("openEntry sends only the id; a folder says so", async () => {
  assert.deepEqual(await run(() => openEntry(link())), { result: "Opened", calls: [["openEntry", "link-1"]] });
  assert.deepEqual(await run(() => openEntry(link({ linkType: "folder", location: "D:\\Clients" }))), { result: "Opened the folder", calls: [["openEntry", "link-1"]] });
  assert.deepEqual(await run(() => openEntry(device())), { result: "Opened", calls: [["openEntry", "device-1"]] });
  assert.deepEqual(await run(() => openEntry(login({ url: "" }))), { result: null, calls: [] });
});

test("primaryAction: a link opens; otherwise the secret, then the username, then the link", async () => {
  assert.equal((await run(() => primaryAction(link()))).result, "Opened");
  assert.equal((await run(() => primaryAction(login()))).result, "Password copied - clears in 30s");
  assert.equal((await run(() => primaryAction(login({ hasPassword: false })))).result, "Username copied");
  assert.equal((await run(() => primaryAction(login({ hasPassword: false, username: "" })))).result, "Opened");
  assert.equal((await run(() => primaryAction(login({ hasPassword: false, username: "", url: "" })))).result, null);
  assert.equal((await run(() => primaryAction(device({ hasWifiPassword: false })))).result, "Wi-Fi name copied");
  assert.equal((await run(() => primaryAction(payee()))).result, "Number copied");
  assert.equal((await run(() => primaryAction(note({ hasBody: false })))).result, null);
});
