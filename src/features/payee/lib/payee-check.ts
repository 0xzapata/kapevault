import type { PayeeEntry } from "@/features/vault/types";
import { cleanPayeeNumber } from "../../../../core/index.js";

// Payee Check: is a pasted number one you have actually confirmed? The scam it answers is a
// relative's hijacked Messenger sending "bagong GCash ko ito, padala ka muna" (my new GCash, send first).
// Pure (no DOM, no Vite) so it runs under `node --test`.

export type PayeeVerdict =
  // The number is saved. others: the same number saved for someone else too.
  | { kind: "match"; payee: PayeeEntry; typed: string; others: PayeeEntry[] }
  // The text names a saved person, but not with any number saved for them. payee: their closest
  // saved number; owner: someone else this number IS saved for.
  | { kind: "new-number"; payee: PayeeEntry; typed: string; owner?: PayeeEntry }
  // One or two digits (or a swap) away from a saved number. diff: positions in typed that differ.
  | { kind: "near-miss"; payee: PayeeEntry; typed: string; diff: number[] }
  | { kind: "not-payee"; typed: string };

const MIN_DIGITS = 7; // shorter is a PIN, a year or a code, not an account
const GAP = /^[ \t().-]{1,3}$/; // between digit groups: "0917 123-4567", "(02) 8123 4567" - never a line break
const DATE = /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/;

// What main saves (core cleanPayeeNumber): separators out, +63 before a mobile number becomes 0. The
// form compares with it to know when a confirmed number really changed.
export { cleanPayeeNumber as cleanNumber };

// "+63 917 123 4567", "63 917...", "917..." and "0917..." are one PH mobile number: 09171234567.
// Everything else (bank accounts) compares as its digits.
export function numberKey(number: string): string {
  const digits = number.replace(/\D/g, "");
  if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^9\d{9}$/.test(digits)) return `0${digits}`;
  return digits;
}

// Every way to read a number out of a search: each run of digit groups with 7+ digits. A pasted
// message can hold an amount or a date beside the number ("0917 123 4567 500"), so checkPayee weighs
// them all. rest is the text around the number, where a name may be ("Mama 0918 123 4567").
export function findNumbers(text: string): { key: string; rest: string }[] {
  const groups = [...text.matchAll(/\+?\d+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  const found: { key: string; rest: string }[] = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i; j < groups.length; j++) {
      if (j > i && !GAP.test(text.slice(groups[j - 1].end, groups[j].start))) break;
      const raw = text.slice(groups[i].start, groups[j].end);
      if (raw.replace(/\D/g, "").length < MIN_DIGITS || DATE.test(raw)) continue;
      found.push({ key: numberKey(raw), rest: `${text.slice(0, groups[i].start)} ${text.slice(groups[j].end)}` });
    }
  }
  return found;
}

// "0917 123 4567" for a PH mobile, fours for anything else.
export function formatNumber(number: string): string {
  if (/^09\d{9}$/.test(number)) return `${number.slice(0, 4)} ${number.slice(4, 7)} ${number.slice(7)}`;
  if (/^9\d{9}$/.test(number)) return `${number.slice(0, 3)} ${number.slice(3, 6)} ${number.slice(6)}`;
  return number.replace(/(\d{4})(?=\d)/g, "$1 ");
}

// "0917 ••• 4567": enough to recognise a saved number, not enough to copy it from a warning. A short
// number shows only its end, or the mask would give most of it away.
export function maskNumber(number: string): string {
  return number.length > 10 ? `${number.slice(0, 4)} ••• ${number.slice(-4)}` : `••• ${number.slice(-4)}`;
}

// Damerau-Levenshtein (optimal string alignment): a swapped pair of digits counts as one edit.
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Two edits in a mobile or bank number is a lookalike; in a 7-9 digit number it is half the number.
const nearLimit = (length: number) => (length >= 10 ? 2 : 1);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const samePerson = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// The saved person the text names, as whole words ("Mama", not "Mamaw"). The longest name wins, so
// "Tita Rosa" beats "Rosa".
function namedPerson(text: string, payees: PayeeEntry[]): string | null {
  const names = [...new Set(payees.map((p) => p.who.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  return names.find((name) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}($|[^\\p{L}\\p{N}])`, "iu").test(text)) ?? null;
}

// Confirmed by call first, then the latest confirmation.
const byTrust = (a: PayeeEntry, b: PayeeEntry) => (b.confirmedAt ?? "").localeCompare(a.confirmedAt ?? "");

const RANK: Record<PayeeVerdict["kind"], number> = { match: 0, "near-miss": 1, "new-number": 2, "not-payee": 3 };
const isMobile = (key: string) => (/^09\d{9}$/.test(key) ? 1 : 0);

export function checkPayee(query: string, payees: PayeeEntry[]): PayeeVerdict | null {
  if (payees.length === 0) return null; // the check starts once there is something to check against
  // The reading that finds the most: a saved number, then a lookalike, then a PH mobile, then the longest.
  const verdicts = findNumbers(query).map((found) => verdictFor(found.key, found.rest, payees));
  return verdicts.sort((a, b) => RANK[a.kind] - RANK[b.kind] || isMobile(b.typed) - isMobile(a.typed) || b.typed.length - a.typed.length)[0] ?? null;
}

function verdictFor(typed: string, rest: string, payees: PayeeEntry[]): PayeeVerdict & { typed: string } {
  const person = namedPerson(rest, payees);
  const theirs = person ? payees.filter((p) => samePerson(p.who, person)) : [];
  const matches = payees.filter((p) => numberKey(p.number) === typed).sort(byTrust);

  if (matches.length) {
    const own = matches.find((p) => theirs.includes(p));
    // "Papa 0917..." where 0917 is Mama's: the number is known, but not for the person named.
    if (person && !own) return { kind: "new-number", payee: closest(theirs, typed), typed, owner: matches[0] };
    const payee = own ?? matches[0];
    return { kind: "match", payee, typed, others: matches.filter((p) => !samePerson(p.who, payee.who)) };
  }

  // Naming someone narrows the lookalike check to their numbers: a near miss of someone else's is chance.
  const pool = person ? theirs : payees;
  const near = pool
    .map((p) => ({ p, key: numberKey(p.number) }))
    .filter(({ key }) => key.length === typed.length)
    .map(({ p, key }) => ({ p, key, distance: editDistance(typed, key) }))
    .filter(({ distance }) => distance <= nearLimit(typed.length))
    .sort((a, b) => a.distance - b.distance || byTrust(a.p, b.p))[0];
  if (near) return { kind: "near-miss", payee: near.p, typed, diff: [...typed].flatMap((c, i) => (c === near.key[i] ? [] : [i])) };

  if (person) return { kind: "new-number", payee: closest(theirs, typed), typed };
  return { kind: "not-payee", typed };
}

// The saved number of this person that looks most like the typed one.
function closest(payees: PayeeEntry[], typed: string): PayeeEntry {
  return [...payees].sort((a, b) => editDistance(typed, numberKey(a.number)) - editDistance(typed, numberKey(b.number)) || byTrust(a, b))[0];
}
