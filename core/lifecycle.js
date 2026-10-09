// Shrink Queue: closing an account on purpose. A login's `lifecycle` is { state: "dormant" |
// "deletion-requested" | "gone", requestedAt, followUpAt, goneAt }; none = in use.
import { addDays, today } from "./dates.js";
import { isTrashed, liveLogin } from "./entries.js";
/** @import { VaultData } from "./entries.js" */

const FOLLOW_UP_DAYS = 30; // a company gets a month to act on an erasure request

// state: "dormant" | "deletion-requested" | null (back in use). A request is dated by this device's
// clock, with a follow-up a month on; sending it again (deletion-requested once more) moves both dates.
/** @param {VaultData} data @param {string} id @param {"dormant" | "deletion-requested" | null} state */
export function setLifecycle(data, id, state) {
  liveLogin(data, id, "Only a login can be closed");
  let lifecycle;
  if (state === "dormant") lifecycle = { state };
  else if (state === "deletion-requested") lifecycle = { state, requestedAt: today(), followUpAt: addDays(today(), FOLLOW_UP_DAYS) };
  else if (state !== null) throw new Error("Unknown account state");
  data.entries = data.entries.map((e) => (e.id === id ? { ...e, lifecycle } : e));
}

// "Confirm it's gone": every secret on the login is wiped and a tombstone stays - title, site,
// username, the dates - so you remember the account existed. Logins that signed in through it lose the link.
/** @param {VaultData} data @param {string} id @param {boolean} clearNotes */
export function confirmGone(data, id, clearNotes) {
  const entry = liveLogin(data, id, "Only a login can be closed");
  const tombstone = {
    id: entry.id,
    spaceId: entry.spaceId,
    kind: "login",
    title: entry.title,
    url: entry.url,
    username: entry.username,
    brand: entry.brand,
    notes: clearNotes ? "" : entry.notes,
    updatedAt: today(),
    lifecycle: { state: "gone", requestedAt: entry.lifecycle?.requestedAt, goneAt: today() },
  };
  data.entries = data.entries.map((e) => (e.id === id ? tombstone : e.viaEntryId === id ? { ...e, viaEntryId: undefined } : e));
}

// Blind Reminders: how many deletion requests are past their follow-up day - a count, nothing else.
/** @param {VaultData} data @returns {number} */
export function followUpsDue(data) {
  const now = today();
  return data.entries.filter((e) => e.lifecycle?.state === "deletion-requested" && e.lifecycle.followUpAt <= now && !isTrashed(e)).length;
}
