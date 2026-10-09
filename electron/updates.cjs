// The update check: SECURITY.md supports only the latest release, so an app that never learns a newer
// one exists could never get a security fix. Opt-in and OFF by default (Settings > General). When on,
// at most once a day main asks GitHub for the newest release and compares its tag with this version.
// The request goes through the courier, like every R2 call, so Air Wall (which keeps KAPEVault.exe
// itself offline) is respected the same way: it works or silently does nothing. What leaves the PC is
// one HTTPS GET with a fixed User-Agent - never the install id, a cookie or anything about the vault.
const { carry } = require("./courier.cjs");

const RELEASES_API = "https://api.github.com/repos/brewed-ops/kapevault/releases/latest";
const RELEASES_PAGE = "https://github.com/brewed-ops/kapevault/releases";
const DAY_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 60 * 60 * 1000; // a tray-resident app is not restarted daily; the hour only decides when the day is up
const MAX_BYTES = 512 * 1024; // a release answer with its asset list is tens of KB
const COULD_NOT = "Could not check";

// major.minor.patch with an optional v. Anything else (a prerelease suffix, build metadata, text) is not a
// version this app will compare, so an odd tag can never claim to be newer.
const VERSION = /^v?(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

/** @returns {number[] | null} */
function parseVersion(text) {
  const match = typeof text === "string" ? VERSION.exec(text) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** 1 when a is newer than b, -1 older, 0 the same, null when either is not a plain version. */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

// The release's own page if it really is on this project's releases, else the releases page. Never a
// string taken as given: GitHub's answer is untrusted JSON.
function releaseUrl(candidate) {
  try {
    const url = new URL(candidate);
    const base = new URL(RELEASES_PAGE).pathname;
    const here = url.protocol === "https:" && url.host === "github.com" && !url.username && !url.password;
    if (here && (url.pathname === base || url.pathname.startsWith(`${base}/`))) return url.href;
  } catch {
    // not a URL
  }
  return RELEASES_PAGE;
}

/** The newest release from GitHub's answer, or null for anything unusable (junk, a draft, a prerelease, an odd tag). */
function parseRelease(bytes) {
  let json;
  try {
    json = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return null;
  }
  if (!json || typeof json !== "object" || Array.isArray(json) || json.draft === true || json.prerelease === true) return null;
  if (!parseVersion(json.tag_name)) return null;
  return { version: json.tag_name.replace(/^v/, ""), url: releaseUrl(json.html_url) };
}

// fake (an unpacked test run only): newer | same | fail stands in for GitHub's answer, no network.
function fakeTransport(fake, version) {
  const [major] = /** @type {number[]} */ (parseVersion(version));
  const tag = fake === "newer" ? `v${major + 1}.0.0` : `v${version}`;
  return async () => (fake === "fail" ? { status: 403, body: Buffer.from("{}") } : { status: 200, body: Buffer.from(JSON.stringify({ tag_name: tag, html_url: `${RELEASES_PAGE}/tag/${tag}` })) });
}

/**
 * settings: app-settings (checkForUpdates, and updateCheck / setUpdateCheck for what the check remembers).
 * url, allowHttp: only a test points these at a local server. transport: a stand-in courier for tests.
 */
function createUpdates({ settings, version, now = Date.now, fake, transport = carry, url = RELEASES_API, allowHttp = false }) {
  const send = fake ? fakeTransport(fake, version) : transport;
  let inFlight = null;

  // Asked within the last day = not due, whether that ask worked or failed: a failure backs off to
  // the next day, never a retry storm. A stored time in the future (the PC clock was set back) is due.
  function isDue() {
    const { attemptedAt } = settings.updateCheck();
    const t = now();
    return attemptedAt === null || attemptedAt > t || t - attemptedAt >= DAY_MS;
  }

  // All the page ever hears: whether a newer release is out, which, when the last good answer came, and
  // "Could not check" when the last ask failed. Off shows nothing.
  function status() {
    if (!settings.get().checkForUpdates) return { available: false, version: null, checkedAt: null };
    const { attemptedAt, checkedAt, latest } = settings.updateCheck();
    const available = compareVersions(latest, version) === 1;
    return { available, version: available ? String(latest) : null, checkedAt, ...(attemptedAt !== checkedAt && { error: COULD_NOT }) };
  }

  async function ask() {
    const attemptedAt = now();
    const before = settings.updateCheck();
    try {
      // Written before asking, so a crash mid-request still counts as today's try.
      settings.setUpdateCheck({ ...before, attemptedAt });
      const res = await send({
        method: "GET",
        url,
        headers: { "User-Agent": `KAPEVault/${version}`, Accept: "application/vnd.github+json" },
        body: undefined,
        maxBytes: MAX_BYTES,
        tooLarge: COULD_NOT,
        allowHttp,
      });
      const release = res.status === 200 ? parseRelease(res.body) : null;
      if (release) settings.setUpdateCheck({ attemptedAt, checkedAt: attemptedAt, latest: release.version, url: release.url });
    } catch {
      // offline, Air Wall, GitHub down, a full disk: nothing to show but "Could not check"
    }
  }

  async function checkIfDue() {
    if (settings.get().checkForUpdates && isDue()) {
      inFlight ??= ask().finally(() => {
        inFlight = null;
      });
      await inFlight;
    }
    return status();
  }

  // The page to open for "KAPEVault x is out": looked up here, never a string from the page.
  function pageToOpen() {
    return status().available ? releaseUrl(settings.updateCheck().url) : null;
  }

  // Once now (if due), then the hour decides when a day has passed. Does nothing while the switch is off.
  function start() {
    checkIfDue();
    setInterval(checkIfDue, POLL_MS).unref();
  }

  return { checkIfDue, status, pageToOpen, start };
}

module.exports = { createUpdates, compareVersions, parseRelease, releaseUrl, RELEASES_API, RELEASES_PAGE, DAY_MS };
