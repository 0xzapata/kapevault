// Sizes and times as the page shows them, in the viewer's own locale.

// A file in the browser: "512 B", "3.4 KB", "120 MB".
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

// A backup (never empty, rarely past a few MB): whole KB, then MB to a tenth: "412 KB", "1.3 MB".
export function formatBackupSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// "Thu, Sep 25, 3:15:02 PM" in local time. Seconds tell apart backups made a minute apart.
export function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
}

// The lock screen's clock: "3:05", 12-hour, with the day period (PM, p. m., 午後) left out in every locale.
export function formatClock(now: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12: true })
    .formatToParts(now)
    .filter((p) => p.type !== "dayPeriod")
    .map((p) => p.value)
    .join("")
    .trim();
}
