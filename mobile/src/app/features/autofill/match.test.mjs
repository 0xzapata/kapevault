// Autofill matching: who gets a "For <site>" suggestion in the picker, and who only gets a search word.
// The probes from SECURITY-AUDIT-2026-09-28.md finding M6 are here: a look-alike app, an app named "Gmail", a fake
// Chromium, and sites that share a public suffix (pages.dev, github.io, vercel.app, blogspot.com, me.uk).
import test from "node:test";
import assert from "node:assert/strict";
import { matchesTarget, registrableDomain, sameSite, searchHint, targetSite } from "./match.ts";

const login = (title, url) => ({ id: title, kind: "login", title, url, username: "sam.home@example.com", hasPassword: true });
const app = (packageName, appLabel) => ({ id: "r-1", packageName, appLabel, browser: false, username: true, password: true });
const browser = (webDomain, webScheme = "https", packageName = "com.android.chrome") => ({ id: "r-1", packageName, appLabel: "Chrome", webDomain, webScheme, browser: true, username: true, password: true });

const PAYPAL = login("PayPal", "https://www.paypal.com/signin");
const GMAIL = login("Gmail", "https://mail.google.com");
const EXAMPLE_CO = login("Example Co.", "https://example.pages.dev/login");

test("registrable domain follows the public suffix list, both sections", () => {
  assert.equal(registrableDomain("accounts.google.com"), "google.com");
  assert.equal(registrableDomain("shop.example.co.uk"), "example.co.uk");
  assert.equal(registrableDomain("example.pages.dev"), "example.pages.dev"); // PRIVATE: pages.dev
  assert.equal(registrableDomain("a.b.sam.github.io"), "sam.github.io");
  assert.equal(registrableDomain("alice.me.uk"), "alice.me.uk"); // ICANN: me.uk
  assert.equal(registrableDomain("www.ck"), "www.ck"); // the "!www.ck" exception under "*.ck"
  assert.equal(registrableDomain("shop.site.ck"), "shop.site.ck"); // "*.ck": site.ck is a suffix
  assert.equal(registrableDomain("pages.dev"), "");
  assert.equal(registrableDomain("co.uk"), "");
  assert.equal(registrableDomain("192.168.1.10"), "");
  assert.equal(registrableDomain("intranet.corp.unlistedtld"), "corp.unlistedtld"); // the default rule
});

test("web: one site across subdomains", () => {
  assert.equal(sameSite("accounts.google.com", "mail.google.com"), true);
  assert.equal(sameSite("login.example.co.uk", "example.co.uk"), true);
  assert.equal(matchesTarget(GMAIL, browser("accounts.google.com")), true);
  assert.equal(matchesTarget(login("Work", "example.co.uk"), browser("secure.example.co.uk")), true);
});

test("web: sites that only share a public suffix are not one site", () => {
  assert.equal(matchesTarget(EXAMPLE_CO, browser("evil.pages.dev")), false);
  assert.equal(matchesTarget(EXAMPLE_CO, browser("example.pages.dev")), true);
  for (const [saved, page] of [
    ["sam.github.io", "evil.github.io"],
    ["myapp.vercel.app", "myapp-login.vercel.app"],
    ["samblog.blogspot.com", "evil.blogspot.com"],
    ["alice.me.uk", "bob.me.uk"],
    ["example.co.uk", "other.co.uk"],
  ]) {
    assert.equal(matchesTarget(login(saved, `https://${saved}`), browser(page)), false, `${saved} vs ${page}`);
  }
  // A login saved for a bare suffix matches only that exact host.
  assert.equal(matchesTarget(login("Pages", "pages.dev"), browser("evil.pages.dev")), false);
  // IP addresses: the same address only.
  assert.equal(matchesTarget(login("Router", "http://192.168.1.1"), browser("192.168.1.1")), true);
  assert.equal(matchesTarget(login("Router", "http://192.168.1.1"), browser("192.168.1.2")), false);
});

test("web: a login saved for an app is not a site", () => {
  assert.equal(matchesTarget(login("Pay", "androidapp://com.paypal.android.p2pmobile"), browser("com.paypal.android.p2pmobile")), false);
});

test("app: only a login saved as androidapp://<package> is suggested", () => {
  const saved = login("PayPal app", "androidapp://com.paypal.android.p2pmobile");
  assert.equal(matchesTarget(saved, app("com.paypal.android.p2pmobile", "PayPal")), true);
  assert.equal(matchesTarget(saved, app("com.phish.paypal", "PayPal")), false);
  // A site address that happens to spell the package is not an app login.
  assert.equal(matchesTarget(login("Odd", "https://com.paypal.android.p2pmobile"), app("com.paypal.android.p2pmobile", "PayPal")), false);
});

test("probe: com.phish.paypal labelled Wallet Tool gets no suggestion, only a search word", () => {
  const phish = app("com.phish.paypal", "Wallet Tool");
  assert.equal(matchesTarget(PAYPAL, phish), false);
  assert.equal(searchHint([PAYPAL, GMAIL], phish), "paypal");
});

test("probe: an app labelled Gmail gets no suggestion, only a search word", () => {
  const fake = app("com.tools.mailer", "Gmail");
  assert.equal(matchesTarget(GMAIL, fake), false);
  assert.equal(searchHint([PAYPAL, GMAIL], fake), "Gmail");
});

test("probe: a fake org.chromium.chrome that failed the certificate check is not a browser", () => {
  // The phone sends browser:false for a browser package whose signer is not the pinned one, and no
  // domain. Even with a domain claimed, an app's domain is never trusted.
  const fake = { ...app("org.chromium.chrome", "Chromium"), webDomain: "www.paypal.com" };
  assert.equal(matchesTarget(PAYPAL, fake), false);
  assert.equal(targetSite(fake), "");
  assert.equal(searchHint([PAYPAL], fake), "");
});

test("search hint: none for a browser, none when a login is saved for the app, none from generic words", () => {
  assert.equal(searchHint([PAYPAL], browser("paypal.com")), "");
  const saved = login("PayPal app", "androidapp://com.paypal.android.p2pmobile");
  assert.equal(searchHint([saved, PAYPAL], app("com.paypal.android.p2pmobile", "PayPal")), "");
  assert.equal(searchHint([login("App", "app.com")], app("com.example.app", "Example")), "");
  // An app Android names by its package gives no name word.
  assert.equal(searchHint([login("com.foo.bar", "")], app("com.foo.bar", "com.foo.bar")), "");
});

test("web: a login saved for https (or a bare address) is never offered on an http page; one saved for http is", () => {
  assert.equal(matchesTarget(PAYPAL, browser("www.paypal.com", "http")), false, "https-saved, http page");
  assert.equal(matchesTarget(login("Bank", "bank.example.com"), browser("bank.example.com", "http")), false, "bare means https, as Open opens it");
  assert.equal(matchesTarget(login("Bank", "bank.example.com"), browser("bank.example.com", "https")), true);
  assert.equal(matchesTarget(PAYPAL, browser("www.paypal.com", "HTTPS")), true, "the scheme is compared lowercase");
  const router = login("Router", "http://192.168.1.1");
  assert.equal(matchesTarget(router, browser("192.168.1.1", "http")), true, "http-saved, http page");
  assert.equal(matchesTarget(router, browser("192.168.1.1", "https")), true, "http-saved, the page moved to https");
  assert.equal(matchesTarget(login("Old", "http://old.example.com"), browser("old.example.com", "http")), true);
});

test("web: a page whose scheme the screen does not report counts as not https", () => {
  // The bridge drops a null scheme, so the page gets no webScheme key at all.
  const unread = { ...browser("www.paypal.com"), webScheme: undefined };
  assert.equal(matchesTarget(PAYPAL, unread), false);
  assert.equal(matchesTarget(login("Router", "http://192.168.1.1"), { ...browser("192.168.1.1"), webScheme: undefined }), true);
  assert.equal(matchesTarget(PAYPAL, browser("www.paypal.com", "ftp")), false, "a known scheme that is not https is not secure");
});

test("web: a compatibility-mode address bar hides the scheme, so there an unknown one is allowed", () => {
  const bar = { ...browser("www.paypal.com"), webScheme: undefined, addressBar: true };
  assert.equal(matchesTarget(PAYPAL, bar), true, "https-saved, scheme hidden by the bar");
  assert.equal(matchesTarget(PAYPAL, { ...bar, webScheme: "http" }), false, "a bar that does say http is still http");
  assert.equal(matchesTarget(PAYPAL, { ...bar, webDomain: "www.paypal.com.evil.example" }), false, "the site must still match");
});

test("web: login fields in different documents (a cross-origin frame) come with no domain, so nothing is suggested", () => {
  // LoginForm.kt sends no webDomain when the username and password fields sit in different documents,
  // e.g. an ad's frame on a bank page: neither the bank's nor the ad's logins are "For" it.
  const mixed = { ...browser(undefined), webScheme: undefined };
  assert.equal(matchesTarget(PAYPAL, mixed), false);
  assert.equal(targetSite(mixed), "");
  assert.equal(searchHint([PAYPAL], mixed), "", "and a browser never gets a search word");
});

test("the picker names a checked browser's site, never an app", () => {
  assert.equal(targetSite(browser("www.Accounts.Google.com")), "accounts.google.com");
  assert.equal(targetSite(app("com.phish.paypal", "PayPal")), "");
});
