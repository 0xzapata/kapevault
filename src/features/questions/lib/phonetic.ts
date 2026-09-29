// Spelling an answer out loud to a hotline agent: NATO letters ("V as in Victor"), digits as words,
// spaces and punctuation named. Pure.

const NATO: Record<string, string> = {
  a: "Alpha", b: "Bravo", c: "Charlie", d: "Delta", e: "Echo", f: "Foxtrot", g: "Golf", h: "Hotel", i: "India",
  j: "Juliet", k: "Kilo", l: "Lima", m: "Mike", n: "November", o: "Oscar", p: "Papa", q: "Quebec", r: "Romeo",
  s: "Sierra", t: "Tango", u: "Uniform", v: "Victor", w: "Whiskey", x: "X-ray", y: "Yankee", z: "Zulu",
};

const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

const SIGNS: Record<string, string> = {
  " ": "space", "-": "hyphen", _: "underscore", ".": "period", ",": "comma", "'": "apostrophe", '"': "quote",
  "!": "exclamation mark", "?": "question mark", "@": "at sign", "#": "hash", $: "dollar sign", "%": "percent",
  "&": "ampersand", "*": "asterisk", "+": "plus", "=": "equals", "/": "slash", "\\": "backslash", ":": "colon",
  ";": "semicolon", "(": "open bracket", ")": "close bracket", "[": "open square bracket", "]": "close square bracket",
  "{": "open curly bracket", "}": "close curly bracket", "<": "less than", ">": "greater than", "~": "tilde",
  "`": "backtick", "^": "caret", "|": "vertical bar",
};

export interface Spoken {
  char: string;
  say: string; // the whole phrase: "V as in Victor", "three", "space"
  hint: string; // what goes under the big character: "as in Victor", "three"
}

function sayChar(char: string): Spoken {
  const lower = char.toLowerCase();
  if (NATO[lower]) {
    const capital = char !== lower;
    return { char, say: `${capital ? "capital " : ""}${lower.toUpperCase()} as in ${NATO[lower]}`, hint: `${capital ? "capital, " : ""}as in ${NATO[lower]}` };
  }
  const word = /^[0-9]$/.test(char) ? DIGITS[Number(char)] : SIGNS[char];
  if (word) return { char, say: word, hint: word };
  // é, ñ: the plain letter plus a warning that it carries a mark.
  const base = char.normalize("NFD")[0].toLowerCase();
  if (base !== lower && NATO[base]) {
    const capital = char !== lower ? "capital " : "";
    return { char, say: `${capital}${base.toUpperCase()} with a mark, as in ${NATO[base]}`, hint: `${capital}with a mark, as in ${NATO[base]}` };
  }
  return { char, say: char, hint: "" };
}

// One entry per character (code point, so an emoji stays whole).
export function spell(text: string): Spoken[] {
  return Array.from(text, sayChar);
}

// The whole spelling as one line: "V as in Victor, E as in Echo, space, three".
export const spellingLine = (text: string) => spell(text).map((s) => s.say).join(", ");
