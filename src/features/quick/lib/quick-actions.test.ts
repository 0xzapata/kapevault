// Run with `npm test` (Node strips the types). Quick search's footer: which actions an item offers,
// in what order, and what each one runs.
import test from "node:test";
import assert from "node:assert/strict";
import { device, fakeBridge, id, key, link, login, note, payee, thing } from "../../vault/lib/test-entries.ts";
import type { Entry } from "../../vault/types";

const calls = fakeBridge(); // before the import: vault-api reads window.kapevault when it loads
const { footerHints, quickActions, runQuickAction } = await import("./quick-actions.ts");

const labels = (e: Entry) => quickActions(e).map((a) => `${a.id}:${a.label}${a.opens ? " (opens)" : ""}`);

test("a login: password first, then username, code, website, show", () => {
  assert.deepEqual(labels(login({ hasTotp: true })), ["primary:Copy password", "secondary:Copy username", "totp:Copy code", "open:Open website (opens)", "show:Show in KAPEVault (opens)"]);
  assert.deepEqual(labels(login({ hasPassword: false })), ["primary:Copy username", "open:Open website (opens)", "show:Show in KAPEVault (opens)"]);
  assert.deepEqual(labels(login({ hasPassword: false, username: "" })), ["primary:Open website (opens)", "open:Open website (opens)", "show:Show in KAPEVault (opens)"]);
  assert.deepEqual(labels(login({ hasPassword: false, username: "", url: "" })), ["show:Show in KAPEVault (opens)"]);
});

test("every other kind", () => {
  assert.deepEqual(labels(key()), ["primary:Copy secret", "secondary:Copy key ID", "open:Open website (opens)", "show:Show in KAPEVault (opens)"]);
  assert.deepEqual(labels(note()), ["primary:Copy note", "show:Show in KAPEVault (opens)"]);
  assert.deepEqual(labels(link()), ["primary:Open link (opens)", "open:Open link (opens)", "show:Show in KAPEVault (opens)"]);
  assert.deepEqual(labels(link({ linkType: "folder" })), ["primary:Open folder (opens)", "open:Open folder (opens)", "show:Show in KAPEVault (opens)"]);
  assert.deepEqual(labels(payee()), ["primary:Copy number", "show:Show in KAPEVault (opens)"]);
  assert.deepEqual(labels(thing()), ["primary:Copy spot", "show:Show in KAPEVault (opens)"]);
  assert.deepEqual(labels(device()), ["primary:Copy Wi-Fi password", "secondary:Copy Wi-Fi name", "open:Open admin page (opens)", "show:Show in KAPEVault (opens)"]);
  assert.deepEqual(labels(device({ imei: "490154203237518" })), labels(device()), "no IMEI in quick search");
  assert.deepEqual(labels(id()), ["primary:Copy ID number", "show:Show in KAPEVault (opens)"]);
});

test("footerHints drops the open hint when Enter already opens", () => {
  const hints = (e: Entry) => footerHints(quickActions(e)).map((a) => a.id);
  assert.deepEqual(hints(link()), ["primary", "show"]);
  assert.deepEqual(hints(login({ hasPassword: false, username: "" })), ["primary", "show"]);
  assert.deepEqual(hints(login()), ["primary", "secondary", "open", "show"]);
});

test("runQuickAction runs the shared entry actions", async () => {
  const run = async (e: Entry, action: Parameters<typeof runQuickAction>[1]) => {
    calls.length = 0;
    return { result: await runQuickAction(e, action), calls: [...calls] };
  };
  assert.deepEqual(await run(login(), "primary"), { result: "Password copied - clears in 30s", calls: [["copyPassword", "login-1"]] });
  assert.deepEqual(await run(login(), "secondary"), { result: "Username copied", calls: [["copyText", "mock.user@example.com", "login-1"]] });
  assert.deepEqual(await run(login({ hasTotp: true }), "totp"), { result: "2FA code copied", calls: [["copyTotp", "login-1"]] });
  assert.deepEqual(await run(login(), "open"), { result: "Opened", calls: [["openEntry", "login-1"]] });
  assert.deepEqual(await run(link({ linkType: "folder" }), "primary"), { result: "Opened the folder", calls: [["openEntry", "link-1"]] });
});
