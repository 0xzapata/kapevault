import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseCsv, csvTable } from "./csv.js";
import { ImportRefused, lostRows, parseExport } from "./index.js";
import { importEntries } from "../import.js";

const fixture = (name) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
const run = (name) => parseExport(fixture(name));
const byTitle = (result, title) => result.items.find((i) => i.title === title);
const TOTP = /^otpauth:\/\/totp\/.*secret=JBSWY3DPEHPK3PXP/;

function vault() {
  return { spaces: [{ id: "p", name: "Personal", kind: "personal" }], entries: [] };
}

test("the CSV reader handles quotes, commas, line breaks, a BOM, CRLF and CR", () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n'), [["a", "b"], ["x, y", 'say "hi"']]);
  assert.deepEqual(parseCsv('a,b\n"line1\nline2",2'), [["a", "b"], ["line1\nline2", "2"]]);
  assert.deepEqual(parseCsv('a,b\r"x",y\r'), [["a", "b"], ["x", "y"]]);
  assert.deepEqual(parseCsv("﻿a,b\n1,2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("a,b\n\n1,\n,\n"), [["a", "b"], ["1", ""], ["", ""]]);
  assert.deepEqual(parseCsv('a,b\n"CRLF\r\ninside",z'), [["a", "b"], ["CRLF\ninside", "z"]]); // stored as LF
  assert.deepEqual(parseCsv("a,b\nab\"c,d"), [["a", "b"], ['ab"c', "d"]]);
  assert.deepEqual(parseCsv(""), []);
  assert.throws(() => parseCsv('a\n"never closed'), /quoted field/);
});

test("a header is matched in lower case and a short row reads as empty cells", () => {
  const { headers, records } = csvTable("Name,URL\nsite\n");
  assert.deepEqual(headers, ["name", "url"]);
  assert.equal(records[0].get("name"), "site");
  assert.equal(records[0].get("url"), "");
  assert.equal(records[0].get("missing"), "");
  assert.equal(records[0].row, 2);
});

test("Bitwarden JSON: logins, 2FA, folders as tags, notes, cards and identities as secure notes", () => {
  const r = run("bitwarden.json");
  assert.equal(r.source, "bitwarden-json");
  const mail = byTitle(r, "Mock Mail");
  assert.deepEqual(
    { kind: mail.kind, url: mail.url, username: mail.username, password: mail.password, tags: mail.tags, favorite: mail.favorite },
    { kind: "login", url: "https://mail.example.com", username: "mock.user@example.com", password: "mock-pass-1", tags: ["Mock Work"], favorite: true },
  );
  assert.match(mail.totp, TOTP);
  assert.match(mail.notes, /recovery by phone\nOther websites: https:\/\/mail2\.example\.com/);
  // The hidden custom field is a secure note, never part of the login's plain notes.
  assert.doesNotMatch(mail.notes, /4321/);
  assert.equal(byTitle(r, "Mock Mail (extra fields)").body, "pin: 4321");
  assert.equal(byTitle(r, "Mock Wifi note").body, "router code 1234");
  assert.match(byTitle(r, "Mock Visa").body, /Number: 4111111111111111\nExpires: 04\/2030\nSecurity code: 123/);
  assert.match(byTitle(r, "Mock Identity").body, /firstName: Mock/);
  assert.deepEqual(byTitle(r, "Mock Team Tool").tags, ["Mock Team"]);
  assert.deepEqual(r.skipped.map((s) => s.reason).sort(), ["In the Bitwarden trash", "Passkey left out", "Unknown item type"]);
  assert.ok(r.notes.some((n) => /3 cards, identities or IDs were saved as secure notes/.test(n)));
  assert.ok(r.notes.some((n) => /1 login had a 2FA key KAPEVault cannot read/.test(n)), "the steam:// key is dropped and said so");
  assert.equal(byTitle(r, "Mock Steam").totp, undefined);
});

test("Bitwarden JSON: an SSH key comes in as a key item with its private key as the secret", () => {
  const r = run("bitwarden.json");
  const key = byTitle(r, "Mock Deploy Key");
  assert.equal(key.kind, "key");
  assert.equal(key.keyId, "SHA256:mockfingerprint");
  assert.match(key.secret, /^-----BEGIN OPENSSH PRIVATE KEY-----\nmock-private-key-body\n/);
  assert.equal(key.notes, "Public key: ssh-ed25519 AAAAmockpublic");
  assert.equal(r.skipped.some((s) => /ssh/i.test(s.reason)), false);
  const data = vault();
  importEntries(data, [key]);
  assert.equal(data.entries[0].secret.startsWith("-----BEGIN OPENSSH"), true, "core's key kind keeps it");
});

test("Bitwarden JSON: a bank account becomes a secure note; a passkey cannot, so its row is reported", () => {
  const r = run("bitwarden.json");
  assert.match(byTitle(r, "Mock Bank Account").body, /accountNumber: 12345678\npin: 4321/);
  assert.equal(byTitle(r, "Mock Passkey Site").password, "mock-pass-5");
  assert.deepEqual(r.skipped.filter((s) => s.reason === "Passkey left out").length, 1);
});

test("Bitwarden JSON: an SSH key with no private key is reported, not dropped silently", () => {
  const r = parseExport(JSON.stringify({ encrypted: false, folders: [], items: [{ type: 5, name: "Empty", sshKey: { privateKey: "", publicKey: "ssh-ed25519 AAAA" } }] }));
  assert.equal(r.items.length, 0);
  assert.equal(lostRows(r.skipped).length, 1);
});

test("an encrypted Bitwarden export is refused with a clear message", () => {
  assert.throws(() => run("bitwarden-encrypted.json"), (e) => e instanceof ImportRefused && /encrypted.*export again/.test(e.message));
  assert.throws(() => parseExport(JSON.stringify({ encrypted: true, folders: [], items: [] })), ImportRefused);
});

test("Bitwarden CSV: quotes, line breaks, the favorite flag and a second login with the same title", () => {
  const r = run("bitwarden.csv");
  assert.equal(r.source, "bitwarden-csv");
  const mail = byTitle(r, "Mock Mail");
  assert.equal(mail.password, 'mock,pass"1');
  assert.equal(mail.notes, "line one\nline two");
  assert.deepEqual([mail.tags, mail.favorite], [["Mock Work"], true]);
  assert.match(mail.totp, TOTP);
  assert.equal(byTitle(r, "Mock Mail (extra fields)").body, "pin: 4321");
  assert.equal(byTitle(r, "Mock Wifi note").kind, "note");
  // Same title, another account: kept, renamed, never lost to the duplicate rule.
  assert.equal(byTitle(r, "Mock Mail (second.user@example.com)").password, "mock-pass-2");
});

test("1Password CSV: 2FA from OTPAuth, tags, favorite, and an archived item is skipped", () => {
  const r = run("1password.csv");
  assert.equal(r.source, "1password");
  const bank = byTitle(r, "Mock Bank");
  assert.deepEqual([bank.tags, bank.favorite, bank.notes], [["finance", "mock"], true, "main account"]);
  assert.match(bank.totp, TOTP);
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.skipped, [{ row: 3, reason: "Archived in 1Password" }]);
});

test("KeePassXC CSV: group becomes a tag, TOTP column maps, recycle bin rows are skipped", () => {
  const r = run("keepass.csv");
  assert.equal(r.source, "keepass");
  const mail = byTitle(r, "Mock Mail");
  assert.deepEqual([mail.tags, mail.notes], [["Email"], "hello"]);
  assert.match(mail.totp, TOTP);
  assert.deepEqual(byTitle(r, "Mock Top").tags, []);
  assert.deepEqual(r.skipped.map((s) => s.reason), ["In the KeePass recycle bin"]);
});

test("KeePass 2's generic CSV columns work too", () => {
  const r = parseExport('"Account","Login Name","Password","Web Site","Comments"\n"Mock Old Site","mock.user","mock-pass-1","https://old.example.com","c"\n');
  assert.deepEqual([r.source, r.items[0].title, r.items[0].username, r.items[0].url, r.items[0].notes], ["keepass", "Mock Old Site", "mock.user", "https://old.example.com", "c"]);
});

test("Chrome CSV: the title falls back to the site, an app link moves to the notes, an empty row is skipped", () => {
  const r = run("chrome.csv");
  assert.equal(r.source, "browser");
  assert.equal(byTitle(r, "mock.example.com").url, "https://mock.example.com/login");
  const app = byTitle(r, "Mock App");
  assert.equal(app.url, "");
  assert.equal(app.notes, "two words, a comma\nApp: android://hash@com.example.mock/");
  assert.equal(byTitle(r, "No Password Site").password, "");
  assert.deepEqual(r.skipped, [{ row: 4, reason: "No title, site or username", harmless: true }]);
  assert.ok(r.notes.includes("1 login has no password."));
});

test("Edge and Brave's four-column file reads as the same source", () => {
  const r = parseExport("name,url,username,password\nMock Edge,https://edge.example.com,mock.user,mock-pass-1\n");
  assert.deepEqual([r.source, r.items[0].title], ["browser", "Mock Edge"]);
});

test("Firefox CSV: the host is the title, www is dropped", () => {
  const r = run("firefox.csv");
  assert.equal(r.source, "firefox");
  assert.deepEqual([r.items[0].title, r.items[0].username, r.items[0].password], ["mock-fox.example.com", "mock.user", "mock-pass-1"]);
});

test("Apple Passwords CSV: OTPAuth maps to 2FA", () => {
  const r = run("apple.csv");
  assert.equal(r.source, "apple");
  assert.match(byTitle(r, "mock-apple.example.com (mock.user)").totp, TOTP);
  assert.equal(byTitle(r, "Mock Hotel").notes, "room 12");
});

test("LastPass CSV: folders, secure notes, favorites and empty folder rows", () => {
  const r = run("lastpass.csv");
  assert.equal(r.source, "lastpass");
  const shop = byTitle(r, "Mock Shop");
  assert.deepEqual([shop.tags, shop.favorite, shop.notes], [["Shopping"], true, "shopper since 2020"]);
  assert.match(shop.totp, TOTP);
  assert.deepEqual([byTitle(r, "Mock Secure Note").kind, byTitle(r, "Mock Secure Note").body], ["note", "mock secret text"]);
  assert.deepEqual(r.skipped.map((s) => s.reason), ["Empty LastPass folder"]);
});

test("a raw base32 2FA key and a bad one both map without failing the import", () => {
  const r = parseExport("name,url,username,password,note\n");
  assert.equal(r.items.length, 0);
  const apple = parseExport("Title,URL,Username,Password,Notes,OTPAuth\nMock One,https://one.example.com,u,p,,JBSWY3DPEHPK3PXP\nMock Two,https://two.example.com,u,p,,not a key\n");
  assert.match(apple.items[0].totp, TOTP);
  assert.equal(apple.items[1].totp, undefined);
  assert.equal(apple.items[1].password, "p");
});

test("a row with only notes becomes a secure note; identical rows are skipped once", () => {
  const r = parseExport("name,url,username,password,note\nMock Memo,,,,remember this\nMock Twin,https://t.example.com,u,p,\nMock Twin,https://t.example.com,u,p,\n");
  assert.deepEqual([r.items[0].kind, r.items[0].body], ["note", "remember this"]);
  assert.equal(r.items.filter((i) => i.title.startsWith("Mock Twin")).length, 1);
  assert.deepEqual(r.skipped, [{ row: 4, reason: "Same item as an earlier row", harmless: true }]);
});

test("a file in no known format reads as null", () => {
  assert.equal(parseExport("just,some,columns\n1,2,3\n"), null);
  assert.equal(parseExport("{ not json"), null);
  assert.equal(parseExport('{"hello":"world"}'), null);
  assert.equal(parseExport(""), null);
});

test("every fixture's items pass core's import and a second run adds nothing", () => {
  for (const name of ["bitwarden.json", "bitwarden.csv", "1password.csv", "keepass.csv", "chrome.csv", "firefox.csv", "apple.csv", "lastpass.csv"]) {
    const data = vault();
    const { items } = run(name);
    const first = importEntries(data, items);
    assert.equal(first.added, items.length, `${name}: nothing lost to the duplicate rule`);
    assert.equal(importEntries(data, items).added, 0, name);
  }
});

test("the 2FA key in an imported login is stored as a normalized otpauth URI", () => {
  const data = vault();
  importEntries(data, run("keepass.csv").items);
  assert.match(data.entries.find((e) => e.title === "Mock Mail").totp, /^otpauth:\/\/totp\/.*algorithm=SHA1&digits=6&period=30$/);
});

// Shapes taken from the exporters' own source (bitwarden/clients base-vault-export.service.ts and
// individual-vault-export.service.ts; keepassxc src/format/CsvExporter.cpp + src/core/Totp.cpp).
test("Bitwarden CSV: several websites in one cell keep the first as the site and the rest in the notes", () => {
  const r = parseExport('folder,favorite,type,name,notes,fields,reprompt,archivedDate,login_uri,login_username,login_password,login_totp\n,,login,Mock Multi,,,0,,"https://a.example.com,https://b.example.com",mock.user,mock-pass-1,\n');
  const item = r.items[0];
  assert.equal(item.url, "https://a.example.com");
  assert.equal(item.notes, "Other websites: https://b.example.com");
});

test("Bitwarden CSV: an organization export's collections column becomes tags, and the file says what a CSV leaves out", () => {
  const r = parseExport('collections,type,name,notes,fields,reprompt,archivedDate,login_uri,login_username,login_password,login_totp\n"Mock Team,Mock Ops",login,Mock Shared,,,0,,https://s.example.com,mock.user,mock-pass-1,\n');
  assert.deepEqual(r.items[0].tags, ["Mock Team", "Mock Ops"]);
  assert.ok(r.notes.some((n) => /does not hold cards, identities or SSH keys/.test(n)));
});

test("KeePassXC CSV: the TOTP column is an otpauth URL, as KeePassXC writes it", () => {
  const r = parseExport('"Group","Title","Username","Password","URL","Notes","TOTP","Icon","Last Modified","Created"\n"Root/Email","Mock Mail","mock.user","mock-pass-1","","","otpauth://totp/Mock%20Mail:mock.user?secret=JBSWY3DPEHPK3PXP&period=30&digits=6&issuer=Mock%20Mail","0","2026-01-01T00:00:00Z","2026-01-01T00:00:00Z"\n');
  assert.match(r.items[0].totp, TOTP);
  assert.equal(r.notes.some((n) => /2FA key/.test(n)), false);
});

test("Firefox CSV: its own sync login is not a password of the person's; the old hostname column reads too", () => {
  const sync = parseExport('"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n"chrome://FirefoxAccounts","abc","{""version"":1}",,"","{g1}","1","1","1"\n"https://a.example.com","mock.user","mock-pass-1",,"https://a.example.com","{g2}","1","1","1"\n');
  assert.deepEqual(sync.items.map((i) => i.username), ["mock.user"]);
  assert.equal(lostRows(sync.skipped).length, 0);
  const old = parseExport('"hostname","username","password","formSubmitURL","httpRealm","guid","timeCreated","timeLastUsed","timePasswordChanged"\n"https://old.example.com","mock.user","mock-pass-1","https://old.example.com","","{g3}","1","1","1"\n');
  assert.deepEqual([old.source, old.items[0].url], ["firefox", "https://old.example.com"]);
});

test("Apple Passwords: the older four-column Safari export reads too", () => {
  const r = parseExport("Title,Url,Username,Password\nmock.example.com (mock.user),https://mock.example.com,mock.user,mock-pass-1\n");
  assert.deepEqual([r.source, r.items[0].password], ["apple", "mock-pass-1"]);
});

test("1Password CSV: a column KAPEVault has no place for keeps the file; a card row is not called empty", () => {
  const r = parseExport('Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes,Cardholder name\nMock Card,,,,,false,false,,,Mock Person\nMock Site,https://s.example.com,mock.user,mock-pass-1,,false,false,,,Mock Person\n');
  assert.equal(r.items.length, 1, "the site still comes in");
  assert.equal(lostRows(r.skipped).length, 2);
  const plain = run("1password.csv");
  assert.equal(lostRows(plain.skipped).length, 1, "only the archived item");
});

test("only rows with nothing in them are harmless to skip", () => {
  const empty = parseExport("name,url,username,password,note\n,,,,\n,,,mock-pass-only,\n");
  assert.equal(empty.skipped.length, 2);
  assert.equal(lostRows(empty.skipped).length, 1, "a row with just a password is data");
  assert.equal(lostRows(run("lastpass.csv").skipped).length, 0, "an empty folder row holds nothing");
  assert.equal(lostRows(run("bitwarden.json").skipped).length, 3, "trash, passkey, unknown type");
  assert.equal(lostRows(run("keepass.csv").skipped).length, 1, "the recycle bin holds items");
});
