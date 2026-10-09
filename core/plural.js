// "1 day", "3 days": a count and its word, plural when it is not 1. The PC and the phone both say it this way.
/** @param {number} n @param {string} word */
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
