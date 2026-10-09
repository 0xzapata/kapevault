// Calendar dates as the vault stores them: local YYYY-MM-DD. en-CA formats that way; toISOString would
// give UTC, a day behind in PHT mornings.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day as YYYY-MM-DD. The shape alone would take 2026-02-31 or 2026-99-99; a real day
 * survives a round trip through Date. @param {unknown} value */
export const isRealDate = (value) => typeof value === "string" && DATE.test(value) && new Date(`${value}T00:00`).toLocaleDateString("en-CA") === value;

export function today() {
  return new Date().toLocaleDateString("en-CA");
}

// A local calendar date n days after a local YYYY-MM-DD.
/** @param {string} ymd @param {number} days */
export function addDays(ymd, days) {
  const date = new Date(`${ymd}T00:00`);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("en-CA");
}

// Whole calendar days from `from` to `to` (both YYYY-MM-DD): 3 = three days on, -2 = two days before.
// Counted on UTC midnights so a daylight-saving change never makes a day 23 hours long.
/** @param {string} from @param {string} to */
export function daysBetween(from, to) {
  /** @param {string} ymd */
  const utc = (ymd) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
  return Math.round((utc(to) - utc(from)) / 86400000);
}

// Whole calendar days from today (local): 20 = in 20 days, -3 = 3 days ago. Null when it is not a real day.
// `from` stands in for today, for tests.
/** @param {string} ymd @param {string} [from] */
export const daysFromToday = (ymd, from = today()) => (isRealDate(ymd) ? daysBetween(from, ymd) : null);
