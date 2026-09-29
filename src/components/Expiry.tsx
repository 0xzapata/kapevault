import { daysFromToday, formatDay, relativeDays } from "@/lib/local-date";

const EXPIRY_WARN_DAYS = 30;

// An expiry date with how far off it is: amber within a month, red once past.
export function Expiry({ expires }: { expires?: string }) {
  const days = expires ? daysFromToday(expires) : null;
  if (!expires || days === null) return <span className="text-ink-3">Never</span>;
  const tone = days < 0 ? "text-danger" : days <= EXPIRY_WARN_DAYS ? "text-warn" : "";
  return (
    <span className={tone}>
      {formatDay(expires)} <span className={tone || "text-ink-3"}>({relativeDays(days)})</span>
    </span>
  );
}
