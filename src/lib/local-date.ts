// Local calendar dates as YYYY-MM-DD, the one place the page makes or compares them. Never
// toISOString().slice(0, 10): that is UTC, a day behind in the morning east of UTC.

// Today, local.
export const localToday = (now: Date = new Date()) => now.toLocaleDateString("en-CA");

// A local YYYY-MM-DD as local midnight; null when it is not one.
export function parseDay(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// Whole calendar days from `from` to `to` (both YYYY-MM-DD): 3 = three days on, -2 = two days before.
// Counted on UTC midnights so a daylight-saving change never makes a day 23 hours long.
export function daysBetween(from: string, to: string): number {
  const utc = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
  return Math.round((utc(to) - utc(from)) / 86400000);
}

// Whole calendar days from today: 20 = in 20 days, -3 = 3 days ago. Null for a bad date.
export const daysFromToday = (ymd: string, today: string = localToday()): number | null => (parseDay(ymd) ? daysBetween(today, ymd) : null);

// "1 day", "3 days": a count and its word, plural when it is not 1.
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// "Sep 26, 2026" in the viewer's own format. A YYYY-MM-DD is its local day, never UTC; a UTC
// timestamp (password history) shows its local day; anything else comes back as it is.
export function formatDay(value: string | Date): string {
  const date = typeof value === "string" ? (parseDay(value) ?? (/^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : null)) : value;
  return date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : String(value);
}

// 0 -> "today", 3 -> "in 3 days", -1 -> "1 day ago".
export function relativeDays(days: number): string {
  if (days === 0) return "today";
  return days > 0 ? `in ${plural(days, "day")}` : `${plural(-days, "day")} ago`;
}

const DAY_MS = 86400000;

// "just now", "5 min ago", "3 hours ago", "yesterday", "3 days ago", then the date.
export function relativeTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / DAY_MS);
  if (days <= 0) return `${plural(Math.floor(diff / 3600000), "hour")} ago`;
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDay(new Date(ms));
}
