// Password health: a strength estimate, the master password rule, and the issue list (reused, weak,
// old, expiring keys, backup codes running out). An account being closed (any lifecycle) gets no issue
// at all, backup codes included - it is on its way out.
// A heuristic, not zxcvbn: entropy from the character pool, minus the patterns people actually use.

const LABELS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];
const THRESHOLDS = [28, 36, 60, 80]; // bits needed for score 1, 2, 3, 4
const PATTERN_FRACTION = 0.25; // a repeat/sequence/keyboard char is worth a quarter of a random one
const WORD_BITS = Math.log2(26) * 0.75; // a letter inside a word-like run - words are far from random
const YEAR_DIGIT_BITS = 1; // a whole year 1950-2039 is ~4 bits
const DAY_MS = 86400000;
const OLD_AFTER_DAYS = 365;
const EXPIRING_WITHIN_DAYS = 30;
const FEW_CODES_LEFT = 2; // backup codes: time to make a new set
const MIN_MASTER_LENGTH = 12;
const MIN_MASTER_SCORE = 3; // "Strong" on the same meter the app shows

// Top of the real leaked-password lists (RockYou, NordPass, SplashData), matched after undoing
// leet and trailing digits/symbols. "summer" is left out on purpose: Word+year+symbol is rated, not zeroed.
const COMMON = new Set(`
password passwort passw0rd pass pass123 password123 mypass mypassword passpass 123456 12345678 123456789
1234567890 12345 1234567 1234 1111 111111 11111111 000000 123123 654321 666666 121212 112233 159753
987654321 123321 7777777 555555 88888888 696969 2000 qwerty qwertyuiop qwerty123 qwertyu qwertz azerty
qwe123 123qwe qweasd qazwsx 1qaz2wsx zaq12wsx 1q2w3e 1q2w3e4r q1w2e3r4 qwer1234 asdf asdf1234 asdfgh
asdfghjkl zxcvbn zxcvbnm abc abc123 123abc abcd1234 a1b2c3 abcdef abcdefg aaaaaa letmein admin
administrator root toor welcome iloveyou iloveu loveme lovely monkey dragon sunshine football baseball
basketball soccer hockey master shadow michael superman batman spiderman trustno trustno1 trustme changeme
login access secret secret123 hello hello123 princess charlie donald freedom whatever starwars pokemon
mustang jordan jordan23 harley ranger buster thomas robert daniel jessica ashley jennifer michelle nicole
hunter tigger killer pepper ginger cookie flower hannah maggie computer internet samsung google apple
orange banana chocolate cheese purple silver diamond matrix matthew andrew joshua anthony william george
taylor austin yankees lakers chelsea liverpool arsenal barcelona dallas cowboys eagles steelers babygirl
angel angels butterfly default guest test test123 user demo temp blink182 superstar rockstar nothing
jesus blessed faith heaven family friends forever ninja mickey minecraft fortnite roblox zelda naruto
snoopy peanut bailey sophie buddy lucky merlin phoenix falcon tiger dolphin rainbow sunflower qazwsxedc
zxcvbnm123 michael1 iloveyou1 princess1 lovelove fuckyou asshole biteme whatever1 sexy hottie
`.split(/\s+/).filter(Boolean));

// Words a guesser tries inside a longer password too (SECURITY-AUDIT-2026-09-28.md M4: "Dragon!Dragon!1" and
// "KapeVault2026!" passed the master rule): the common list's words of 4+ letters, and this app's names.
const APP_WORDS = ["kapevault", "kape", "vault", "bovault", "brewedops"];
const INNER_WORDS = [...COMMON].filter((w) => /^[a-z]{4,}$/.test(w)).concat(APP_WORDS);

const LEET = { "@": "a", "4": "a", "0": "o", "3": "e", "5": "s", "$": "s", "7": "t" };
const unleet = (s, one) => Array.from(s, (c) => (c === "1" ? one : LEET[c] ?? c)).join("");

// Keyboard rows and columns; two keys next to each other in any of them are "adjacent".
const KEY_LINES = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890", "1qaz", "2wsx", "3edc", "4rfv", "5tgb", "6yhn", "7ujm", "8ik,", "9ol.", "0p;/"];
const RELATIONS = [
  (a, b) => a === b, // aaaa
  (a, b) => b.codePointAt(0) - a.codePointAt(0) === 1, // abcd, 1234
  (a, b) => a.codePointAt(0) - b.codePointAt(0) === 1, // dcba, 4321
  (a, b) => KEY_LINES.some((line) => { const i = line.indexOf(a); return i >= 0 && (line[i + 1] === b || line[i - 1] === b); }),
];

function isCommon(pw) {
  const lower = pw.toLowerCase();
  const base = lower.replace(/[^\p{L}]+$/u, "");
  return [lower, base, unleet(base, "i"), unleet(base, "l")].some((s) => s && COMMON.has(s));
}

// Calls fn(start, end) for each maximal run of length >= min where every neighbour pair passes ok.
function eachRun(n, ok, min, fn) {
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i < n && ok(i)) continue;
    if (i - start >= min) fn(start, i);
    start = i;
  }
}

function estimateBits(pw) {
  const chars = Array.from(pw); // code points, so an emoji is one char
  const n = chars.length;
  const has = (re) => chars.some((c) => re.test(c));
  const pool = (has(/[a-z]/) ? 26 : 0) + (has(/[A-Z]/) ? 26 : 0) + (has(/[0-9]/) ? 10 : 0) + (has(/[\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]/) ? 33 : 0) + (has(/[^\x00-\x7f]/) ? 100 : 0);
  const bits = new Array(n).fill(Math.log2(pool));
  let extra = 0;

  // Letter runs of 4+ (leet undone, mostly real letters) in lower, UPPER or Title case read as words.
  // A capital after a small letter starts a new word ("KapeVault" is Kape + Vault).
  const letters = chars.map((c) => (c === "1" ? "i" : LEET[c] ?? c));
  const isLetter = (i) => /[a-zA-Z]/.test(letters[i]);
  const camelBreak = (i) => /[a-z]/.test(letters[i - 1]) && /[A-Z]/.test(letters[i]);
  eachRun(n, (i) => isLetter(i) && isLetter(i - 1) && !camelBreak(i), 4, (s, e) => {
    if (!isLetter(s)) return;
    const run = chars.slice(s, e).filter((c) => /[a-zA-Z]/.test(c)).join("");
    if (run.length * 2 <= e - s) return; // mostly digits ("xz7351") is not a word
    if (run !== run.toLowerCase() && run !== run.toUpperCase() && !/^[A-Z][a-z]*$/.test(run)) return;
    for (let i = s; i < e; i++) bits[i] = Math.min(bits[i], WORD_BITS);
    if (run !== run.toLowerCase()) extra += 1; // the capitalisation choice
  });

  // Repeats, sequences and keyboard walks of 3+: every char after the first is mostly predictable.
  const low = chars.map((c) => c.toLowerCase());
  const patterned = new Array(n).fill(false);
  for (const rel of RELATIONS) {
    eachRun(n, (i) => rel(low[i - 1], low[i]), 3, (s, e) => patterned.fill(true, s + 1, e));
  }
  patterned.forEach((p, i) => { if (p) bits[i] *= PATTERN_FRACTION; });

  // A common word (or the app's name) anywhere inside: its letters together cost what picking it from
  // the list does.
  const plain = low.join("");
  for (const form of [plain, unleet(plain, "i"), unleet(plain, "l")]) {
    for (const word of INNER_WORDS) {
      for (let at = form.indexOf(word); at >= 0; at = form.indexOf(word, at + 1)) {
        for (let i = at; i < at + word.length; i++) bits[i] = Math.min(bits[i], Math.log2(INNER_WORDS.length) / word.length);
      }
    }
  }

  // A block of 3+ that already appeared ("Aa1!Aa1!Aa1!", "password password") is a repeat, not new
  // randomness: its characters count like a pattern's.
  for (let i = 3; i + 3 <= n; i++) {
    let best = 0;
    for (let j = 0; j < i; j++) {
      let k = 0;
      while (i + k < n && j + k < i && low[j + k] === low[i + k]) k++;
      best = Math.max(best, k);
    }
    if (best < 3) continue;
    for (let k = i; k < i + best; k++) bits[k] *= PATTERN_FRACTION;
    i += best - 1;
  }

  for (let i = 0; i + 4 <= n; i++) {
    if (!/^(19[5-9]\d|20[0-3]\d)$/.test(chars.slice(i, i + 4).join(""))) continue;
    for (let j = i; j < i + 4; j++) bits[j] = YEAR_DIGIT_BITS;
    i += 3;
  }
  return bits.reduce((a, b) => a + b, 0) + extra;
}

/** @returns {{ score: number, label: string, bits: number }} */
export function ratePassword(pw) {
  if (typeof pw !== "string" || pw.length === 0) return { score: 0, label: "None", bits: 0 };
  // A guesser tries the common list first, so a hit costs about log2(list size).
  const common = isCommon(pw);
  const bits = common ? Math.min(estimateBits(pw), Math.log2(COMMON.size)) : estimateBits(pw);
  const score = common ? 0 : THRESHOLDS.filter((t) => bits >= t).length;
  return { score, label: LABELS[score], bits: Math.round(bits) };
}

// "YYYY-MM-DD" as UTC midnight, so day differences never drift with the local timezone.
function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === "string" ? s : "");
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
}

// sha256: the host's SHA-256 of a password (hex). Hash -> count, so no plaintext-keyed map of secrets
// is ever built - and the core holds no crypto of its own.
/**
 * @param {any[]} entries the vault's stored entries
 * @param {string} today local YYYY-MM-DD
 * @param {(text: string) => string} sha256
 * @returns {Map<string, Array<{ type: string, count?: number, days?: number, left?: number }>>} only entries that have issues
 */
export function findIssues(entries, today, sha256) {
  const now = parseDay(today);
  const list = Array.isArray(entries) ? entries : [];
  const logins = list.filter((e) => e && e.kind === "login" && typeof e.password === "string" && e.password.length > 0);
  const hashes = new Map(logins.map((e) => [e, sha256(e.password)]));
  const counts = new Map();
  for (const h of hashes.values()) counts.set(h, (counts.get(h) ?? 0) + 1);

  const result = new Map();
  for (const e of list) {
    if (e?.lifecycle) continue; // dormant, deletion requested or gone: it is on its way out, no nags
    const issues = [];
    if (hashes.has(e)) {
      const others = counts.get(hashes.get(e)) - 1;
      if (others > 0) issues.push({ type: "reused", count: others });
      if (ratePassword(e.password).score <= 1) issues.push({ type: "weak" });
      // Held for someone else (Mama's bank login): rotating it is theirs to decide, so no "old" nag.
      const days = Math.round((now - parseDay(e.passwordChangedAt ?? e.updatedAt)) / DAY_MS);
      if (days > OLD_AFTER_DAYS && !e.heldFor) issues.push({ type: "old", days });
    } else if (e && (e.kind === "key" || e.kind === "thing") && e.expires) {
      // An API key, or an ID kept as a thing (passport, license): running out, or already out.
      const until = Math.round((parseDay(e.expires) - now) / DAY_MS);
      if (until < 0) issues.push({ type: "expired", days: -until });
      else if (until <= EXPIRING_WITHIN_DAYS) issues.push({ type: "expiring", days: until });
    }
    // A login's backup codes, running out (or all used) - with or without a password.
    const codes = e && e.kind === "login" && Array.isArray(e.recoveryCodes?.codes) ? e.recoveryCodes.codes : [];
    const left = codes.filter((c) => !c.used).length;
    if (codes.length && left <= FEW_CODES_LEFT) issues.push({ type: "codes", left });
    if (issues.length) result.set(e.id, issues);
  }
  return result;
}

// Backups leave the device (R2, saved copies, synced folders), so the master password is all that
// stands between a copied file and the vault. Only new vaults and changes are held to this.
/** @returns {string | null} what is wrong with it, or null */
export function masterProblem(master) {
  if (typeof master !== "string" || master.trim().length < MIN_MASTER_LENGTH) return `Use at least ${MIN_MASTER_LENGTH} characters.`;
  if (ratePassword(master).score < MIN_MASTER_SCORE) return "Too easy to guess. Try three or four unrelated words.";
  return null;
}
