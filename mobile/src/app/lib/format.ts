// Dates and times the way the PC says them (src/lib/local-date.ts and src/lib/format.ts).

import { plural } from "@core";

// Days from today is a rule, not a format: one function in core/dates.js, the PC uses it too.
export { daysFromToday } from "@core";

const DAY_MS = 86400000;

// Local midnight of a YYYY-MM-DD, never UTC.
function parseDay(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

export function formatDay(value: string | Date): string {
  // A UTC timestamp (password history) shows its local day.
  const date = typeof value === "string" ? (parseDay(value) ?? (/^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : null)) : value;
  return date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : String(value);
}

export function relativeDays(days: number): string {
  if (days === 0) return "today";
  return days > 0 ? `in ${plural(days, "day")}` : `${plural(-days, "day")} ago`;
}

// "just now", "5 min ago", "3 hours ago", "yesterday", "3 days ago", then the date.
export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / DAY_MS);
  if (days <= 0) return `${plural(Math.floor(diff / 3600000), "hour")} ago`;
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDay(new Date(ms));
}

// "Just now" at the start of a line.
export const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// "Today, 9:12 AM", "Yesterday, 6:40 PM", "Sep 24, 8:05 PM" - in the phone's own language and 12/24-hour setting.
export function dayAndTime(ms: number): string {
  const time = new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / DAY_MS);
  const day = days === 0 ? "Today" : days === 1 ? "Yesterday" : new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day}, ${time}`;
}

export const clockTime = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export const hoursText = (hours: number) => (hours === 0 ? "Off" : plural(hours, "hour"));

// "123456" -> "123 456", "12345678" -> "1234 5678".
export const groupCode = (code: string) => `${code.slice(0, Math.ceil(code.length / 2))} ${code.slice(Math.ceil(code.length / 2))}`;
