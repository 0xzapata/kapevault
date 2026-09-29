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
