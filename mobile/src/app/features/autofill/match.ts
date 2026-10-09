// Which saved logins belong to the app or site asking to be filled. Pure, so it is easy to reason about:
// a match only moves a login to the top of the picker; the user still picks.
//
// A suggestion ("For <site>") is a claim that this is the right place, so only proof earns it:
// - a browser (its signing certificate checked on the phone, LoginForm / TrustedBrowsers.kt): the page's
//   site is the login's site, by registrable domain from the Public Suffix List, so evil.pages.dev is not
//   example.pages.dev; and a login saved for https (or a bare address, which opens as https) is offered on
//   https pages only - never on an http page, where anyone on the network can change what it shows. A
//   compatibility-mode browser (addressBar) names its page only on its address bar, which hides the
//   scheme: there an unknown scheme is allowed, the one place an http page cannot be told apart;
// - any other app: the login was saved for exactly that app, androidapp://<package>.
// An app's name and its package words can be chosen by anyone ("Gmail", com.phish.paypal), so they only
// type a word into the picker's search box (searchHint), which the user sees and can clear.
import type { FillTarget } from "../../host/autofill";
import type { LoginEntry } from "../../host/types";
import { PUBLIC_SUFFIX_RULES } from "./public-suffixes";

// A saved login's address: the app it was saved for (androidapp://<package>), or its site's host,
// lowercase, without "www.", and whether it was saved for http. "https://www.accounts.google.com/x" and
// "google.com" are https sites, "http://192.168.1.1" an http one.
function placeOf(url: string): { app?: string; host?: string; http?: boolean } {
  const text = url.trim().toLowerCase();
  if (!text) return {};
  const app = /^androidapp:\/\/([a-z0-9_.]+)\/?$/.exec(text);
  if (app) return { app: app[1] };
  if (/^[a-z][a-z0-9+.-]*:/.test(text) && !/^https?:\/\//.test(text)) return {}; // mailto:, ftp:, a typo
  return { host: hostOf(text), http: text.startsWith("http://") };
}

function hostOf(text: string): string {
  try {
    return new URL(/^https?:\/\//.test(text) ? text : `https://${text}`).hostname.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

let rules: { exact: Set<string>; wild: Set<string>; except: Set<string> } | null = null;
function suffixRules() {
  if (rules) return rules;
  rules = { exact: new Set(), wild: new Set(), except: new Set() };
  for (const rule of PUBLIC_SUFFIX_RULES.split("\n")) {
    if (!rule) continue;
    if (rule.startsWith("!")) rules.except.add(rule.slice(1));
    else if (rule.startsWith("*.")) rules.wild.add(rule.slice(2));
    else rules.exact.add(rule);
  }
  return rules;
}

// The part a person registers: "accounts.google.com" -> "google.com", "shop.example.co.uk" ->
// "example.co.uk", "example.pages.dev" -> "example.pages.dev" (pages.dev is a public suffix). "" for an
// IP address, a public suffix itself ("pages.dev", "co.uk") or a host that does not parse.
export function registrableDomain(host: string): string {
  const name = host.toLowerCase().replace(/\.$/, "");
  if (!name || name.includes(":") || /^[\d.]+$/.test(name)) return "";
  const labels = name.split(".");
  if (labels.some((label) => !label)) return "";
  const { exact, wild, except } = suffixRules();
  let suffix = 1; // the list's default rule "*": an unlisted top-level name is a suffix of one label
  for (let i = 0; i < labels.length; i++) {
    const rest = labels.slice(i).join(".");
    if (except.has(rest)) {
      suffix = labels.length - i - 1; // "!www.ck": www.ck is registrable under ck
      break;
    }
    if (exact.has(rest) || (i + 1 < labels.length && wild.has(labels.slice(i + 1).join(".")))) {
      suffix = labels.length - i; // the longest matching rule wins; the loop goes longest first
      break;
    }
  }
  return suffix < labels.length ? labels.slice(labels.length - suffix - 1).join(".") : "";
}

// One site: the same registrable domain, or (IP addresses, a bare public suffix) the very same host.
export function sameSite(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const site = registrableDomain(a);
  return Boolean(site) && site === registrableDomain(b);
}

// A browser's page is named by its site; any other app is not named here (its name can be anything).
export function targetSite(target: FillTarget): string {
  return target.browser && target.webDomain ? hostOf(target.webDomain.toLowerCase()) : "";
}

export function matchesTarget(entry: LoginEntry, target: FillTarget): boolean {
  const place = placeOf(entry.url);
  if (target.browser) {
    // Only a checked browser's domain is trusted: any app can claim any domain in its web views.
    const site = targetSite(target);
    // A missing scheme is proof of nothing, except on an address bar, which never shows it.
    const scheme = target.webScheme?.toLowerCase();
    const secure = scheme === "https" || (!scheme && Boolean(target.addressBar));
    return Boolean(place.host && site) && sameSite(place.host as string, site) && (secure || Boolean(place.http));
  }
  return Boolean(place.app) && place.app === target.packageName.toLowerCase();
}

// The confirm sentence for a login that is not saved for who is asking (the picker's "Other logins"), in
// plain words: the login's own site or app, and who asked. A login with no site saved says so.
export function mismatchWarning(entry: LoginEntry, target: FillTarget): string {
  const place = placeOf(entry.url);
  const own = place.app ?? place.host;
  const site = targetSite(target);
  const asker = target.browser && site ? `The page asking is ${site}.` : `The app asking is ${target.packageName}.`;
  return `${own ? `This login is for ${own}.` : "This login has no site saved."} ${asker} Fill anyway?`;
}

// Package name words that say nothing about whose app it is.
const GENERIC = new Set(["com", "org", "net", "io", "co", "app", "apps", "android", "mobile", "client", "www", "prod", "release"]);

// A word for the picker's search box when an app has no login saved for it: a word of its package that
// names a saved login's site ("com.facebook.katana" and facebook.com -> "facebook"), or its name when a
// login has that title. Never a suggestion, only a search the user sees and can clear. "" for none.
export function searchHint(entries: LoginEntry[], target: FillTarget): string {
  if (target.browser || entries.some((e) => matchesTarget(e, target))) return "";
  const words = target.packageName.toLowerCase().split(".").filter((w) => w.length >= 3 && !GENERIC.has(w));
  for (const entry of entries) {
    const host = placeOf(entry.url).host;
    const company = host ? (registrableDomain(host) || host).split(".")[0] : "";
    if (company.length >= 3 && words.includes(company)) return company;
  }
  const label = target.appLabel.trim().toLowerCase();
  if (label.length < 3 || label === target.packageName.toLowerCase()) return "";
  const titled = entries.some((e) => {
    const title = e.title.trim().toLowerCase();
    return title === label || title.startsWith(`${label} `);
  });
  return titled ? target.appLabel.trim() : "";
}
