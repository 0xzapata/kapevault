// Pure matcher (no Vite, no DOM) so it runs under `node --test` too.
export interface BrandTerms {
  slug: string;
  match: string[];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "dropbox.com" must not light up X ("x.com"), "olive.com" must not be Microsoft ("live.com").
// Domain/path terms need a boundary before them; ".docx"-style extensions need one after;
// plain words ("slack", "ghl") must be whole words.
function termTest(term: string): (text: string) => boolean {
  const t = escapeRegex(term);
  let pattern: string;
  if (term.startsWith(".")) pattern = `${t}($|[^a-z0-9])`;
  else if (/[./]/.test(term)) pattern = `(^|[^a-z0-9-])${t}`;
  else pattern = `(^|[^a-z0-9])${t}($|[^a-z0-9])`;
  const re = new RegExp(pattern);
  return (text) => re.test(text);
}

export function createMatcher(catalog: BrandTerms[]) {
  const matchers = catalog.map((b) => ({ slug: b.slug, tests: b.match.map(termTest) }));
  return (text: string): string | null => {
    const lower = text.toLowerCase();
    if (!lower.trim()) return null;
    return matchers.find((m) => m.tests.some((test) => test(lower)))?.slug ?? null;
  };
}
