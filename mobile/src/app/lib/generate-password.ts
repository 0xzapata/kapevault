// Made from the PC's src/features/generator/lib/generate-password.ts by scripts/brands-sync.mjs - change it there, then run the script.
// Password generator. Pure, uses only globalThis.crypto so it runs in the renderer and in Node.

export interface GeneratorOptions {
  length: number; // clamped to MIN_LENGTH-MAX_LENGTH
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean; // drop look-alikes: 0 O o 1 l I | ` ' "
}

export const MIN_LENGTH = 8;
export const MAX_LENGTH = 64;

export const DEFAULT_GENERATOR: GeneratorOptions = {
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
};

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*-_=+?"; // no quotes: many sites reject them
const AMBIGUOUS = new Set("0Oo1lI|`'\"");

// Unbiased int in [0, n): reject raw values from the incomplete top range.
export function randomInt(n: number): number {
  const limit = 2 ** 32 - (2 ** 32 % n);
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

export function generatePassword(options: GeneratorOptions): string {
  const length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.floor(options.length) || MIN_LENGTH));
  const strip = (set: string) =>
    options.avoidAmbiguous ? [...set].filter((c) => !AMBIGUOUS.has(c)).join("") : set;

  const classes = [
    options.lower && LOWER,
    options.upper && UPPER,
    options.digits && DIGITS,
    options.symbols && SYMBOLS,
  ]
    .filter((s): s is string => Boolean(s))
    .map(strip);
  if (classes.length === 0) classes.push(strip(LOWER)); // all off: fall back to lowercase

  const pool = classes.join("");
  const chars = classes.map((set) => set[randomInt(set.length)]); // one from each class
  while (chars.length < length) chars.push(pool[randomInt(pool.length)]);

  // Fisher-Yates so the guaranteed characters are not always up front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
