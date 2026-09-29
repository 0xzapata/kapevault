// Backup codes pasted as one block: split into codes, each kept as the site printed it ("1234 5678",
// "abcd-efgh"). Pure, so it runs under `node --test`. Main checks the result again (cleanCodes in
// vault-session.cjs) - keep MIN_CODES / MAX_CODES in step with it.

export const MIN_CODES = 4;
export const MAX_CODES = 20;

// "1.", "01)", "(3)", "3:" numbering and "-", "*", "•" bullets - before a code, or mid-line when a
// site prints two numbered columns ("1. 1234 5678   6. 2345 6789").
const LIST_MARK = /^(?:\(?\d{1,2}[.):]\)?|[-*•·])$/;
// A code is letters and digits, maybe split by dashes or underscores.
const CODE = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/;
// One half of a code printed in two ("1234 5678" - Google, Facebook).
const HALF = /^[A-Za-z0-9]{3,5}$/;
const LETTERS = /^[A-Za-z]+$/;

function lineCodes(line: string): string[] {
  const tokens = line.split(/[\s,;]+/).filter((t) => t && !LIST_MARK.test(t));
  // Punctuation, an email or a colon: a heading or a sentence ("Your backup codes:"), not codes.
  if (tokens.some((t) => !CODE.test(t))) return [];
  const codes: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const [t, next] = [tokens[i], tokens[i + 1]];
    if (next && HALF.test(t) && HALF.test(next) && t.length === next.length && /\d/.test(t + next)) {
      codes.push(`${t} ${next}`);
      i += 1;
      continue;
    }
    // A Word in mixed case, or a bare word among others ("GitHub recovery codes"), is prose.
    const word = LETTERS.test(t) && ((/[a-z]/.test(t) && /[A-Z]/.test(t)) || tokens.length > 1);
    if (word) return [];
    if (t.length >= 4) codes.push(t); // a stray "1" or "12" left by numbering is not a code
  }
  return codes;
}

export function parseCodes(block: string): { codes: string[]; error: string } {
  const seen = new Set<string>();
  const found = block.split(/\r?\n/).flatMap(lineCodes).filter((c) => !seen.has(c) && Boolean(seen.add(c)));
  // A one-word heading on its own line ("BACKUP") reads like a letters-only code. A real one is as
  // long as the rest of its set, so a letters-only "code" of another length goes.
  const size = (c: string) => c.replace(/[\s_-]/g, "").length;
  const count = (n: number) => found.filter((c) => size(c) === n).length;
  const usual = found.map(size).reduce((best, n) => (count(n) > count(best) ? n : best), 0);
  const codes = found.filter((c) => !LETTERS.test(c) || found.length < 2 || size(c) === usual);
  let error = "";
  if (codes.length === 0) error = "No codes found. Paste the codes the site showed you, one per line.";
  else if (codes.length < MIN_CODES) error = `Found ${codes.length}. A set has at least ${MIN_CODES} codes - paste them all.`;
  else if (codes.length > MAX_CODES) error = `Found ${codes.length}. KAPEVault keeps up to ${MAX_CODES} codes in one set.`;
  return { codes, error };
}
