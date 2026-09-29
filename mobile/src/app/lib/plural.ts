// Made from the PC's src/lib/local-date.ts by scripts/brands-sync.mjs - change it there, then run the script.
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
