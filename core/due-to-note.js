// Due dates were removed on 2026-09-26. A vault, restore or import file made before then can still
// hold `due` items, so each one opens as a secure note with the same id, title, space, tags, heldFor,
// favorite and dates. Its body keeps everything the due date had, as plain lines (a note body is a
// secret like any other: it stays in main). Anything that is not a due date passes through untouched.

const AGENCY_NAMES = { sss: "SSS", philhealth: "PhilHealth", pagibig: "Pag-IBIG", "bir-1701q": "BIR 1701Q", "bir-2551q": "BIR 2551Q", "bir-1701": "BIR 1701 / 1701A" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const monthDay = (v) => typeof v === "string" && /^(0[1-9]|1[0-2])-\d{2}$/.test(v);
const dayName = (md) => `${MONTHS[Number(md.slice(0, 2)) - 1]} ${Number(md.slice(3))}`;

// The schedule in words; a shape this code does not know is kept as it was written.
function scheduleWords(s) {
  if (s?.every === "month" && Number.isInteger(s.day)) return s.day >= 31 ? "Every month, by the last day" : `Every month, by day ${s.day}`;
  if (s?.every === "quarter" && Array.isArray(s.dates) && s.dates.every(monthDay)) return `Every ${s.dates.map(dayName).join(", ")}`;
  if (s?.every === "year" && monthDay(s.date)) return `Every year, by ${dayName(s.date)}`;
  if (s?.every === "once") return "One time";
  return s === undefined ? "" : JSON.stringify(s);
}

// entries: a vault's stored entries, or an import file's items (those name the login by `via`).
export function dueToNotes(entries) {
  return entries.map((entry) => {
    if (entry?.kind !== "due") return entry;
    const { agency, schedule, nextDue, amount, viaEntryId, via, receipts, ...rest } = entry;
    const login = via ?? (viaEntryId && entries.find((e) => e?.id === viaEntryId)?.title);
    const lines = [];
    const add = (label, value) => {
      if (value) lines.push(`${label}: ${value}`);
    };
    add("For", agency === "custom" ? "" : (AGENCY_NAMES[agency] ?? agency));
    add("Schedule", scheduleWords(schedule));
    add("Next due", nextDue);
    add("Amount", amount);
    add("Website login", login);
    for (const r of Array.isArray(receipts) ? receipts : []) {
      const details = [r?.dueDate && `for ${r.dueDate}`, r?.reference && `ref ${r.reference}`, r?.amount && `amount ${r.amount}`].filter(Boolean);
      lines.push(`Paid ${r?.paidAt ?? "(no date)"}${details.length ? `: ${details.join(", ")}` : ""}`);
    }
    return { ...rest, kind: "note", body: lines.join("\n") };
  });
}
