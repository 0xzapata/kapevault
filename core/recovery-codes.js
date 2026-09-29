// Backup codes (a login's one-time recovery codes) change through these, never through the form.
// { codes: [{ code, used }], setAt, paper: [{ where, printedAt, outdatedAt? }] }
import { isRealDate, today } from "./dates.js";
import { cleanText, liveLogin } from "./entries.js";
/** @import { VaultData } from "./entries.js" */

const MIN_CODES = 4; // backup codes in one set: sites hand out 5 to 16
const MAX_CODES = 20;
const MAX_CODE_LENGTH = 64;

// The page splits a pasted block into codes (parse-codes.ts); this checks the shape again.
function cleanCodes(codes) {
  if (!Array.isArray(codes) || codes.length < MIN_CODES || codes.length > MAX_CODES) throw new Error(`Backup codes: save ${MIN_CODES} to ${MAX_CODES} codes`);
  return codes.map((c) => {
    const code = cleanText(c);
    if (!code || code.length > MAX_CODE_LENGTH || /[\r\n]/.test(code)) throw new Error(`Backup codes: one code each, up to ${MAX_CODE_LENGTH} characters`);
    return code;
  });
}

function findLogin(data, id) {
  return liveLogin(data, id, "Backup codes belong to a login");
}

function saveCodes(data, id, recoveryCodes) {
  data.entries = data.entries.map((e) => (e.id === id ? { ...e, recoveryCodes } : e));
}

// A new set (first or replacement). The codes printed before stopped working with it, so every
// recorded paper copy is marked out of date - once, on the day it happened.
/** @param {VaultData} data @param {string} id @param {unknown} codes */
export function setRecoveryCodes(data, id, codes) {
  const entry = findLogin(data, id);
  const clean = cleanCodes(codes);
  const paper = (entry.recoveryCodes?.paper ?? []).map((p) => ({ ...p, outdatedAt: p.outdatedAt ?? today() }));
  saveCodes(data, id, { codes: clean.map((code) => ({ code, used: false })), setAt: today(), paper });
}

/** @param {VaultData} data @param {string} id @param {number} index @param {boolean} used */
export function markRecoveryCode(data, id, index, used) {
  const set = findLogin(data, id).recoveryCodes;
  if (!set?.codes[index]) throw new Error("No such backup code");
  saveCodes(data, id, { ...set, codes: set.codes.map((c, i) => (i === index ? { ...c, used: Boolean(used) } : c)) });
}

/** @param {VaultData} data @param {string} id @param {string} where @param {string} [printedAt] */
export function addPaperCopy(data, id, where, printedAt) {
  const set = findLogin(data, id).recoveryCodes;
  if (!set) throw new Error("Add the backup codes first");
  const place = cleanText(where);
  if (!place) throw new Error("Say where the printed copy is");
  const date = cleanText(printedAt) || today();
  if (!isRealDate(date)) throw new Error("Printed date must be a date");
  saveCodes(data, id, { ...set, paper: [...(set.paper ?? []), { where: place, printedAt: date }] });
}

// "Shredded": the record of a paper copy goes.
/** @param {VaultData} data @param {string} id @param {number} index */
export function removePaperCopy(data, id, index) {
  const set = findLogin(data, id).recoveryCodes;
  if (!set?.paper?.[index]) throw new Error("No such paper copy");
  saveCodes(data, id, { ...set, paper: set.paper.filter((_, i) => i !== index) });
}

// The whole set for the revealed grid: one fetch, like a password on reveal.
/** @param {VaultData} data @param {string} id @returns {{ code: string, used: boolean }[]} */
export function listRecoveryCodes(data, id) {
  return (findLogin(data, id).recoveryCodes?.codes ?? []).map(({ code, used }) => ({ code, used }));
}
